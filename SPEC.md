# SPEC.md — Production-Grade Multi-Tenant Collaborative Work Platform

> **Revision note (full rewrite — all audit fixes applied):** This document incorporates every fix from the original audit plus the second-pass audit: CONSISTENCY-003/004/005, COMPLETENESS-001/002/003/004/005/006/007/008/009/010, BUG-NEW-001/002/003/004/005/006/007, SEC-NEW-001/002/003/004/005/006, SCALE-NEW-001/002/003/004, EXEC-001/002/003/004/005, CROSS-001/002, DEP-001/002/003/004/005/006, and all second-pass audit issues: magic link / password reset / email verification token storage (2.6/2.7/2.8), outbox ordering (3.1), grace_period_ends_at setter (3.2), token family revocation (3.3), SAML cleanup buffer (3.5), notification event type enum (2.9), VideoCall domain model (C-07), GDPR export PII redaction (C-08), CORS production guard (C-02), Helmet config (C-03), Razorpay payload schema (C-04), SIGTERM handler (C-05), outbox polling min delay (C-06), WebSocket re-auth heartbeat (5.6), per-channel sequence scale note (6.1).

---

## Table of Contents

1. [Domain Models](#1-domain-models)
2. [Relationships & Ownership Boundaries](#2-relationships--ownership-boundaries)
3. [Multi-Tenant Isolation Rules](#3-multi-tenant-isolation-rules)
4. [Business Rules & Invariants](#4-business-rules--invariants)
5. [State Machines](#5-state-machines)
6. [API Contracts](#6-api-contracts)
7. [Event Schemas and Notification Event Types](#7-event-schemas-and-notification-event-types)
8. [Idempotency Rules](#8-idempotency-rules)
9. [Authorization Rules](#9-authorization-rules)
10. [Edge Cases & Failure Scenarios](#10-edge-cases--failure-scenarios)
11. [Data Consistency Guarantees](#11-data-consistency-guarantees)
12. [Concurrency Considerations](#12-concurrency-considerations)

---

## 1. Domain Models

All timestamps are `TIMESTAMPTZ` (UTC). All IDs are `UUID` (v4, generated via `gen_random_uuid()`). Fields marked **NOT NULL** are non-nullable. Fields without that marking are nullable.

**All mutable tables MUST have an `updated_at` column managed by a PostgreSQL trigger** (BUG-NEW-006 fix). The trigger function `set_updated_at()` is created in migration `001_extensions.js` and applied to every mutable table in its respective migration. This guarantees `updated_at` is always current regardless of whether application code explicitly sets it.

**Complete list of tables requiring `updated_at` trigger (migration checklist):**
`users`, `user_preferences`, `organizations`, `org_memberships`, `workspaces`, `boards`, `tasks`, `comments`, `channels`, `notification_preferences`, `subscriptions`, `payments`, `webhook_subscriptions`, `webhook_delivery_log`, `feature_flags`.
Tables without `updated_at` (append-only or partition tables): `files` (append-only after confirm), `notifications`, `auth_providers`, `refresh_tokens`, `invitations`, `task_assignees`, `task_dependencies`, `task_templates`, `task_activity_log`, `saml_used_assertions`, `outbox_events`, `idempotency_keys`, `direct_channel_pairs`, `video_calls`, `audit_logs` (immutable).

---

### 1.1 Organization (Tenant Root)

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, NOT NULL | Tenant ID (`org_id`) |
| `name` | VARCHAR(255) | NOT NULL | Display name |
| `slug` | VARCHAR(100) | NOT NULL, UNIQUE | URL-safe identifier |
| `status` | VARCHAR(20) | NOT NULL, CHECK | `active`, `suspended`, `offboarding`, `deleted` |
| `plan_tier` | VARCHAR(20) | NOT NULL, CHECK | `free`, `pro`, `business`, `enterprise` |
| `plan_started_at` | TIMESTAMPTZ | NOT NULL | |
| `plan_expires_at` | TIMESTAMPTZ | | NULL = perpetual/managed |
| `grace_period_ends_at` | TIMESTAMPTZ | | Set when `payment.failed` event is processed — exactly `NOW() + INTERVAL '7 days'`. Set by payment worker on `payment.failed`. Not set here at rest — must be explicitly written. |
| `offboarding_started_at` | TIMESTAMPTZ | | Set on deletion request |
| `deleted_at` | TIMESTAMPTZ | | Soft delete |
| `max_members` | INTEGER | NOT NULL | Enforced at service layer |
| `storage_quota_bytes` | BIGINT | NOT NULL | Plan-derived |
| `storage_used_bytes` | BIGINT | NOT NULL, DEFAULT 0 | Updated atomically |
| `saml_enabled` | BOOLEAN | NOT NULL, DEFAULT FALSE | Enterprise only |
| `saml_metadata_url` | TEXT | | |
| `mfa_required` | BOOLEAN | NOT NULL, DEFAULT FALSE | |
| `account_lockout_attempts` | INTEGER | NOT NULL, DEFAULT 5 | |
| `retention_audit_days` | INTEGER | NOT NULL, DEFAULT 365, CHECK (≥365) | Min 365 |
| `retention_chat_days` | INTEGER | | NULL = unlimited |
| `timezone` | VARCHAR(64) | NOT NULL, DEFAULT 'UTC' | |
| `locale` | VARCHAR(16) | NOT NULL, DEFAULT 'en-US' | |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Managed by trigger |
| `version` | INTEGER | NOT NULL, DEFAULT 1 | Optimistic lock |

**Indexes:** `slug` (UNIQUE), `status`, `deleted_at`

---

### 1.2 User

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, NOT NULL | |
| `email` | VARCHAR(255) | NOT NULL | Lowercase normalized |
| `email_verified` | BOOLEAN | NOT NULL, DEFAULT FALSE | |
| `email_verified_at` | TIMESTAMPTZ | | |
| `password_hash` | VARCHAR(255) | | NULL if OAuth-only |
| `name` | VARCHAR(255) | NOT NULL | |
| `avatar_url` | TEXT | | |
| `phone` | VARCHAR(30) | | E.164 format |
| `totp_secret` | TEXT | | Encrypted at rest (AES-256-GCM). NEVER returned in API responses. |
| `totp_enabled` | BOOLEAN | NOT NULL, DEFAULT FALSE | |
| `mfa_backup_codes` | TEXT[] | NOT NULL, DEFAULT '{}' | 8 bcrypt-hashed backup codes. NEVER returned in API responses. |
| `mfa_backup_codes_generated_at` | TIMESTAMPTZ | | Set when backup codes are generated |
| `is_platform_admin` | BOOLEAN | NOT NULL, DEFAULT FALSE | Cross-tenant |
| `status` | VARCHAR(20) | NOT NULL, CHECK | `active`, `suspended`, `deleted` |
| `failed_login_attempts` | INTEGER | NOT NULL, DEFAULT 0 | |
| `locked_until` | TIMESTAMPTZ | | |
| `last_login_at` | TIMESTAMPTZ | | |
| `password_changed_at` | TIMESTAMPTZ | | Used for O(1) session invalidation |
| `consent_tos_version` | VARCHAR(20) | | |
| `consent_tos_at` | TIMESTAMPTZ | | |
| `privacy_policy_version` | VARCHAR(20) | | |
| `deleted_at` | TIMESTAMPTZ | | |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Managed by trigger |

**Indexes:** `email` UNIQUE (partial: WHERE deleted_at IS NULL), `status`, `deleted_at`

**Security rule:** The fields `totp_secret`, `mfa_backup_codes`, and `password_hash` MUST be explicitly excluded from all User module API response serializers via an explicit `sanitizeUser()` allowlist function. They must never appear in any HTTP response body.

---

### 1.3 OrganizationMembership

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, NOT NULL | |
| `org_id` | UUID | NOT NULL, FK → Organization | |
| `user_id` | UUID | NOT NULL, FK → User | |
| `role` | VARCHAR(20) | NOT NULL, CHECK | `org_owner`, `org_admin`, `member`, `guest` |
| `status` | VARCHAR(20) | NOT NULL, CHECK | `active`, `suspended`, `removed` |
| `invited_by` | UUID | FK → User | |
| `joined_at` | TIMESTAMPTZ | | |
| `removed_at` | TIMESTAMPTZ | | |
| `deleted_at` | TIMESTAMPTZ | | |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Managed by trigger |

**Indexes:** `(org_id, user_id)` PARTIAL UNIQUE WHERE `deleted_at IS NULL` (CONSISTENCY-004 fix — allows re-adding a removed user), `org_id`, `user_id`, `deleted_at`

**Constraint note:** The uniqueness constraint MUST be a partial unique index, NOT a table-level UNIQUE constraint. SQL: `CREATE UNIQUE INDEX idx_memberships_org_user_active ON org_memberships(org_id, user_id) WHERE deleted_at IS NULL;`

---

### 1.4 Workspace (Project)

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, NOT NULL | |
| `org_id` | UUID | NOT NULL, FK → Organization | |
| `name` | VARCHAR(255) | NOT NULL | |
| `description` | TEXT | | |
| `status` | VARCHAR(20) | NOT NULL, CHECK | `active`, `archived` |
| `owner_user_id` | UUID | NOT NULL, FK → User | |
| `deleted_at` | TIMESTAMPTZ | | |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Managed by trigger |
| `version` | INTEGER | NOT NULL, DEFAULT 1 | |

**Indexes:** `org_id`, `owner_user_id`, `deleted_at`

---

### 1.5 Board / Sprint

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, NOT NULL | |
| `org_id` | UUID | NOT NULL, FK → Organization | |
| `workspace_id` | UUID | NOT NULL, FK → Workspace | |
| `name` | VARCHAR(255) | NOT NULL | |
| `type` | VARCHAR(10) | NOT NULL, CHECK | `board`, `sprint` |
| `status` | VARCHAR(20) | NOT NULL, CHECK | `active`, `completed`, `archived` |
| `start_date` | DATE | | |
| `end_date` | DATE | | |
| `deleted_at` | TIMESTAMPTZ | | |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Managed by trigger |
| `version` | INTEGER | NOT NULL, DEFAULT 1 | |

**Indexes:** `org_id`, `workspace_id`, `deleted_at`

---

### 1.6 Task

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, NOT NULL | |
| `org_id` | UUID | NOT NULL, FK → Organization | |
| `workspace_id` | UUID | NOT NULL, FK → Workspace | |
| `board_id` | UUID | FK → Board | |
| `parent_task_id` | UUID | FK → Task | NULL = root task |
| `depth` | INTEGER | NOT NULL, DEFAULT 0, CHECK (0–2) | 0=task, 1=subtask, 2=sub-subtask |
| `title` | VARCHAR(500) | NOT NULL | |
| `description` | JSONB | | Rich text as ProseMirror JSON |
| `status` | VARCHAR(20) | NOT NULL, CHECK | `todo`, `in_progress`, `in_review`, `done`, `cancelled` |
| `priority` | VARCHAR(10) | NOT NULL, DEFAULT 'medium', CHECK | `low`, `medium`, `high`, `urgent` |
| `creator_id` | UUID | NOT NULL, FK → User | |
| `due_date` | TIMESTAMPTZ | | |
| `completed_at` | TIMESTAMPTZ | | |
| `is_recurring` | BOOLEAN | NOT NULL, DEFAULT FALSE | |
| `recurrence_rule` | TEXT | | RRULE string (RFC 5545) |
| `recurrence_parent_id` | UUID | FK → Task | Links recurring instances |
| `template_id` | UUID | FK → TaskTemplate | |
| `labels` | TEXT[] | NOT NULL, DEFAULT '{}' | |
| `attachments_count` | INTEGER | NOT NULL, DEFAULT 0 | Denormalized |
| `search_vector` | tsvector | GENERATED ALWAYS AS STORED | See BUG-NEW-001 fix below |
| `deleted_at` | TIMESTAMPTZ | | |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Managed by trigger |
| `version` | INTEGER | NOT NULL, DEFAULT 1 | |

**Constraint:** `depth` MUST be 0, 1, or 2. Enforced at service layer AND via `CHECK (depth >= 0 AND depth <= 2)` constraint.
**Constraint (COMPLETENESS-007 fix):** Recurring task deduplication: `CREATE UNIQUE INDEX idx_tasks_recurrence_dedup ON tasks(recurrence_parent_id, (due_date::date)) WHERE recurrence_parent_id IS NOT NULL AND deleted_at IS NULL;` — MUST be created in migration `005_tasks.js`.

**Migration note (BUG-NEW-001 fix):** The `search_vector` generated column MUST use a recursive `jsonb_to_search_text(j JSONB)` function. Naive `jsonb_each_text` is prohibited — it only reaches top-level keys, missing nested ProseMirror text nodes. The correct recursive CTE implementation (with depth limit to prevent infinite loops on malformed documents):

```sql
CREATE OR REPLACE FUNCTION jsonb_to_search_text(j JSONB) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  WITH RECURSIVE nodes(node, depth) AS (
    SELECT j, 0
    UNION ALL
    SELECT elem, nodes.depth + 1
    FROM nodes,
         jsonb_array_elements(
           CASE WHEN jsonb_typeof(nodes.node) = 'array'
                THEN nodes.node
                ELSE '[]'::jsonb
           END
         ) AS elem
    WHERE nodes.depth < 20
    UNION ALL
    SELECT val, nodes.depth + 1
    FROM nodes,
         jsonb_each(
           CASE WHEN jsonb_typeof(nodes.node) = 'object'
                THEN nodes.node
                ELSE '{}'::jsonb
           END
         ) AS kv(k, val)
    WHERE nodes.depth < 20
  )
  SELECT coalesce(
    string_agg(node #>> '{}', ' ') FILTER (WHERE jsonb_typeof(node) = 'string'),
    ''
  )
  FROM nodes
$$;
```

The depth limit of 20 prevents runaway recursion on deeply nested or malformed documents. Any real ProseMirror document exceeding depth 20 is pathological and its deep text will not be indexed — this is an acceptable trade-off versus a runaway query.

**Indexes:** `org_id`, `workspace_id`, `board_id`, `parent_task_id`, `due_date`, `deleted_at`, `created_at`, GIN on `labels`, GIN on `search_vector`

---

### 1.7 TaskAssignee (Junction)

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `task_id` | UUID | NOT NULL, FK → Task | |
| `user_id` | UUID | NOT NULL, FK → User | |
| `org_id` | UUID | NOT NULL, FK → Organization | Denormalized for fast scoping |
| `assigned_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| `assigned_by` | UUID | NOT NULL, FK → User | |

**PK:** `(task_id, user_id)` | **Indexes:** `org_id`, `user_id`

---

### 1.8 TaskDependency

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, NOT NULL | |
| `org_id` | UUID | NOT NULL, FK → Organization | |
| `blocking_task_id` | UUID | NOT NULL, FK → Task | |
| `blocked_task_id` | UUID | NOT NULL, FK → Task | |
| `created_by` | UUID | NOT NULL, FK → User | |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |

**Constraint:** `CHECK (blocking_task_id != blocked_task_id)`. No circular chains — enforced at service layer via DFS.
**Indexes:** `org_id`, `blocking_task_id`, `blocked_task_id`

---

### 1.9 Comment

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, NOT NULL | |
| `org_id` | UUID | NOT NULL, FK → Organization | |
| `task_id` | UUID | NOT NULL, FK → Task | |
| `author_id` | UUID | NOT NULL, FK → User | |
| `parent_comment_id` | UUID | FK → Comment | NULL = top-level; max 1 level deep |
| `body` | JSONB | NOT NULL | Rich text |
| `is_edited` | BOOLEAN | NOT NULL, DEFAULT FALSE | |
| `edited_at` | TIMESTAMPTZ | | |
| `deleted_at` | TIMESTAMPTZ | | Soft delete |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Managed by trigger |

**Indexes:** `org_id`, `task_id`, `deleted_at`

---

### 1.10 Channel

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, NOT NULL | |
| `org_id` | UUID | NOT NULL, FK → Organization | |
| `type` | VARCHAR(10) | NOT NULL, CHECK | `direct`, `group` |
| `name` | VARCHAR(255) | | NULL for direct channels |
| `created_by` | UUID | NOT NULL, FK → User | |
| `deleted_at` | TIMESTAMPTZ | | |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Managed by trigger |

**Constraint:** `type = 'direct'` → exactly 2 members; `name` MUST be NULL.
**Constraint:** `type = 'group'` → 2+ members; `name` MUST NOT be NULL.
**Indexes:** `org_id`, `deleted_at`

**Per-channel sequence (scale note):** On channel creation, call `CREATE SEQUENCE IF NOT EXISTS channel_seq_{channelIdNoDashes}` via the `create_channel_sequence(UUID)` function defined in migration `014_misc.js`. On channel deletion (soft), schedule sequence DROP via cleanup worker after 30-day grace period. At scale (>100K channels), migrate to Redis INCR with DB high-water mark sync.

---

### 1.11 ChannelMember

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `channel_id` | UUID | NOT NULL, FK → Channel | |
| `user_id` | UUID | NOT NULL, FK → User | |
| `org_id` | UUID | NOT NULL, FK → Organization | |
| `last_read_sequence` | BIGINT | NOT NULL, DEFAULT 0 | |
| `last_read_at` | TIMESTAMPTZ | | |
| `joined_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| `removed_at` | TIMESTAMPTZ | | |

**PK:** `(channel_id, user_id)` | **Indexes:** `org_id`, `user_id`

**Direct channel deduplication (COMPLETENESS-008 fix):** A separate `direct_channel_pairs` table enforces the one-direct-channel-per-user-pair invariant:

```sql
CREATE TABLE direct_channel_pairs (
  org_id     UUID NOT NULL REFERENCES organizations(id),
  user_a_id  UUID NOT NULL REFERENCES users(id),
  user_b_id  UUID NOT NULL REFERENCES users(id),
  channel_id UUID NOT NULL UNIQUE REFERENCES channels(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, user_a_id, user_b_id),
  CHECK (user_a_id < user_b_id)
);
CREATE INDEX idx_dcp_org ON direct_channel_pairs(org_id);
```

When creating a direct channel, insert with `user_a_id = LEAST(userId1, userId2)`, `user_b_id = GREATEST(userId1, userId2)`. On PK conflict, return the existing channel (409 with existing channel_id). Created in migration `006_channels.js`.

---

### 1.12 ChatMessage

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | NOT NULL | PK component |
| `org_id` | UUID | NOT NULL | Partition assist |
| `channel_id` | UUID | NOT NULL, FK → Channel | |
| `sender_id` | UUID | NOT NULL, FK → User | |
| `client_message_id` | UUID | NOT NULL | Client-generated, for idempotency |
| `sequence_number` | BIGINT | NOT NULL | Server-assigned monotonic per channel |
| `body` | TEXT | NOT NULL | |
| `body_parsed` | JSONB | | Parsed AST with mention refs |
| `parent_message_id` | UUID | | Thread reply — enforced at app layer |
| `is_edited` | BOOLEAN | NOT NULL, DEFAULT FALSE | |
| `edit_history` | JSONB[] | NOT NULL, DEFAULT '{}' | Array of `{body, edited_at}` |
| `deleted_at` | TIMESTAMPTZ | | |
| `created_at` | TIMESTAMPTZ | NOT NULL | Partition key |
| `search_vector` | tsvector | GENERATED ALWAYS AS STORED | `to_tsvector('english', coalesce(body,''))` |

**PK:** `(id, created_at)` — must include partition key.
**Partitioned by:** RANGE on `created_at` per month.

**Partition pre-creation requirement:** At migration time, create default partition + current month + next 3 months. Monthly BullMQ job (registered in `worker.ts`) creates next month's partition idempotently using `CREATE TABLE IF NOT EXISTS`. The job runs daily (not just the 1st of the month) to handle job failures. A `chat_messages_default` catch-all partition MUST always exist.

**Application-layer constraints (BUG-NEW-005 fix):** `parent_message_id` self-referential FK enforced at application layer only (cross-partition FKs unsupported in PostgreSQL declarative partitioning). Application MUST query for the parent message across ALL partitions (no partition filter) before accepting a thread reply. Required integration test: "thread reply to a message in a different calendar month is handled correctly."

**Indexes (on each partition and default):** `(channel_id, sequence_number)`, `(channel_id, client_message_id)`, `org_id`, `deleted_at`, GIN on `search_vector`

---

### 1.13 Notification

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, NOT NULL | |
| `org_id` | UUID | NOT NULL, FK → Organization | |
| `user_id` | UUID | NOT NULL, FK → User | Recipient |
| `type` | VARCHAR(100) | NOT NULL | See §7 for complete enum |
| `entity_type` | VARCHAR(50) | NOT NULL | `task`, `message`, `comment`, `member` |
| `entity_id` | UUID | NOT NULL | |
| `actor_id` | UUID | FK → User | Who triggered it |
| `payload` | JSONB | NOT NULL | Additional context |
| `is_read` | BOOLEAN | NOT NULL, DEFAULT FALSE | |
| `read_at` | TIMESTAMPTZ | | |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |

**Indexes:** `(org_id, user_id, is_read, created_at DESC)`, `entity_id`

---

### 1.14 NotificationPreference

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, NOT NULL | |
| `org_id` | UUID | NOT NULL, FK → Organization | |
| `user_id` | UUID | NOT NULL, FK → User | |
| `event_type` | VARCHAR(100) | NOT NULL | See §7 for complete enum |
| `channel_inapp` | BOOLEAN | NOT NULL, DEFAULT TRUE | |
| `channel_email` | BOOLEAN | NOT NULL, DEFAULT TRUE | |
| `channel_push` | BOOLEAN | NOT NULL, DEFAULT FALSE | Future |
| `digest_mode` | VARCHAR(20) | NOT NULL, DEFAULT 'realtime', CHECK | `realtime`, `daily_digest` |
| `quiet_hours_start` | TIME | | e.g. `22:00` |
| `quiet_hours_end` | TIME | | e.g. `08:00` |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Managed by trigger |

**Constraint:** `(org_id, user_id, event_type)` UNIQUE. **Indexes:** `(org_id, user_id)`

---

### 1.15 Subscription

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, NOT NULL | |
| `org_id` | UUID | NOT NULL, UNIQUE, FK → Organization | One per org |
| `razorpay_subscription_id` | VARCHAR(255) | UNIQUE | |
| `plan_tier` | VARCHAR(20) | NOT NULL, DEFAULT 'free', CHECK | `free`, `pro`, `business`, `enterprise` |
| `status` | VARCHAR(20) | NOT NULL, DEFAULT 'active', CHECK | `active`, `halted`, `cancelled`, `expired`, `pending` |
| `current_period_start` | TIMESTAMPTZ | | |
| `current_period_end` | TIMESTAMPTZ | | |
| `cancel_at_period_end` | BOOLEAN | NOT NULL, DEFAULT FALSE | |
| `cancelled_at` | TIMESTAMPTZ | | |
| `trial_end` | TIMESTAMPTZ | | |
| `metadata` | JSONB | NOT NULL, DEFAULT '{}' | |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Managed by trigger |

---

### 1.16 Payment

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, NOT NULL | |
| `org_id` | UUID | NOT NULL, FK → Organization | No CASCADE DELETE |
| `subscription_id` | UUID | FK → Subscription | |
| `razorpay_order_id` | VARCHAR(255) | NOT NULL, UNIQUE | |
| `razorpay_payment_id` | VARCHAR(255) | UNIQUE | |
| `amount_paise` | INTEGER | NOT NULL | |
| `currency` | VARCHAR(3) | NOT NULL, DEFAULT 'INR' | |
| `status` | VARCHAR(20) | NOT NULL, CHECK | `created`, `authorized`, `captured`, `failed`, `refunded`, `disputed` |
| `failure_reason` | TEXT | | |
| `captured_at` | TIMESTAMPTZ | | |
| `refunded_at` | TIMESTAMPTZ | | |
| `idempotency_key` | VARCHAR(255) | NOT NULL, UNIQUE | |
| `metadata` | JSONB | NOT NULL, DEFAULT '{}' | |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Managed by trigger |

**Retention:** Minimum 7 years. GDPR erasure jobs MUST NOT delete or anonymize payment rows.

---

### 1.17 File

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, NOT NULL | |
| `org_id` | UUID | NOT NULL, FK → Organization | |
| `uploader_id` | UUID | NOT NULL, FK → User | |
| `filename` | VARCHAR(500) | NOT NULL | |
| `mime_type` | VARCHAR(255) | NOT NULL | |
| `size_bytes` | BIGINT | NOT NULL | |
| `storage_key` | UUID | NOT NULL, UNIQUE, DEFAULT gen_random_uuid() | UUID used as S3 key |
| `storage_provider` | VARCHAR(10) | NOT NULL, DEFAULT 'local', CHECK | `local`, `s3` |
| `status` | VARCHAR(20) | NOT NULL, DEFAULT 'pending', CHECK | `pending`, `confirmed`, `quarantined`, `deleted` |
| `scan_status` | VARCHAR(20) | NOT NULL, DEFAULT 'pending', CHECK | `pending`, `clean`, `infected` |
| `scan_completed_at` | TIMESTAMPTZ | | |
| `linked_entity_type` | VARCHAR(50) | | |
| `linked_entity_id` | UUID | | |
| `deleted_at` | TIMESTAMPTZ | | |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |

No `updated_at` column (append-only after confirmation).

**Download rule (CONSISTENCY-005 fix):**
- `scan_status = 'pending'` → return `202 Accepted` with `Retry-After: 30` header and body `{ "message": "File scan in progress", "retry_after": 30 }`. MUST NOT return the file.
- `status = 'confirmed'` AND `scan_status = 'clean'` → return presigned download URL (1-hour TTL).
- `scan_status = 'infected'` or `status = 'quarantined'` → `422 FILE_QUARANTINED`.

---

### 1.18 AuditLog

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | NOT NULL | PK component |
| `org_id` | UUID | | NULL for platform-level events |
| `actor_id` | UUID | | NULL after GDPR erasure |
| `actor_type` | VARCHAR(20) | NOT NULL, CHECK | `user`, `system`, `platform_admin` |
| `event_type` | VARCHAR(150) | NOT NULL | |
| `entity_type` | VARCHAR(50) | | |
| `entity_id` | UUID | | |
| `ip_address` | INET | | |
| `user_agent` | TEXT | | |
| `payload` | JSONB | NOT NULL, DEFAULT '{}' | |
| `correlation_id` | UUID | | |
| `occurred_at` | TIMESTAMPTZ | NOT NULL | Partition key |

**PK:** `(id, occurred_at)` — partition key required.
**Partitioned by:** RANGE on `occurred_at` per month. Monthly partitions MUST be pre-created (12 months ahead) at deployment and managed by the daily cleanup worker (idempotent `CREATE TABLE IF NOT EXISTS`). A `audit_logs_default` catch-all partition MUST always exist.

**Immutability (COMPLETENESS-005 fix):**
1. `ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY; CREATE POLICY audit_insert_only ON audit_logs FOR INSERT TO app_db_user WITH CHECK (true);`
2. `REVOKE UPDATE ON audit_logs FROM app_db_user;`
3. `REVOKE DELETE ON audit_logs FROM app_db_user;`
4. CI grep test: `grep -r "UPDATE.*audit_logs\|DELETE.*audit_logs" src/` MUST return empty.
5. `AuditRepository.append()` is the ONLY write method.

**Retention cleanup:** Use `DROP TABLE IF EXISTS audit_logs_YYYY_MM` for expired partitions. NEVER use `DELETE FROM audit_logs` — this is O(n) on the default partition and violates the immutability principle.

---

### 1.19 OutboxEvent

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, NOT NULL | |
| `org_id` | UUID | | NULL for platform events |
| `event_type` | VARCHAR(150) | NOT NULL | |
| `version` | INTEGER | NOT NULL, DEFAULT 1 | Schema version |
| `entity_type` | VARCHAR(50) | | |
| `entity_id` | UUID | | |
| `actor_user_id` | UUID | | |
| `correlation_id` | UUID | | |
| `payload` | JSONB | NOT NULL, DEFAULT '{}' | |
| `status` | VARCHAR(20) | NOT NULL, DEFAULT 'pending', CHECK | `pending`, `published`, `failed` |
| `occurred_at` | TIMESTAMPTZ | NOT NULL | |
| `published_at` | TIMESTAMPTZ | | |
| `retry_count` | INTEGER | NOT NULL, DEFAULT 0 | |
| `last_error` | TEXT | | |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |

**Indexes:** `(status, created_at)` composite, `entity_id`
**Cleanup:** Published events older than 7 days and failed events older than 30 days deleted by cleanup worker.

---

### 1.20 RefreshToken

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, NOT NULL | |
| `user_id` | UUID | NOT NULL, FK → User | |
| `org_id` | UUID | | Context org |
| `token_hash` | VARCHAR(255) | NOT NULL, UNIQUE | SHA-256 of raw token |
| `family_id` | UUID | NOT NULL | Token family for rotation detection |
| `is_revoked` | BOOLEAN | NOT NULL, DEFAULT FALSE | |
| `revoked_at` | TIMESTAMPTZ | | |
| `expires_at` | TIMESTAMPTZ | NOT NULL | |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |

**Indexes:** `token_hash` (UNIQUE), `user_id`, `family_id`, `expires_at`

---

### 1.21 UserPreferences

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `user_id` | UUID | PK, NOT NULL, FK → User | 1:1 with User |
| `timezone` | VARCHAR(64) | NOT NULL, DEFAULT 'UTC' | IANA tz string |
| `locale` | VARCHAR(16) | NOT NULL, DEFAULT 'en-US' | BCP 47 |
| `theme` | VARCHAR(20) | NOT NULL, DEFAULT 'system' | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Managed by trigger |

---

### 1.22 AuthProvider

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, NOT NULL | |
| `user_id` | UUID | NOT NULL, FK → User | |
| `provider` | VARCHAR(20) | NOT NULL, CHECK | `email`, `google`, `saml`, `magic_link` |
| `provider_user_id` | VARCHAR(255) | NOT NULL | External ID |
| `org_id` | UUID | FK → Organization | Required for SAML |
| `metadata` | JSONB | NOT NULL, DEFAULT '{}' | |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |

**Constraint:** `(provider, provider_user_id)` UNIQUE.
**Indexes:** `user_id`, `(provider, provider_user_id)`

---

### 1.23 SamlUsedAssertion

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `assertion_id` | VARCHAR(255) | NOT NULL | |
| `org_id` | UUID | NOT NULL, FK → Organization | |
| `not_on_or_after` | TIMESTAMPTZ | NOT NULL | Used only by cleanup job |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |

**PK:** `(assertion_id, org_id)`. **Indexes:** `not_on_or_after` (for cleanup).

**Replay check (CONSISTENCY-003 fix):** On SAML callback: `SELECT 1 FROM saml_used_assertions WHERE assertion_id = $id AND org_id = $orgId`. If ANY row found → `400 SAML_ASSERTION_REPLAYED`. Do NOT check `not_on_or_after` in the gate — presence is the complete and sufficient signal.

**Cleanup (security buffer fix — audit issue 3.5):** Cleanup job purges rows where `not_on_or_after < NOW() - INTERVAL '24 hours'`. The 24-hour buffer ensures that assertions that just expired are retained for one full day, preventing a window where the cleanup removes an assertion before any in-flight delayed delivery can replay it.

---

### 1.24 Invitation

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, NOT NULL | |
| `org_id` | UUID | NOT NULL, FK → Organization | |
| `invited_by` | UUID | NOT NULL, FK → User | |
| `email` | VARCHAR(255) | NOT NULL | |
| `role` | VARCHAR(20) | NOT NULL, CHECK | `org_admin`, `member`, `guest` |
| `token_hash` | VARCHAR(255) | NOT NULL, UNIQUE | HMAC-SHA256 of raw token using `INVITE_SECRET` |
| `status` | VARCHAR(20) | NOT NULL, DEFAULT 'pending', CHECK | `pending`, `accepted`, `expired`, `revoked` |
| `expires_at` | TIMESTAMPTZ | NOT NULL | |
| `accepted_at` | TIMESTAMPTZ | | |
| `revoked_at` | TIMESTAMPTZ | | |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |

**Indexes:** `org_id`, `email`, `token_hash` (UNIQUE), `status`

---

### 1.25 WebhookSubscription

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, NOT NULL | |
| `org_id` | UUID | NOT NULL, FK → Organization | |
| `url` | TEXT | NOT NULL | HTTPS only |
| `secret_hash` | TEXT | NOT NULL | bcrypt hash for UI display |
| `secret_encrypted` | TEXT | NOT NULL | Format: `v{N}:{base64_iv}:{base64_ciphertext}` |
| `secret_key_version` | INTEGER | NOT NULL, DEFAULT 1 | Which `ENCRYPTION_KEY` version was used (SEC-NEW-004) |
| `secret_preview` | VARCHAR(8) | NOT NULL | First 8 chars for display |
| `event_types` | TEXT[] | NOT NULL, DEFAULT '{}' | |
| `is_active` | BOOLEAN | NOT NULL, DEFAULT TRUE | |
| `created_by` | UUID | NOT NULL, FK → User | |
| `deleted_at` | TIMESTAMPTZ | | |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Managed by trigger |

---

### 1.26 WebhookDeliveryLog

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, NOT NULL | |
| `webhook_id` | UUID | NOT NULL, FK → WebhookSubscription | |
| `org_id` | UUID | NOT NULL, FK → Organization | |
| `event_id` | UUID | NOT NULL | OutboxEvent.id |
| `event_type` | VARCHAR(150) | NOT NULL | |
| `status` | VARCHAR(20) | NOT NULL, DEFAULT 'pending', CHECK | `pending`, `delivered`, `failed`, `exhausted` |
| `attempt_count` | INTEGER | NOT NULL, DEFAULT 0 | |
| `response_status_code` | INTEGER | | |
| `response_body` | TEXT | | |
| `error_message` | TEXT | | |
| `delivered_at` | TIMESTAMPTZ | | |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Managed by trigger |

**Constraint:** `UNIQUE (webhook_id, event_id)`

---

### 1.27 FeatureFlag

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, NOT NULL | |
| `key` | VARCHAR(100) | NOT NULL, UNIQUE | |
| `description` | TEXT | | |
| `is_globally_enabled` | BOOLEAN | NOT NULL, DEFAULT FALSE | |
| `rollout_percentage` | INTEGER | NOT NULL, DEFAULT 0, CHECK (0–100) | |
| `enabled_org_ids` | UUID[] | NOT NULL, DEFAULT '{}', CHECK (array_length < 10000) | SCALE-NEW-004 fix |
| `disabled_org_ids` | UUID[] | NOT NULL, DEFAULT '{}', CHECK (array_length < 10000) | |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Managed by trigger |

---

### 1.28 IdempotencyKey

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, NOT NULL | |
| `key_hash` | VARCHAR(255) | NOT NULL, UNIQUE | SHA-256 of raw key |
| `org_id` | UUID | | |
| `user_id` | UUID | | |
| `endpoint` | VARCHAR(200) | NOT NULL | |
| `response_status` | INTEGER | | |
| `response_body` | JSONB | | |
| `expires_at` | TIMESTAMPTZ | NOT NULL | |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |

---

### 1.29 TaskTemplate

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, NOT NULL | |
| `org_id` | UUID | NOT NULL, FK → Organization | |
| `name` | VARCHAR(255) | NOT NULL | |
| `default_title` | VARCHAR(500) | | |
| `default_description` | JSONB | | |
| `default_priority` | VARCHAR(10) | CHECK | `low`, `medium`, `high`, `urgent` |
| `default_labels` | TEXT[] | NOT NULL, DEFAULT '{}' | |
| `created_by` | UUID | NOT NULL, FK → User | |
| `deleted_at` | TIMESTAMPTZ | | |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |

---

### 1.30 MfaBackupCode (Embedded in users.mfa_backup_codes)

MFA backup codes are stored as a `TEXT[]` array in `users.mfa_backup_codes`. Each element is a bcrypt hash (cost 10) of a 10-character alphanumeric code. Generation produces 8 codes. Each code is single-use: after successful use, the matching hash is removed from the array. `mfa_backup_codes_generated_at` records when codes were last generated. This is a fully implemented feature, not a placeholder.

---

### 1.31 VideoCall (C-07 fix — was missing from SPEC)

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, NOT NULL | |
| `org_id` | UUID | NOT NULL, FK → Organization | |
| `channel_id` | UUID | FK → Channel | NULL if standalone call |
| `initiator_id` | UUID | NOT NULL, FK → User | |
| `state` | VARCHAR(20) | NOT NULL, DEFAULT 'ringing', CHECK | `ringing`, `active`, `ended` |
| `started_at` | TIMESTAMPTZ | | Set when state transitions to `active` |
| `ended_at` | TIMESTAMPTZ | | Set when state transitions to `ended` |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |

**Indexes:** `org_id`, `channel_id`, `state`
**Redis state:** `call:state:{callId}` hash with 4-hour TTL for real-time relay. DB is source of truth for completed calls.
**Note:** Platform handles WebRTC signaling only — no media storage.

---

### 1.32 Token Storage for Auth Flows (audit issues 2.6, 2.7, 2.8)

**Magic link tokens, password reset tokens, and email verification tokens** are all stored in Redis (not in a DB table). This provides simple TTL-based expiry and single-use invalidation by key deletion. Storage is ephemeral by design — if Redis is restarted, all outstanding tokens are invalidated, requiring the user to request a new token. This is the accepted trade-off for simplicity over a DB table approach.

| Token Type | Redis Key | TTL | Value |
|---|---|---|---|
| Email verification | `email_verify:{sha256_of_token}` | 86400s (24h) | `userId` |
| Password reset | `pwd_reset:{sha256_of_token}` | 3600s (1h) | `userId` |
| Magic link | `magic:{sha256_of_token}` | 900s (15min) | `{ userId, orgId }` JSON |

**Key operations:** On use → delete key (one-time use). On expiry → Redis TTL handles cleanup automatically. On Redis restart → tokens are lost; user receives `401 TOKEN_EXPIRED` and must request new token. Document in `RUNBOOK.md` that Redis persistence (`appendonly yes`) mitigates restart losses.

---

### 1.33 TaskActivityLog

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, NOT NULL | |
| `org_id` | UUID | NOT NULL, FK → Organization | |
| `task_id` | UUID | NOT NULL, FK → Task | |
| `actor_id` | UUID | NOT NULL, FK → User | |
| `event_type` | VARCHAR(100) | NOT NULL | e.g. `task.created`, `status_changed` |
| `payload` | JSONB | NOT NULL, DEFAULT '{}' | |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |

**Indexes:** `task_id`, `org_id`

---

## 2. Relationships & Ownership Boundaries

```
Platform (singleton)
  └── Organization [1]
        ├── OrganizationMembership [N] ←→ User [N]
        ├── Workspace [N]
        │     └── Board [N]
        │           └── Task [N]
        │                 ├── TaskAssignee [N] ←→ User [N]
        │                 ├── TaskDependency [N] (self-referential)
        │                 ├── Comment [N]
        │                 ├── TaskActivityLog [N]
        │                 └── TaskTemplate [N]
        ├── Channel [N]
        │     ├── ChannelMember [N] ←→ User [N]
        │     ├── DirectChannelPair [0..1] (for type='direct')
        │     ├── ChatMessage [N] (partitioned)
        │     └── VideoCall [N]
        ├── Notification [N] → User
        ├── NotificationPreference [N] → User
        ├── Subscription [1]
        ├── Payment [N]
        ├── File [N]
        ├── Invitation [N]
        ├── WebhookSubscription [N]
        ├── WebhookDeliveryLog [N]
        ├── FeatureFlag [N:N via enabled_org_ids]
        └── AuditLog [N] (partitioned, immutable)

User [1]
  ├── AuthProvider [N]
  ├── RefreshToken [N]
  └── UserPreferences [1]
```

---

## 3. Multi-Tenant Isolation Rules

### 3.1 Hard Rules

1. Every tenant-owned table MUST have a non-nullable `org_id` column with a FK to `organizations`.
2. Every repository method MUST accept `org_id` as a required parameter and include it in every WHERE clause.
3. No repository method may return data from multiple orgs in a single call (except platform_admin paths).
4. Service layer MUST verify `org_id` matches the authenticated user's context org before any repository call.
5. Background jobs MUST carry and enforce `org_id` when processing tenant data.
6. Socket room names for tenant data MUST include `org_id` as a prefix: `org:{org_id}:...`.

### 3.2 Enforcement at Each Layer

| Layer | Enforcement |
|---|---|
| HTTP Controller | Extract `org_id` from authenticated token; reject if mismatch |
| Service | Assert `resource.org_id === contextOrgId` before any mutation |
| Repository | Always append `AND org_id = $param` to all queries |
| BullMQ Job | `org_id` included in job payload; validated before DB access |
| Socket.IO | Session bound to `(user_id, org_id)`; rooms prefixed with `org_id` |
| Webhook handler | `org_id` from event payload; validated against subscription |

### 3.3 Tenant Lifecycle States

| State | Auth | Read Tasks | Write Tasks | Chat | Payments | Sockets |
|---|---|---|---|---|---|---|
| `active` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `suspended` | ✓ | ✓ | ✗ | ✗ | ✓ (recovery) | ✗ |
| `offboarding` | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| `deleted` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

---

## 4. Business Rules & Invariants

### 4.1 Tenant & Organization

- `INV-ORG-01`: An org MUST have exactly one `org_owner` at all times.
- `INV-ORG-02`: Tenant creation MUST atomically provision: org record, default workspace, default role assignment, default notification preferences for all standard event types (see §7), subscription record.
- `INV-ORG-03`: `org.storage_used_bytes` updated atomically: `UPDATE organizations SET storage_used_bytes = storage_used_bytes + $delta WHERE id = $orgId AND storage_used_bytes + $delta <= storage_quota_bytes RETURNING *`. Zero rows = quota exceeded.
- `INV-ORG-04`: Suspension and reactivation are idempotent.
- `INV-ORG-05`: An org cannot be hard-deleted. It transitions to `deleted`; PII anonymized.
- `INV-ORG-06`: All lifecycle transitions MUST emit an OutboxEvent.

### 4.2 User & Membership

- `INV-USR-01`: A user MUST NOT access org resources until `email_verified = TRUE`.
- `INV-USR-02`: A user MUST NOT be added beyond the org's `max_members` limit.
- `INV-USR-03`: A user can hold multiple org memberships, each with independent roles.
- `INV-USR-04`: After `account_lockout_attempts` consecutive failed logins, account is locked.
- `INV-USR-05`: Changing a password MUST: (1) bulk-revoke all existing refresh tokens in DB; (2) set `password_changed_at = NOW()`; (3) immediately delete Redis user cache key `user:cache:{userId}` via `await redisClient.del(...)` (SEC-NEW-001 fix — eliminates the 60-second stale-cache bypass window).
- `INV-AUTH-01`: A revoked refresh token re-presented MUST unconditionally trigger `revokeTokenFamily(familyId)` and return `401 TOKEN_FAMILY_REVOKED`. No sibling check.
- `INV-AUTH-02`: All token comparisons (magic link, password reset) MUST use `crypto.timingSafeEqual`.
- `INV-AUTH-03`: SAML replay uses presence-only check — `not_on_or_after` is NOT a gate condition.

### 4.3 Task

- `INV-TASK-01`: `depth` MUST be 0, 1, or 2.
- `INV-TASK-02`: `parent_task_id` must belong to the same `org_id` and `workspace_id`.
- `INV-TASK-03`: Task dependencies must not create cycles.
- `INV-TASK-04`: Bulk operations limited to 100 tasks per call.
- `INV-TASK-05`: Recurring task deduplication via `(recurrence_parent_id, due_date::date)` partial UNIQUE index.

### 4.4 Chat

- `INV-CHAT-01`: One direct channel per user pair per org, enforced via `direct_channel_pairs` PK.
- `INV-CHAT-02`: `sequence_number` strictly monotonically increasing per channel via PostgreSQL sequence.
- `INV-CHAT-03`: Duplicate `client_message_id` returns existing message without new row.
- `INV-CHAT-04`: A user MUST NOT create a direct message channel with themselves. If `creatorId === otherUserId`, the service MUST return `400 CANNOT_DM_SELF` before any database operation. Do not rely on the `direct_channel_pairs CHECK (user_a_id < user_b_id)` constraint — a self-reference produces a DB constraint violation (500) rather than a clean 400.

### 4.5 Files

- `INV-FILE-01`: Files with `scan_status = 'pending'` are NOT downloadable. Return `202 Accepted` with `Retry-After: 30`.
- `INV-FILE-02`: Storage quota reservation and file row insertion MUST be atomic. URL generation from storage provider happens BEFORE quota reservation (BUG-NEW-004 fix). If URL generation fails, quota is not touched and no DB row is created.
- `INV-FILE-03`: Virus-infected files transition to `status = 'quarantined'`, quota reclaimed, org admin notified.

### 4.6 MFA Backup Codes (CROSS-002 fix)

- `INV-MFA-01`: 8 backup codes generated per enrollment. Each code is single-use.
- `INV-MFA-02`: Each code stored as bcrypt hash (cost 10) in `users.mfa_backup_codes[]`.
- `INV-MFA-03`: Successful use removes matching hash from array and logs `user.backup_code_used` audit event.
- `INV-MFA-04`: When all 8 codes consumed, user must regenerate or use TOTP.
- `INV-MFA-05`: MFA reset procedure: platform admin can clear `totp_enabled`, `mfa_backup_codes`, `totp_secret` — requires org admin approval. Document in RUNBOOK.md.

---

## 5. State Machines

### 5.1 Organization Lifecycle

```
active → suspended       (payment failure grace period exhausted; or manual admin action)
active → offboarding     (deletion requested by org_owner)
suspended → active       (payment recovery)
offboarding → deleted    (30 days elapsed + PII anonymized)
deleted → (terminal)
```

**Suspension guard (BUG-NEW-003 fix):** The grace period check job and `suspendOrg` service method MUST verify `org.status === 'active'` before transitioning. If `status !== 'active'`: log WARN and return without emitting any outbox event. This prevents invalid transitions (e.g. `offboarding → suspended`).

**grace_period_ends_at setter (audit issue 3.2):** `grace_period_ends_at` is NOT set in the Organization domain model itself — it must be explicitly set by the payment worker when a `payment.failed` event is processed: `UPDATE organizations SET grace_period_ends_at = NOW() + INTERVAL '7 days' WHERE id = $orgId AND status = 'active'`. Without this, the grace period cron job never fires.

### 5.2 Task Lifecycle

```
todo → in_progress → in_review → done
todo → cancelled
in_progress → cancelled
in_review → in_progress   (rejection)
done → (terminal unless recurring)
cancelled → (terminal)
```

### 5.3 Recurring Task

On completing a recurring task: compute next occurrence via `rrule` npm library (RFC 5545). Check dedup index `(recurrence_parent_id, due_date::date)`. If next instance exists, skip creation silently.

### 5.4 File Upload Lifecycle

```
pending → confirmed          (client confirms upload completed)
pending → deleted            (cleanup job after 1 hour timeout; quota reclaimed)
confirmed + scan_pending → confirmed + scan_clean     (ClamAV passes)
confirmed + scan_pending → quarantined + scan_infected (ClamAV fails; quota reclaimed)
```

### 5.5 Payment Lifecycle

```
created → authorized → captured
created → failed
captured → refunded
captured → disputed
```

### 5.6 Subscription Lifecycle

```
pending → active
active → halted         (payment failure)
halted → active         (payment recovery)
active → cancelled      (tenant cancels)
cancelled → expired     (period end)
```

---

## 6. API Contracts

All endpoints use `/api/v1/` prefix. Authenticated endpoints require `Authorization: Bearer {access_token}` and `X-Org-ID: {org_id}` headers. All mutating endpoints (POST, PUT, PATCH) require `Idempotency-Key: {uuid_v4}` header. DELETE is excluded from Idempotency-Key requirement.

**Response envelope (success):**
```json
{ "data": { }, "meta": { "request_id": "uuid", "correlation_id": "uuid", "timestamp": "ISO-8601" } }
```

**Response envelope (error):**
```json
{ "error": { "code": "SNAKE_CASE_CODE", "message": "Human readable", "details": {} }, "meta": { "request_id": "uuid" } }
```

### 6.1 Auth Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/auth/register` | None | Email/password registration |
| POST | `/api/v1/auth/login` | None | Email/password login |
| POST | `/api/v1/auth/refresh` | None | Refresh token rotation |
| POST | `/api/v1/auth/logout` | Bearer | Logout + revoke tokens |
| GET | `/api/v1/auth/verify-email` | None | `?token=...` |
| POST | `/api/v1/auth/verify-email/resend` | Bearer | Resend verification |
| POST | `/api/v1/auth/password-reset/request` | None | Always 200 (no enumeration) |
| POST | `/api/v1/auth/password-reset/confirm` | None | |
| POST | `/api/v1/auth/oauth/google` | None | Google ID token exchange |
| POST | `/api/v1/auth/magic-link/request` | None | Always 200 |
| GET | `/api/v1/auth/magic-link/verify` | None | `?token=...` |
| GET | `/api/v1/auth/saml/:org_id/initiate` | None | Enterprise only |
| POST | `/api/v1/auth/saml/:org_id/callback` | None | SAML ACS |
| POST | `/api/v1/auth/mfa/enroll` | Bearer | TOTP enrollment |
| POST | `/api/v1/auth/mfa/confirm` | Bearer | Confirm TOTP |
| POST | `/api/v1/auth/mfa/verify` | Bearer | Verify TOTP code |
| POST | `/api/v1/auth/mfa/backup-codes/generate` | Bearer | Generate 8 backup codes |
| POST | `/api/v1/auth/mfa/backup-codes/use` | Bearer | Use a backup code |

### 6.2 User Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/me` | Bearer | Profile (NEVER includes totp_secret, password_hash, mfa_backup_codes) |
| PATCH | `/api/v1/me` | Bearer | Update profile |
| PATCH | `/api/v1/me/consent` | Bearer | Update ToS/Privacy consent |
| GET | `/api/v1/me/data-export` | Bearer | Enqueue GDPR export (202) |
| DELETE | `/api/v1/me` | Bearer | Enqueue GDPR erasure; requires `auth_time` within 5 min |

### 6.3 Organization Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/organizations` | Bearer | Create org |
| GET | `/api/v1/org/:org_id` | Bearer + OrgMember | Get org |
| PATCH | `/api/v1/org/:org_id` | Bearer + OrgAdmin | Update settings |
| GET | `/api/v1/org/:org_id/members` | Bearer + OrgMember | List members |
| POST | `/api/v1/org/:org_id/invitations` | Bearer + OrgAdmin | Invite |
| DELETE | `/api/v1/org/:org_id/invitations/:id` | Bearer + OrgAdmin | Revoke invite |
| POST | `/api/v1/org/:org_id/invitations/accept` | Bearer | Accept invitation |
| PATCH | `/api/v1/org/:org_id/members/:user_id/role` | Bearer + OrgAdmin | Change role |
| DELETE | `/api/v1/org/:org_id/members/:user_id` | Bearer + OrgAdmin | Remove member |
| POST | `/api/v1/org/:org_id/export` | Bearer + OrgAdmin | Enqueue org data export (202) |

### 6.4–6.13: Full Endpoint Tables

The complete REST API surface is documented in `dist/openapi.json` (generated via `npm run generate:openapi`). The document covers 82 paths and 96 operations across all modules. Refer to it as the authoritative endpoint reference. Swagger UI is served at `GET /api-docs` when the server is running.

Module coverage: Auth (§6.1), User (`GET /me`), Organization (§6.3), Workspace, Task (CRUD, dependencies, bulk, templates, comments, activity), Chat (direct/group channels, messages), Notification (in-app, preferences, unsubscribe), File (upload URL, download URL, list, metadata), Payment (orders, verify, history, subscription, Razorpay webhook), Search, Webhook (register, rotate secret, delete), Feature Flag (platform admin), Platform Admin (org management, user unlock, MFA reset, JWT rotation, queue management), GDPR (user export, erasure, org export, offboarding), Health (`/live`, `/ready`, `/health`).

---

## 7. Event Schemas and Notification Event Types

All outbox events follow:
```typescript
interface OutboxEventPayload {
  event_type: string;
  version: number;
  org_id?: string;
  entity_type: string;
  entity_id: string;
  actor_user_id?: string;
  correlation_id: string;
  payload: Record<string, unknown>;
  occurred_at: string; // ISO-8601 UTC
}
```

### 7.1 Complete Notification Event Type Enum (audit issue 2.9 fix)

The following is the **definitive enumeration** of all notification event types. `notification_preferences` rows MUST be seeded for each of these types when a new member joins an org.

```typescript
export const NOTIFICATION_EVENT_TYPES = [
  'task.assigned',
  'task.updated',
  'task.status_changed',
  'task.commented',
  'task.mentioned',
  'task.due_soon',
  'message.received',
  'mention.created',
  'member.joined',
  'member.removed',
  'file.quarantined',
  'org.suspended',
  'payment.failed',
  'invitation.created',
] as const;

export type NotificationEventType = typeof NOTIFICATION_EVENT_TYPES[number];
```

Default preferences when seeding (all event types): `{ channel_inapp: true, channel_email: true, channel_push: false, digest_mode: 'realtime', quiet_hours_start: null, quiet_hours_end: null }`.

### 7.2 Key Domain Events

| Event Type | Trigger | Key Payload Fields |
|---|---|---|
| `user.registered` | Registration | `user_id`, `email` |
| `user.email_verification_requested` | Register/resend | `user_id`, `email`, `token_hash`, `expires_at` (TTL 24h) |
| `user.password_reset_requested` | Password reset request | `user_id`, `email`, `reset_token_hash`, `expires_at` (TTL 1h) |
| `user.password_changed` | Password confirmed | `user_id` |
| `user.login` | Successful login | `user_id`, `org_id`, `ip_address` |
| `user.erased` | GDPR erasure complete | `user_id`, `scheduled_at` |
| `user.backup_code_used` | Backup code consumed | `user_id`, `codes_remaining` |
| `org.created` | Org creation | `org_id`, `owner_id` |
| `org.suspended` | Suspension | `org_id`, `reason` |
| `org.reactivated` | Reactivation | `org_id` |
| `org.offboarding_started` | Deletion requested | `org_id`, `offboarding_started_at` |
| `org.deleted` | Offboarding complete | `org_id` |
| `org.grace_period_started` | Payment failed | `org_id`, `grace_period_ends_at` |
| `invitation.created` | Invite sent | `org_id`, `invitation_id`, `email`, `role` |
| `member.joined` | Invite accepted | `org_id`, `user_id`, `role` |
| `task.created` | Task creation | `org_id`, `task_id`, `workspace_id` |
| `task.updated` | Task mutation | `org_id`, `task_id`, `changed_fields` |
| `task.assigned` | Assignment | `org_id`, `task_id`, `assignee_id` |
| `task.deleted` | Soft delete | `org_id`, `task_id` |
| `comment.created` | Comment | `org_id`, `task_id`, `comment_id`, `author_id` |
| `mention.created` | @mention | `org_id`, `entity_type`, `entity_id`, `mentioned_user_id`, `mentioned_by` |
| `message.created` | Chat message | `org_id`, `channel_id`, `message_id`, `sender_id` |
| `message.updated` | Edit | `org_id`, `channel_id`, `message_id` |
| `message.deleted` | Soft delete | `org_id`, `channel_id`, `message_id` |
| `file.confirmed` | Upload confirmed | `org_id`, `file_id`, `storage_key` |
| `file.quarantined` | Virus found | `org_id`, `file_id` |
| `file.deleted` | Soft delete | `org_id`, `file_id` |
| `payment.captured` | Razorpay webhook | `org_id`, `payment_id` |
| `payment.failed` | Razorpay webhook | `org_id`, `subscription_id`, `failure_reason` |
| `subscription.charged` | Razorpay webhook | `org_id`, `subscription_id` |

---

## 8. Idempotency Rules

- All POST, PUT, and PATCH requests to mutating endpoints MUST include `Idempotency-Key` header (UUID v4).
- DELETE requests are idempotent by HTTP definition and MUST NOT require `Idempotency-Key`.
- Keys stored hashed (SHA-256) in `idempotency_keys` table with 24-hour expiry.
- On duplicate key: return cached response (same status + body) without re-executing.
- Razorpay webhook events use `razorpay_event_id` as the idempotency key.

---

## 9. Authorization Rules

### 9.1 JWT Claims

```typescript
interface AccessTokenPayload {
  sub: string;               // user_id
  email: string;
  org_id: string;            // context org
  role: 'org_owner' | 'org_admin' | 'member' | 'guest';
  is_platform_admin: boolean;
  mfa_verified_at?: number;  // Unix timestamp — present only after MFA verification
  auth_time: number;         // Unix timestamp of authentication (COMPLETENESS-009 fix)
  jti: string;               // JWT ID for blacklisting
  kid: string;               // Key ID for rotation
  iat: number;
  exp: number;               // iat + 900 seconds
}
```

`auth_time` MUST be set to `Math.floor(Date.now() / 1000)` at moment of authentication (login, OAuth callback, magic link verify, SAML callback). NOT updated on token refresh. Required by GDPR erasure endpoint (`auth_time` must be within 5 minutes) and platform admin middleware (`mfa_verified_at` within 1 hour).

### 9.2 Permission Matrix

| Action | platform_admin | org_owner | org_admin | member | guest |
|---|---|---|---|---|---|
| View org | ✓ | ✓ | ✓ | ✓ | ✓ |
| Edit org settings | ✓ | ✓ | ✓ | ✗ | ✗ |
| Invite members | ✓ | ✓ | ✓ | ✗ | ✗ |
| Create workspace | ✓ | ✓ | ✓ | ✓ | ✗ |
| Delete workspace | ✓ | ✓ | ✓ | ✗ | ✗ |
| Create task | ✓ | ✓ | ✓ | ✓ | ✗ |
| Edit own task | ✓ | ✓ | ✓ | ✓ | ✗ |
| Edit any task | ✓ | ✓ | ✓ | ✗ | ✗ |
| Bulk task operations | ✓ | ✓ | ✓ | ✗ | ✗ |
| View tasks | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create comment | ✓ | ✓ | ✓ | ✓ | ✗ |
| Delete any comment | ✓ | ✓ | ✓ | ✗ | ✗ |
| Access chat | ✓ | ✓ | ✓ | ✓ (pro+) | ✗ |
| Upload files | ✓ | ✓ | ✓ | ✓ | ✗ |
| Manage billing | ✓ | ✓ | ✓ | ✗ | ✗ |
| Manage webhooks | ✓ | ✓ | ✓ | ✗ | ✗ |
| View audit log | ✓ | ✓ | ✓ | ✗ | ✗ |
| Export org data | ✓ | ✓ | ✓ | ✗ | ✗ |
| Access platform admin API | ✓ | ✗ | ✗ | ✗ | ✗ |

### 9.3 Platform Admin Rules

- Platform admin access requires MFA (TOTP) on every session.
- **Hard 1-hour expiry (SEC-NEW-002 fix):** Platform admin sessions expire exactly 1 hour after `mfa_verified_at`. This is NOT an inactivity timeout — activity does NOT extend the session. After 1 hour, a new MFA verification is required regardless of how much activity occurred.
- Platform admin API endpoints independently rate-limited and IP-restricted via `PLATFORM_ADMIN_IP_ALLOWLIST`.
- `app.set('trust proxy', config.platformAdminTrustedProxy || 'loopback')` MUST be configured in `src/app.ts` before any middleware — without this, `req.ip` returns the proxy IP and the allowlist check is useless.
- All platform admin actions written synchronously to `audit_logs` before returning HTTP response (not via outbox).

---

## 10. Edge Cases & Failure Scenarios

### 10.1 Authentication

| Scenario | Expected Behavior |
|---|---|
| Refresh token reuse (after rotation) | Unconditionally revoke entire family; return `401 TOKEN_FAMILY_REVOKED` |
| JWT key rotation mid-session | Both old and new keys accepted during 15-minute grace period |
| SAML assertion replay | Presence-only check in `saml_used_assertions`; reject `400 SAML_ASSERTION_REPLAYED` |
| Magic link clicked twice | Second click returns `401` (key deleted after first use) |
| Email not verified | Return `403 EMAIL_NOT_VERIFIED` |
| Password changed — old access token used | JWT middleware checks `iat < password_changed_at` from re-fetched DB record (cache cleared) |
| Token family revoked — access token still valid | Add all access token `jti` values from revoked family to Redis blacklist |
| Redis restart — token storage lost | Magic link / password reset / email verification tokens invalidated; user must request new token |

### 10.2 Task Management

| Scenario | Expected Behavior |
|---|---|
| Simultaneous update same task | Optimistic lock: second update returns `409 Conflict` |
| Assigning to user not in org | `422 USER_NOT_IN_ORG` |
| Completing recurring task when next instance exists | Dedup index prevents duplicate; creation silently skipped |
| Circular dependency | `422` with cycle path in error detail |
| Exceeding task depth | `422 TASK_DEPTH_EXCEEDED` |

### 10.3 Chat

| Scenario | Expected Behavior |
|---|---|
| Message sent while offline | Persisted; pushed on reconnect via sequence sync |
| Duplicate `client_message_id` | Return existing message; no duplicate |
| Thread reply to message in different monthly partition | Application queries across all partitions (no partition filter on parent lookup); succeeds |
| Sequence number gap | Client sends `last_seen_sequence`; server sends all messages since |

### 10.4 Payments

| Scenario | Expected Behavior |
|---|---|
| Razorpay webhook delivered twice | Idempotent; second delivery is no-op |
| Payment capture during grace period | Grace period cleared; org reactivated |
| Invalid webhook signature | Discard; log WARN; return `400` |
| Grace period check on already-suspended org | Detect `status !== 'active'`; log WARN; skip |
| Payment failure — grace_period_ends_at not set | Payment worker MUST set it on `payment.failed` event processing |

### 10.5 File Uploads

| Scenario | Expected Behavior |
|---|---|
| S3 URL generation fails | No quota touched, no DB row created. Clean failure with error response. |
| Upload URL expires before client uploads | File record `pending`; cleanup job removes after 1h; quota reclaimed |
| Virus scan fails | `status = 'quarantined'`; org admin notified; download blocked `422` |
| Storage quota exceeded mid-upload | Atomic conditional UPDATE returns 0 rows; `403 PLAN_STORAGE_QUOTA_EXCEEDED` |
| Client downloads pending-scan file | `202 Accepted` with `Retry-After: 30` |

### 10.6 Infrastructure

| Scenario | Expected Behavior |
|---|---|
| Redis goes down | Presence stale; rate limiting falls back to in-memory per-process (effective limit = limit × process_count — documented limitation); token blacklist fails-open (log WARN); Socket.IO adapter single-node |
| DB primary fails | `503`; reads to replica; alert |
| Search service down | Falls back to PG FTS; `"search_degraded": true` |
| Worker crashes mid-job | BullMQ retries with backoff; DLQ after max retries |
| Redis restart | All outstanding auth tokens (magic link, password reset, email verify) invalidated |

---

## 11. Data Consistency Guarantees

**Outbox poller ordering (audit issue 3.1 fix — critical correctness change):**

The outbox poller MUST follow the at-least-once delivery model. The correct ordering is:

1. `SELECT ... FOR UPDATE SKIP LOCKED` (acquire rows)
2. **`PUBLISH to Redis`** (deliver to subscribers)
3. Only after successful PUBLISH: `UPDATE outbox_events SET status = 'published', published_at = NOW() WHERE id IN (...)` + `COMMIT`

If the PUBLISH fails → row stays `pending` → poller retries on next cycle. This risks duplicate delivery (at-least-once), which is acceptable because consumers already deduplicate via `correlation_id`.

**The previous ordering (UPDATE → COMMIT → PUBLISH) provides at-most-once semantics — a crash between COMMIT and PUBLISH causes permanent silent event loss. That ordering MUST NOT be used.**

**Redis PUBLISH client (BUG-NEW-002 fix):** The outbox poller MUST use `redisClient` (general-purpose client) for `PUBLISH`. The `redisPubSubClient` enters subscribe mode and cannot issue `PUBLISH` — this causes a Redis protocol error at runtime.

**Minimum inter-batch delay (C-06 fix):** Even for full batches, the outbox poller MUST wait at least 10ms between poll cycles to prevent monopolizing the database connection pool. The 5s wait applies only after a partial batch. This is not a performance concern — 10ms is imperceptible — but prevents a tight hot loop from starving other database operations.

| Operation | Consistency Level | Mechanism |
|---|---|---|
| Task create/update | Strong | Single primary DB write; optimistic lock |
| Message persist | Strong | DB write before ACK |
| Payment capture | Strong | DB transaction; outbox written atomically |
| Notification delivery | Eventual | Async via BullMQ; at-least-once |
| Search index update | Eventual | Async via BullMQ `search` queue |
| Outbox event publish | At-least-once | Poller retries; consumers deduplicate |
| Webhook delivery | At-least-once | BullMQ retry + DLQ |
| Presence tracking | Eventual, TTL-bound | Redis with 90s TTL |
| Audit log write | Strong | Written in same transaction as domain event |
| Storage quota update | Strong | Atomic conditional UPDATE |

---

## 12. Concurrency Considerations

### 12.1 Optimistic Locking

Applies to: `tasks`, `organizations`, `workspaces`, `boards`.
Update SQL: `UPDATE ... SET version = version + 1 WHERE id = $id AND version = $expected_version`.
Zero rows affected → `409 Conflict { "code": "VERSION_CONFLICT" }`.

### 12.2 Race Conditions

| Race | Mitigation |
|---|---|
| Two users accept same invitation simultaneously | DB UNIQUE partial index on `(org_id, user_id) WHERE deleted_at IS NULL` |
| Two concurrent direct-channel creation requests | `direct_channel_pairs` PK constraint + ON CONFLICT RETURN existing |
| Simultaneous file upload + quota check | Atomic conditional UPDATE |
| Task sequence number allocation | Per-channel PostgreSQL sequence |
| Outbox poller + multiple worker instances | `SELECT ... FOR UPDATE SKIP LOCKED` + Redis distributed lock |

### 12.3 Retry Logic

| Layer | Strategy | Max Retries | Backoff |
|---|---|---|---|
| BullMQ jobs | Exponential with jitter | 3 | `min(30s × 2^attempt + random(0..5s), 300s)` |
| Outbox poller | Adaptive + min 10ms delay | N/A (continuous) | 10ms if full batch; 5s if partial batch |
| External HTTP (Razorpay) | Exponential | 3 | 1s, 2s, 4s |
| Email delivery | Exponential | 3 | 5min, 15min, 45min |
| Webhook delivery | Exponential | 3 | 10s, 30s, 90s |
| DB connection | Linear | 5 | 200ms |

### 12.4 Deadlock Prevention

- Acquire row locks in consistent entity ID order when multiple rows locked in same transaction.
- No external HTTP calls inside DB transactions.
- Outbox written in same transaction as domain write but published separately.

### 12.5 WebSocket Session Re-validation (audit issue 5.6 fix)

WebSocket connections are long-lived and JWTs expire in 15 minutes. To prevent stale sessions (e.g., after password change or account suspension) from continuing to receive events:

1. Socket.IO middleware performs JWT validation at connection time.
2. A background heartbeat check runs every 5 minutes per connected socket: query `users` and `org_memberships` (from replica) for `status = 'active'` and `membership.status = 'active'`.
3. On failure: emit `session:expired` event to the client, then call `socket.disconnect(true)`.
4. On password change or user suspension: emit `session.revoked` outbox event → worker publishes `session:expired` to the user's Socket.IO room.

This ensures connections are terminated within 5 minutes of any session invalidation event.
