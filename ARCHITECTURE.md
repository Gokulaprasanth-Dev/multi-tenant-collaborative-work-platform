# ARCHITECTURE.md — Production-Grade Multi-Tenant Collaborative Work Platform

> **Revision note (full rewrite — all audit fixes applied):** CONSISTENCY-001/002/003/004/005, COMPLETENESS-001 through 010, BUG-NEW-001 through 007, SEC-NEW-001 through 006, SCALE-NEW-001 through 004, EXEC-001 through 005, CROSS-001/002, DEP-001 through 006; plus second-pass audit issues: Redis Sentinel mode support (2.4), replica entrypoint Docker fix (7.2), app/worker service definitions (4.5), npm scripts (7.3), SIGTERM handler (C-05), Helmet production config (C-03), CORS production guard (C-02), OTel first-import order (C-01), outbox publish ordering reversal (3.1), grace_period_ends_at setter (3.2), token family blacklist (3.3), SAML cleanup buffer (3.5), notification event enum (2.9), VideoCall domain model (C-07), GDPR export redaction (C-08), WebSocket re-auth (5.6), Razorpay payload schema (C-04), per-channel sequence scale note (6.1), nodeclam → clamscan (4.1), MJML+Handlebars pipeline order (4.2), OpenTelemetry version pinning (4.3), Razorpay TypeScript types (4.4).

---

## Table of Contents

1. [High-Level System Architecture](#1-high-level-system-architecture)
2. [Module Breakdown with Bounded Contexts](#2-module-breakdown-with-bounded-contexts)
3. [Inter-Module Communication](#3-inter-module-communication)
4. [Event-Driven Design](#4-event-driven-design)
5. [Real-Time Layer](#5-real-time-layer)
6. [Background Job Processing](#6-background-job-processing)
7. [Database Design Strategy](#7-database-design-strategy)
8. [Redis Usage](#8-redis-usage)
9. [Authentication & Authorization Flow](#9-authentication--authorization-flow)
10. [Payment Integration Design](#10-payment-integration-design)
11. [File Storage Abstraction](#11-file-storage-abstraction)
12. [Search Architecture](#12-search-architecture)
13. [Scaling Strategy](#13-scaling-strategy)
14. [Failure Handling & Recovery](#14-failure-handling--recovery)
15. [Observability](#15-observability)
16. [Security Considerations](#16-security-considerations)
17. [Deployment Architecture](#17-deployment-architecture)

---

## 1. High-Level System Architecture

### 1.1 ASCII System Diagram

```
                      ┌──────────────────────────────────────────────────────┐
                      │               Client Layer                           │
                      │     (API clients / Postman / minimal HTML)           │
                      └───────────────────────┬──────────────────────────────┘
                                              │ HTTPS / WSS
                      ┌───────────────────────▼──────────────────────────────┐
                      │                  Load Balancer                        │
                      │            (Nginx / HAProxy / ALB)                   │
                      └──────────┬────────────────────────┬───────────────────┘
                                 │                        │
           ┌─────────────────────▼────┐     ┌────────────▼──────────────────────┐
           │      App Process (N)      │     │     App Process (N)               │
           │   (Express + Socket.IO)   │     │   (Express + Socket.IO)           │
           └──────────┬───────────────┘     └────────────┬──────────────────────┘
                      │                                   │
                      └──────────────┬────────────────────┘
                                     │
          ┌──────────────────────────▼──────────────────────────────────┐
          │                    Internal Layers                           │
          │                                                              │
          │   ┌────────────┐  ┌──────────────┐  ┌───────────────────┐  │
          │   │ PostgreSQL  │  │    Redis      │  │   BullMQ Worker   │  │
          │   │ (primary + │  │  (Sentinel/  │  │   Process (N)     │  │
          │   │  replica)  │  │   Cluster)   │  │                   │  │
          │   └────────────┘  └──────────────┘  └───────────────────┘  │
          │                                                              │
          │   ┌────────────────────────────────────────────────────┐    │
          │   │            External Services                        │    │
          │   │  Razorpay │ SES/SendGrid │ S3 │ Typesense │ ClamAV │    │
          │   └────────────────────────────────────────────────────┘    │
          └──────────────────────────────────────────────────────────────┘
```

### 1.2 Process Model

| Process | Count | Responsibilities |
|---|---|---|
| `app` | N (stateless, behind LB) | HTTP API, Socket.IO server, request handling |
| `worker` | N (isolated) | BullMQ job processing; no HTTP listeners |

Both processes share the same codebase but start different entry points (`src/app.ts` vs `src/worker.ts`).

### 1.3 Architectural Style

- **Modular monolith:** Single deployable artifact; strict bounded contexts by folder structure and no cross-module direct DB access.
- **REST-first API:** All client interactions via `/api/v1/...`.
- **Event-driven internally:** Domain writes emit events via the outbox pattern; async consumers react.
- **Hexagonal (ports & adapters):** Core domain logic has zero infrastructure dependencies.
- **Design for extraction:** Each module can be extracted to a microservice without DB schema changes.

---

## 2. Module Breakdown with Bounded Contexts

### Source Tree Layout

```
src/
├── modules/
│   ├── auth/
│   ├── organization/
│   ├── user/
│   ├── workspace/
│   ├── task/
│   ├── chat/
│   ├── notification/
│   ├── payment/
│   ├── file/
│   ├── search/
│   ├── webhook/
│   ├── audit/
│   ├── feature-flag/
│   ├── video/
│   ├── gdpr/
│   └── platform-admin/
├── shared/
│   ├── database/          # Connection pool, query helpers, migrations runner
│   ├── redis/             # Redis client, pub/sub, rate limiter
│   ├── queue/             # BullMQ setup, queue definitions
│   ├── events/            # OutboxPoller, EventEmitter wrapper
│   ├── realtime/          # Socket.IO server setup, room helpers
│   ├── storage/           # Storage interface + adapters
│   ├── auth-middleware/   # JWT validation, org context extraction
│   ├── idempotency/       # Idempotency key check + cache middleware
│   ├── circuit-breaker/   # opossum wrappers per external service
│   ├── crypto/            # AES-256-GCM encrypt/decrypt utilities
│   ├── i18n/              # Locale/template helpers
│   ├── errors/            # Typed error classes, HTTP error mapping
│   └── observability/     # Logger, metrics, tracer
├── app.ts                 # Express + Socket.IO entrypoint
└── worker.ts              # BullMQ worker entrypoint
```

### Module Rules (Enforced)

1. A module's `repository/` files ONLY query their own tables.
2. A module's `service/` files MAY call other modules' **services** (sync) or emit **events** (async). Direct repository cross-calls are forbidden.
3. A module exports a `router` (HTTP routes), `service` (business logic), `repository` (DB access), and optionally `workers` (BullMQ processors).
4. All inbound requests pass through `shared/auth-middleware` before reaching module controllers.
5. **Worker file structure (EXEC-004 fix):** Worker files MUST be split: `{name}.worker.ts` (plain async function — job logic) + `{name}.worker.registration.ts` (BullMQ Worker class registration). `src/worker.ts` imports only registration files. Tests import the plain function directly without starting BullMQ.

---

### 2.1 Auth Module

**Bounded context:** Identity, sessions, token lifecycle, MFA, OAuth, SAML.

**Owns:** `users` (shared read with User module), `auth_providers`, `refresh_tokens`, `saml_used_assertions` tables; `users.totp_secret`, `users.totp_enabled`, `users.mfa_backup_codes`, `users.mfa_backup_codes_generated_at` fields.

**Responsibilities:**
- Email/password login + registration
- Google OAuth flow
- Magic link flow — token stored in Redis `magic:{hash}` (15-min TTL)
- Password reset flow — token stored in Redis `pwd_reset:{hash}` (1-hour TTL)
- Email verification flow — token stored in Redis `email_verify:{hash}` (24-hour TTL)
- SAML 2.0 SP-initiated flow (enterprise)
- JWT issuance (RS256 access + refresh). Access token payload MUST include `auth_time` claim (Unix timestamp of authentication). Required by GDPR erasure re-auth gate and platform admin expiry check.
- Refresh token rotation with family-based reuse detection (unconditional family revocation on reuse)
- Token revocation: jti blacklist in Redis, row in `refresh_tokens`
- Password reset: sets `password_changed_at` AND immediately executes `await redisClient.del('user:cache:{userId}')` (SEC-NEW-001 fix — eliminates the 60-second stale-cache bypass window)
- MFA enrollment (TOTP). Backup code generation (8 codes, bcrypt-hashed), validation (single-use), audit logging.
- Account lockout logic

**Must NOT:**
- Access any other module's tables
- Make payment or notification calls directly (emit events instead)
- Return `totp_secret`, `password_hash`, or `mfa_backup_codes` in any HTTP response

---

### 2.2 Organization Module

**Bounded context:** Tenant lifecycle, membership, invitations, plan enforcement.

**Owns:** `organizations`, `org_memberships`, `invitations` tables.

**Responsibilities:**
- Org creation (atomic transaction: org + default workspace + default roles + default notification preferences for ALL event types listed in SPEC §7 + subscription record)
- Tenant lifecycle state machine. `suspendOrg` ONLY transitions from `active`. If `status !== 'active'`: log WARN and return without emitting events or updating any DB rows.
- Member CRUD, role assignment
- Invitation flow using `INVITE_SECRET` env var for HMAC signing
- Plan tier enforcement

**Must NOT:**
- Send emails directly (emit events)
- Call Payment module's DB directly

---

### 2.3 User Module

**Bounded context:** User profile, preferences, GDPR self-service.

**Owns:** `users` (shared read), `user_preferences` tables.

**API response serialization rule:** `GET /api/v1/me` and all user-returning endpoints MUST use a `sanitizeUser()` function that explicitly constructs a safe object omitting `totp_secret`, `password_hash`, `mfa_backup_codes`, and `mfa_backup_codes_generated_at`. Never spread the DB row directly into the response.

---

### 2.4 Workspace Module

**Bounded context:** Workspaces, boards, project structure.

**Owns:** `workspaces`, `boards` tables.

---

### 2.5 Task Module

**Bounded context:** Tasks, subtasks, assignees, dependencies, comments, templates, recurring tasks.

**Owns:** `tasks`, `task_assignees`, `task_dependencies`, `task_templates`, `comments`, `task_activity_log` tables.

**Responsibilities:**
- Task CRUD with optimistic locking
- Subtask hierarchy enforcement (depth 0–2)
- Dependency management with cycle detection (DFS)
- Bulk operations (max 100 per call)
- Recurring task scheduler (uses `rrule` npm library; deduplication via `(recurrence_parent_id, due_date::date)` UNIQUE index)
- Comment thread management, @mention parsing, activity feed emission

---

### 2.6 Chat Module

**Bounded context:** Channels, messages, threading, read receipts.

**Owns:** `channels`, `channel_members`, `chat_messages`, `direct_channel_pairs` tables.

**Responsibilities:**
- Channel CRUD (direct + group). Direct channel deduplication via `direct_channel_pairs` PK.
- Message persistence with per-channel PostgreSQL sequences.
- Cross-partition threading: when fetching parent message, query WITHOUT `created_at` filter — let PostgreSQL scan all partitions. Required because parent and reply can be in different monthly partitions.
- Read receipt tracking, offline catch-up, message editing with history.
- On channel creation: call `create_channel_sequence(channelId)` to create the per-channel PostgreSQL sequence. This MUST be called inside the channel creation transaction.
- On channel soft-delete: schedule sequence DROP via cleanup worker (after 30-day retention period). This prevents PostgreSQL catalog bloat from accumulated sequences.

---

### 2.7 Notification Module

**Bounded context:** In-app notifications, email delivery, digest.

**Owns:** `notifications`, `notification_preferences` tables.

**Email template rendering pipeline (audit issue 4.2 fix):** Handlebars compiles FIRST (resolves `{{variable}}` tokens), then MJML renders the resulting HTML. Templates are stored as `.mjml.hbs` files. This order is mandatory — MJML cannot parse Handlebars syntax.

---

### 2.8 Payment Module

**Bounded context:** Razorpay integration, subscriptions, billing.

**Owns:** `subscriptions`, `payments` tables.

**grace_period_ends_at responsibility (audit issue 3.2 fix):** The payment worker is responsible for setting `grace_period_ends_at` when processing a `payment.failed` event: `UPDATE organizations SET grace_period_ends_at = NOW() + INTERVAL '7 days' WHERE id = $orgId AND status = 'active'`. Without this explicit write, the grace period cron job never fires.

**Razorpay TypeScript types (audit issue 4.4 fix):** The `razorpay` npm package is JavaScript-only. Add type declarations in `src/types/razorpay.d.ts` or install `@types/razorpay` in devDependencies to prevent TypeScript strict mode errors on SDK calls.

---

### 2.9 File Module

**Bounded context:** File uploads, virus scanning, quota.

**Owns:** `files` table.

**Upload sequence:** Generate storage key → generate presigned URL (if fails, return error — no quota touched) → atomically reserve quota AND insert file row in single DB transaction. Files with `scan_status = 'pending'` return `202 Accepted` with `Retry-After: 30` on download attempt.

---

### 2.10 Search Module

**Bounded context:** Full-text search, search index management.

**Owns:** No DB tables.

**Search index lag SQL (BUG-NEW-007 fix):** Uses explicit IN list:
```sql
SELECT EXTRACT(EPOCH FROM NOW() - MIN(occurred_at))
FROM outbox_events
WHERE status = 'pending'
  AND event_type IN (
    'task.created', 'task.updated', 'task.deleted',
    'message.created', 'message.deleted',
    'file.confirmed', 'file.deleted'
  )
```
NOT `LIKE` patterns — LIKE would match unrelated events and cause operator precedence issues with multiple OR conditions.

---

### 2.11 Webhook Module

**Bounded context:** Outgoing webhooks, delivery tracking.

**Owns:** `webhook_subscriptions`, `webhook_delivery_log` tables.

**SSRF prevention (SEC-NEW-003 fix):** Before each HTTP delivery, resolve hostname via `dns.promises.lookup()`. Verify resolved IP is not in private ranges (RFC 1918: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`; loopback: `127.0.0.0/8`; link-local: `169.254.0.0/16`; IPv6 loopback: `::1`). If private: mark delivery `failed` with `SSRF_BLOCKED`. If safe: connect directly to the resolved IP address with `Host` header set to original hostname. This prevents DNS rebinding attacks where a hostname resolves to a public IP at check time but a private IP at connect time.

---

### 2.12 Audit Module

**Bounded context:** Immutable audit log.

**Owns:** `audit_logs` (partitioned).

`AuditRepository.append()` is the only write method. PostgreSQL RLS prevents UPDATE/DELETE. Cleanup uses `DROP TABLE IF EXISTS audit_logs_YYYY_MM` — never DELETE.

---

### 2.13 Feature Flag Module

**Bounded context:** Feature flag evaluation, multi-layer caching.

**Owns:** `feature_flags` table.

L1 in-process (5s TTL) → L2 Redis hash `featureflags:cache` → DB. Invalidation via Redis pub/sub `featureflag:invalidate`. `feature.chat` (pro+), `feature.webhooks` (business+), `feature.sso` (enterprise), `feature.video_signaling` (business+).

---

### 2.14 GDPR Module

**Bounded context:** Data export, erasure, offboarding.

**Export PII redaction (audit issue C-08 fix):** User data exports must redact other users' personal information referenced in exported content (e.g., commenter names in task comments where the requester is not the commenter). Only the requesting user's own PII is exported. Produce a signed download URL (24-hour TTL) and email it to the user via the outbox.

Re-authentication gate for `DELETE /api/v1/me`: checks `jwt.auth_time` within last 5 minutes (300 seconds). Token without `auth_time` claim returns `403 MISSING_AUTH_TIME`.

---

### 2.15 Platform Admin Module

**Bounded context:** Cross-tenant operations, operational tooling.

**Security model:** `platformAdminMiddleware` = JWT validation + `isPlatformAdmin === true` + IP allowlist check + MFA hard expiry check.

**Hard 1-hour expiry (SEC-NEW-002 fix):** Platform admin sessions expire exactly 1 hour from `mfa_verified_at` in the JWT claim. This is a HARD expiry, NOT an inactivity timeout. Activity does not extend the session. After 1 hour, re-MFA is required.

**Trust proxy (COMPLETENESS-004 fix):** `app.set('trust proxy', config.platformAdminTrustedProxy || 'loopback')` MUST be called in `src/app.ts` before any middleware. Without this, `req.ip` returns the load balancer's IP, making IP allowlist checks useless.

---

### 2.16 Video Module

**Bounded context:** WebRTC signaling relay.

**Source path:** `src/modules/video/`

**Domain model:** `video_calls` table (created in migration `013_saml_assertions.js`): `id UUID PK`, `org_id UUID NOT NULL FK`, `channel_id UUID FK`, `initiator_id UUID NOT NULL FK`, `state VARCHAR(20) CHECK (ringing, active, ended)`, `started_at TIMESTAMPTZ`, `ended_at TIMESTAMPTZ`, `created_at TIMESTAMPTZ NOT NULL`.

**Redis state:** `call:state:{callId}` hash with 4-hour TTL. Signals relayed via Socket.IO rooms `call:{callId}`.

---

## 3. Inter-Module Communication

### Sync (Service-to-Service)

```typescript
// Allowed: module service calls another module's service
import { OrganizationService } from '../organization/services/organization.service';

// Forbidden: module repository queries another module's table
import { organizationRepository } from '../organization/repositories/organization.repository'; // ❌
```

### Async (Event-Driven)

All async communication goes through: domain write → outbox event (same DB transaction) → OutboxPoller publishes to Redis pub/sub → BullMQ workers consume and process.

---

## 4. Event-Driven Design

### 4.1 Outbox Pattern — Corrected Ordering (audit issue 3.1 fix)

The outbox poller MUST use at-least-once delivery semantics. The correct ordering is:

```
Domain Write → INSERT outbox_events (same transaction) → COMMIT
                                                          ↓
                                          OutboxPoller (continuous polling)
                                                          ↓
                                  SELECT FOR UPDATE SKIP LOCKED (batch up to OUTBOX_POLL_BATCH_SIZE)
                                                          ↓
                                          PUBLISH to Redis pub/sub         ← STEP 2: PUBLISH FIRST
                                          (using redisClient, NOT redisPubSubClient)
                                                          ↓
                                  Only after successful PUBLISH:           ← STEP 3: THEN UPDATE
                                  UPDATE status = 'published' → COMMIT
```

**Why this ordering matters:** If the app crashes between COMMIT and PUBLISH in the old ordering (UPDATE → COMMIT → PUBLISH), the event is permanently lost — it is marked `published` in DB but was never delivered to Redis. With the new ordering (PUBLISH → UPDATE on success), if the app crashes after PUBLISH but before UPDATE, the event stays `pending` and the poller retries it. Consumers already deduplicate via `correlation_id`, so duplicate delivery is safe.

**On PUBLISH failure:** Log WARN. Leave the event as `pending`. The poller will retry on next cycle.

**Minimum inter-batch delay (audit issue C-06 fix):** Wait at minimum 10ms between poll cycles even for full batches, to prevent the poller from monopolizing DB connections. The 5-second wait applies only after a partial batch.

**BUG-NEW-002 fix:** `redisClient.publish()` — NOT `redisPubSubClient.publish()`. `redisPubSubClient` enters subscribe mode after first `SUBSCRIBE` call and cannot execute `PUBLISH`. This causes a Redis protocol error at runtime.

### 4.2 Event Routing in worker.ts

```typescript
redisPubSubClient.subscribe('outbox:events', (message) => {
  const event = JSON.parse(message);
  switch (event.event_type) {
    case 'user.registered':
    case 'user.email_verification_requested':
    case 'user.password_reset_requested':
    case 'invitation.created':
      notificationQueue.add('send-email', event);
      break;
    case 'task.created':
    case 'task.updated':
    case 'task.deleted':
    case 'message.created':
    case 'message.deleted':
    case 'file.confirmed':
    case 'file.deleted':
      searchQueue.add('index-entity', event);
      broadcastTaskEvent(event); // real-time Socket.IO broadcast
      break;
    case 'payment.failed':
      paymentsQueue.add('handle-payment-failure', event);
      break;
    case 'payment.captured':
    case 'subscription.charged':
      paymentsQueue.add('handle-payment-recovery', event);
      break;
    case 'org.offboarding_started':
      cleanupQueue.add('run-offboarding', event, {
        delay: 30 * 24 * 60 * 60 * 1000
      });
      break;
    // ... all other event types
  }
});
```

---

## 5. Real-Time Layer

### 5.1 Socket.IO Configuration

```typescript
const io = new Server(httpServer, {
  adapter: createAdapter(redisAdapterPubClient, redisAdapterSubClient),
  cors: { origin: config.corsOrigins.split(','), credentials: true },
  transports: ['websocket', 'polling'],
});
```

`redisAdapterPubClient` and `redisAdapterSubClient` are dedicated ioredis instances — separate from `redisPubSubClient` (outbox subscription). Never reuse the same ioredis instance for the Socket.IO adapter and pub/sub subscriptions.

### 5.2 Socket.IO Event Rate Limiting (SEC-NEW-005 fix)

All inbound socket events rate-limited via the Redis sliding-window rate limiter from `src/shared/redis/rate-limiter.ts`:

| Event | Limit | Scope |
|---|---|---|
| `message:send` | 60 per 10s | per user |
| `task:subscribe` | 20 per 60s | per client |
| `presence:heartbeat` | 1 per 10s | per client |
| `call:ice-candidate` | 100 per 1s | per room |
| `typing:start` | 1 per 1s | per channel per user |

Exceeding limits: drop the event silently; emit `rate_limit:exceeded` to the client. Do NOT disconnect.

**Multi-process degradation note:** When Redis is down, rate limiting falls back to in-process counters. In a multi-process deployment, each process maintains independent counters. The effective limit becomes `configured_limit × process_count`. This is a documented degradation — WebSocket connections are not rejected during Redis outage, but rate limiting provides weaker protection. Log WARN when falling back.

### 5.3 Room Naming Convention

```
org:{org_id}                    — all members of an org
org:{org_id}:user:{user_id}    — user's personal room
org:{org_id}:task:{task_id}    — task subscribers
org:{org_id}:channel:{chan_id} — channel members
call:{call_id}                  — video call participants
```

### 5.4 Presence System

- `HSET presence:{org_id}:{user_id} status online last_seen {now}` with `EXPIRE ... 90`
- `presence:heartbeat` event refreshes TTL.
- On disconnect: set `status = offline`.

### 5.5 Reconnect Sync

On `client:sync({ channelId, lastSequence })`:
- Query `chat_messages WHERE channel_id = $channelId AND sequence_number > $lastSequence AND deleted_at IS NULL`.
- Emit missed messages to the reconnecting socket.

### 5.6 WebSocket Session Re-validation (audit issue 5.6 fix)

WebSocket connections are long-lived; JWT access tokens expire in 15 minutes. To prevent stale sessions from persisting after password change or account suspension:

1. JWT validated at connection time (initial handshake).
2. Background per-socket check every 5 minutes: query `users` and `org_memberships` for `status = 'active'`.
3. On check failure: emit `session:expired` then `socket.disconnect(true)`.
4. On password change / user suspension: outbox event `session.revoked` → worker publishes `session:expired` to `org:{orgId}:user:{userId}` room → all connected sockets for that user disconnect.
5. Implementation: register a `setInterval` on each socket connection (cleared on disconnect).

---

## 6. Background Job Processing

### 6.1 Queue Definitions

| Queue Name | Processor Location | Concurrency |
|---|---|---|
| `notifications` | `notification/workers/` | 10 |
| `emails` | `notification/workers/` | 5 |
| `search` | `search/workers/` | 10 (increased from 5 for lag) |
| `payments` | `payment/workers/` | 3 |
| `exports` | `gdpr/workers/` | 1 |
| `virus-scan` | `file/workers/` | 2 |
| `cleanup` | `shared/jobs/` | 2 |
| `webhooks` | `webhook/workers/` | 10 |
| `audit` | `audit/workers/` | 5 |
| `recurring-tasks` | `task/workers/` | 5 |

### 6.2 Email Provider Failover

Primary: SES (`sesBreaker`). When SES circuit breaker is open: attempt SendGrid (`sendgridBreaker`). When both open: DLQ the job.

**Email template rendering order (audit issue 4.2 fix):** Always run Handlebars template compilation first (resolve `{{variable}}` tokens), then pass the resulting plain HTML through MJML. Store templates as `.mjml.hbs` files. MJML cannot parse Handlebars `{{}}` syntax — this order is mandatory.

### 6.3 Dead Letter Queue

Jobs moved to DLQ after exhausting all retry attempts. Platform admin API: `POST /admin/queues/:queue/dlq/replay`.

### 6.4 Scheduled / Repeating Jobs

| Job Name | Schedule | Purpose |
|---|---|---|
| `cleanup-pending-files` | Every 1h | Remove pending uploads older than 1h; reclaim quota |
| `cleanup-outbox` | Every 1h | Purge published outbox events > 7 days; failed > 30 days |
| `cleanup-idempotency-keys` | Every 6h | Purge expired idempotency keys |
| `cleanup-saml-assertions` | Every 1h | Purge `saml_used_assertions` WHERE `not_on_or_after < NOW() - INTERVAL '24 hours'` |
| `cleanup-audit-logs` | Daily 02:00 UTC | DROP expired monthly `audit_logs_YYYY_MM` partitions |
| `create-chat-partitions` | Daily 00:00 UTC | `CREATE TABLE IF NOT EXISTS` for next 2 months — daily for fault tolerance |
| `create-audit-partitions` | Daily 00:00 UTC | `CREATE TABLE IF NOT EXISTS` for next 2 months — daily for fault tolerance |
| `cleanup-channel-sequences` | Daily 03:00 UTC | DROP sequences for channels `deleted_at < NOW() - INTERVAL '30 days'` |
| `send-daily-digest` | Hourly (user tz check) | Email digests for digest-mode users at their 08:00 local time |
| `feature-flag-cache-refresh` | Every 60s | Safety net Redis hash reload |

**Partition job reliability note (audit issue 6.2 fix):** Partition creation jobs run **daily** (not monthly) with `CREATE TABLE IF NOT EXISTS` (idempotent). This means if the job fails on the 1st of the month due to a transient error, it will succeed on the 2nd, 3rd, etc. Daily idempotent runs provide much stronger reliability than a single monthly run.

### 6.5 Worker File Pattern (EXEC-004 fix)

```
src/modules/{name}/workers/{job-name}.worker.ts            — job logic (plain async function, exported)
src/modules/{name}/workers/{job-name}.worker.registration.ts — BullMQ Worker class (imports and registers logic)
```

`src/worker.ts` imports ONLY registration files. Tests import the plain function directly — no BullMQ side effects in tests.

---

## 7. Database Design Strategy

### 7.1 Single Schema, Row-Level Tenant Isolation

Shared PostgreSQL 16. Every tenant-scoped table has `org_id UUID NOT NULL REFERENCES organizations(id)`. All queries include `WHERE org_id = $orgId`. No cross-org queries except platform admin paths.

### 7.2 Connection Pools

| Pool | Max Connections | Usage |
|---|---|---|
| Primary | 15 | Writes + reads requiring consistency |
| Replica | 10 | Read-heavy queries (lists, search, reporting) |

Both: `idleTimeoutMillis: 30000`, `connectionTimeoutMillis: 5000`, `statement_timeout: 10000`.
Replica falls back to primary if `DATABASE_REPLICA_URL` is not set.

### 7.3 Partitioned Tables

**`audit_logs`** (RANGE on `occurred_at` per month):
- Partitions: `audit_logs_YYYY_MM`
- Default partition: `audit_logs_default` (MUST always exist)
- Pre-create: 12 months ahead at initial deployment; daily job creates `IF NOT EXISTS` for next 2 months
- Cleanup (CROSS-001 fix): `DROP TABLE IF EXISTS audit_logs_YYYY_MM`. Never `DELETE FROM audit_logs`.
- Indexes on each partition: `org_id`, `occurred_at`, `actor_id`, `event_type`

**`chat_messages`** (RANGE on `created_at` per month):
- Partitions: `chat_messages_YYYY_MM`
- Default partition: `chat_messages_default` (MUST always exist)
- Pre-create: current month + next 3 months at deployment; daily job creates `IF NOT EXISTS`
- Indexes on each partition: `(channel_id, sequence_number)`, `(channel_id, client_message_id)`, `org_id`, `deleted_at`, GIN on `search_vector`

### 7.4 Per-Channel Sequences

```sql
-- Function defined in migration 014_misc.js:
CREATE OR REPLACE FUNCTION create_channel_sequence(channel_id UUID) RETURNS VOID AS $$
BEGIN
  EXECUTE format(
    'CREATE SEQUENCE IF NOT EXISTS channel_seq_%s',
    replace(channel_id::text, '-', '_')
  );
END;
$$ LANGUAGE plpgsql;

-- Called on channel creation (inside channel creation transaction):
SELECT create_channel_sequence($channelId);

-- Used for sequence number assignment (PRIMARY pool only):
SELECT nextval('channel_seq_' || replace($channelId, '-', '_'));
```

**Scale note (audit issue 6.1):** Per-channel PostgreSQL sequences scale linearly in the `pg_sequence` catalog. At >100K channels, sequence creation and lookup overhead becomes measurable. Migration path at scale: replace with Redis INCR (`INCR seq:{channelId}`) with DB-backed high-water mark synchronization. Document the migration path in `docs/RUNBOOK.md` before the threshold is reached.

**Sequence cleanup:** The daily cleanup job drops sequences for channels with `deleted_at < NOW() - INTERVAL '30 days'` using `DROP SEQUENCE IF EXISTS channel_seq_{id}`. This prevents unbounded catalog growth.

### 7.5 Migration Numbering

- Sequential numeric prefix `001` through `014`. No gaps permitted. `node-pg-migrate` stops on any gap.
- Files are in `migrations/` as `{NNN}_{name}.js`.
- All have `up` and `down` functions.
- Running `node-pg-migrate up` on a fresh DB produces exactly 14 rows in `pgmigrations`.

### 7.6 Updated_at Trigger

Created once in migration `001_extensions.js`, applied to all mutable tables:

```sql
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Applied per table:
CREATE TRIGGER trg_{table}_updated_at
  BEFORE UPDATE ON {table}
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

Tables requiring this trigger: `users`, `user_preferences`, `organizations`, `org_memberships`, `workspaces`, `boards`, `tasks`, `comments`, `channels`, `notification_preferences`, `subscriptions`, `payments`, `webhook_subscriptions`, `webhook_delivery_log`, `feature_flags`.

### 7.7 Table-Level Grants (audit issue 2.5 fix)

Defined in migration `014_misc.js`. The `app_db_user` role receives:

```sql
-- General access (all tables except audit_logs):
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_db_user;

-- audit_logs: INSERT only (enforced by RLS + explicit REVOKE)
REVOKE UPDATE ON audit_logs FROM app_db_user;
REVOKE DELETE ON audit_logs FROM app_db_user;

-- Tables supporting hard delete (cleanup worker):
GRANT DELETE ON outbox_events TO app_db_user;
GRANT DELETE ON idempotency_keys TO app_db_user;
GRANT DELETE ON saml_used_assertions TO app_db_user;
GRANT DELETE ON refresh_tokens TO app_db_user;

-- Sequences:
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_db_user;
```

The RLS policy on `audit_logs` provides the database-layer enforcement. The REVOKE statements provide belt-and-suspenders protection.

---

## 8. Redis Usage

### 8.1 Client Instances (Four Total)

| Client | Usage | MUST NOT |
|---|---|---|
| `redisClient` | Rate limiting, caching, PUBLISH, blacklist, outbox poller | Nothing — general purpose |
| `redisPubSubClient` | SUBSCRIBE to `outbox:events` in `worker.ts` | Issue PUBLISH or any other non-subscribe command |
| `redisAdapterPubClient` | Socket.IO Redis adapter (pub) | Be used outside the adapter |
| `redisAdapterSubClient` | Socket.IO Redis adapter (sub) | Be used outside the adapter |

All four MUST be created as separate ioredis instances. Never reuse or share between roles.

**Sentinel mode support (audit issue 2.4 fix):** In production with Redis Sentinel, `REDIS_URL` alone is insufficient — ioredis requires a different constructor for Sentinel mode. Implementation:

```typescript
function createRedisClient(name: string): Redis {
  if (config.redisSentinelHosts) {
    // Sentinel mode: REDIS_SENTINEL_HOSTS is set
    const sentinels = config.redisSentinelHosts.split(',').map(h => {
      const [host, port] = h.trim().split(':');
      return { host, port: parseInt(port, 10) };
    });
    return new Redis({
      sentinels,
      name: 'mymaster',
      password: config.redisPassword,
      lazyConnect: false,
      maxRetriesPerRequest: 3,
    });
  }
  // Standalone mode
  return new Redis(config.redisUrl, {
    password: config.redisPassword,
    lazyConnect: false,
    maxRetriesPerRequest: 3,
  });
}
```

`REDIS_SENTINEL_HOSTS`: comma-separated `host:port` list (e.g., `sentinel1:26379,sentinel2:26379,sentinel3:26379`). If not set, standalone `REDIS_URL` mode is used.

### 8.2 Key Namespaces

| Key Pattern | TTL | Purpose |
|---|---|---|
| `blacklist:token:{jti}` | Access token remaining TTL | JWT blacklist |
| `user:cache:{user_id}` | 60s | Cached user record for JWT middleware |
| `email_verify:{hash}` | 86400s (24h) | Email verification tokens |
| `pwd_reset:{hash}` | 3600s (1h) | Password reset tokens |
| `magic:{hash}` | 900s (15min) | Magic link tokens |
| `presence:{org_id}:{user_id}` | 90s | Presence status hash |
| `typing:{channel_id}:{user_id}` | 5s | Typing indicator |
| `call:state:{call_id}` | 14400s (4h) | Video call state hash |
| `rl:{scope}:{key}` | Window-dependent | Rate limit sorted sets |
| `featureflags:cache` | Invalidated on write | Feature flag hash |
| `session:{user_id}:{org_id}` | 30s | Membership cache for org-context middleware |
| `outbox:poller:lock` | 10s | Distributed lock for single-poller guarantee |

### 8.3 Graceful Degradation When Redis Is Down

- Rate limiting: falls back to in-process counter (per-process only; see §5.2 for WebSocket caveat). Log WARN.
- Token blacklist: fail-open (allow the request). The `password_changed_at` DB check still operates via fresh DB fetch.
- Presence: goes stale until Redis is back.
- Socket.IO adapter: falls back to in-process (single-node broadcasts only).
- Feature flags: serve from L1 in-process cache; on L1 miss, query DB directly.
- Auth token storage (magic link, password reset, email verify): these tokens are Redis-only — Redis restart invalidates all outstanding tokens. Users must request new tokens. Redis persistence (`appendonly yes`) mitigates this.

---

## 9. Authentication & Authorization Flow

### 9.1 Email/Password Login Flow

```
POST /api/v1/auth/login
  → Rate limit check (10 req/60s per IP)
  → Find user by email (not found = generic 401)
  → Check email_verified (false = 403 EMAIL_NOT_VERIFIED)
  → Check locked_until (locked = 403 ACCOUNT_LOCKED)
  → Verify password (wrong = increment failed_attempts; if >= lockout threshold: lock user; 401)
  → Success: reset failed_attempts, update last_login_at
  → Check MFA: if totp_enabled = true, require TOTP code
  → Issue JWT pair (auth_time = Math.floor(Date.now() / 1000))
  → Write audit log: user.login
  → Return { access_token, refresh_token, expires_in: 900, user }
```

### 9.2 JWT Middleware Flow

```
Extract Bearer token
  → Verify RS256 signature (try all active keys for rotation overlap)
  → Check jti in Redis blacklist (fail-open if Redis down, log WARN)
  → Fetch user:cache:{userId} from Redis (miss: query DB, cache 60s)
  → Check jwt.iat < user.password_changed_at (session invalidation)
  → Check user.status === 'deleted' or 'suspended'
  → Attach { userId, orgId, role, isPlatformAdmin, authTime } to req.user
```

### 9.3 Refresh Token Rotation

```
POST /api/v1/auth/refresh with raw refresh token
  → Hash the token
  → Find in DB by token_hash (not found = 401)
  → If is_revoked = true: revokeTokenFamily(family_id) unconditionally → 401 TOKEN_FAMILY_REVOKED
  → If expires_at < NOW(): 401 EXPIRED
  → Mark current token is_revoked = true
  → Issue new token pair (new token, same family_id)
  → Return { access_token, refresh_token, expires_in: 900 }
```

**Token family revocation and in-flight access tokens (audit issue 3.3 fix):** When `TOKEN_FAMILY_REVOKED` is triggered, the corresponding access tokens may still be valid for up to 15 minutes. To close this window: store `last_access_token_jti VARCHAR` on each refresh token row (populated at each refresh). On family revocation, add all `last_access_token_jti` values from the family to the Redis blacklist with the remaining token TTL. This ensures revoked family access tokens are immediately rejected.

### 9.4 Password Change Sequence (SEC-NEW-001 fix)

```
UPDATE users SET password_hash = $hash, password_changed_at = NOW() WHERE id = $userId
UPDATE refresh_tokens SET is_revoked = true, revoked_at = NOW() WHERE user_id = $userId AND is_revoked = false
await redisClient.del('user:cache:{userId}')   ← CRITICAL: clears cache so JWT middleware re-fetches immediately
Write audit log: user.password_changed
```

The `DEL` on the cache key forces the JWT middleware to re-fetch the user on the very next request, where it finds the updated `password_changed_at` and rejects all tokens issued before the change.

### 9.5 SAML Replay Prevention

```
Receive SAML assertion
  → Validate assertion signature, NotOnOrAfter, audience
  → SELECT 1 FROM saml_used_assertions WHERE assertion_id = $id AND org_id = $orgId
  → If row found: reject 400 SAML_ASSERTION_REPLAYED (presence-only check — NOT expiry-gated)
  → INSERT INTO saml_used_assertions (assertion_id, org_id, not_on_or_after)
  → Extract NameID, upsert user + provider, issue tokens (auth_time = now)
```

---

## 10. Payment Integration Design

### 10.1 Payment Flow

```
POST /api/v1/org/:org_id/payments/orders
  → Validate org is active
  → Call Razorpay createOrder (wrapped in razorpayBreaker)
  → Insert payment record (status: created, idempotency_key)
  → Write outbox event payment.order_created
  → Return { order_id, amount, currency, key_id }

Client completes Razorpay checkout
  ↓
POST /api/v1/org/:org_id/payments/verify
  → Verify HMAC-SHA256: HMAC(razorpay_order_id + '|' + razorpay_payment_id, RAZORPAY_KEY_SECRET)
  → Comparison MUST use crypto.timingSafeEqual (timing-safe HMAC compare)
  → Update payment status to authorized
```

### 10.2 Webhook Processing (C-04 fix)

```
POST /api/v1/webhooks/razorpay
  → body parsed with express.raw() (NOT express.json()) — raw Buffer required for HMAC
  → Verify X-Razorpay-Signature via crypto.timingSafeEqual (SEC fix: timing-safe)
  → Invalid: log WARN, return 400
  → Parse body as JSON; validate against RazorpayWebhookPayloadSchema (Zod)
  → Idempotency: razorpay_event_id already processed → 200 no-op
  → Route to handler; write outbox event; return 200
```

**Razorpay webhook Zod schema:** Define `RazorpayWebhookPayloadSchema` covering `payment.captured`, `payment.failed`, `subscription.charged`, `refund.created`, `dispute.created`. Any payload not matching a known schema is logged and returns 200 (do not fail on unknown event types from Razorpay).

### 10.3 Grace Period Management (audit issue 3.2 fix)

On `payment.failed` event processing (payment worker):
1. Execute: `UPDATE organizations SET grace_period_ends_at = NOW() + INTERVAL '7 days' WHERE id = $orgId AND status = 'active'` — **this write is mandatory**; without it, the grace period job never fires.
2. Enqueue delayed BullMQ `check-grace-period` job scheduled for `grace_period_ends_at`.
3. Write outbox `org.grace_period_started`.

`check-grace-period` job:
```
Load org
If org.status !== 'active': log WARN, return (no spurious transition — BUG-NEW-003 fix)
If grace_period_ends_at > NOW(): skip (payment recovered)
Call OrganizationService.suspendOrg(orgId, 'payment_failure')
```

---

## 11. File Storage Abstraction

### 11.1 IStorageProvider Interface

```typescript
interface UploadSpec {
  url: string;
  fields?: Record<string, string>;  // S3 presigned POST form fields (content-length-range enforced)
  expiresAt: Date;
}

interface IStorageProvider {
  generateUploadUrl(key: string, mimeType: string, maxBytes: number): Promise<UploadSpec>;
  generateDownloadUrl(key: string, ttlSeconds: number): Promise<string>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
```

### 11.2 Upload Sequence (BUG-NEW-004 fix)

```
FileService.requestUploadUrl(orgId, uploaderId, { filename, mimeType, sizeBytes })
  Step 1: MIME allowlist check → reject if not allowed (422)
  Step 2: Per-plan size limit check → reject if too large (422)
  Step 3: Generate storageKey = gen_random_uuid()
  Step 4: Call storageProvider.generateUploadUrl(storageKey, mimeType, sizeBytes)
          → S3: returns presigned POST with content-length-range policy
          → On failure: throw AppError immediately — NO quota touched, NO DB row created
  Step 5: BEGIN TRANSACTION
          a. OrganizationRepository.updateStorageUsed(orgId, +sizeBytes)
             → Returns null if quota exceeded → ROLLBACK → 403 PLAN_STORAGE_QUOTA_EXCEEDED
          b. INSERT INTO files (status='pending', storageKey, ...)
          COMMIT
  Step 6: Return { fileId, uploadUrl, uploadFields, expiresAt }
```

### 11.3 ClamAV Integration (audit issue 4.1 fix — nodeclam replaced)

Use the `clamscan` npm package (actively maintained, explicit TCP mode support). `nodeclam@^2.1.2` was last released in 2020 and has open critical issues — do NOT use it.

```typescript
import NodeClam from 'clamscan';

const clamscan = await new NodeClam().init({
  clamdscan: {
    host: config.clamavHost,   // 'clamav' in Docker, '127.0.0.1' locally
    port: config.clamavPort,   // 3310
    timeout: 60000,
    active: true,
  },
  preference: 'clamdscan',
});
```

ClamAV runs as a **separate Docker service** (`clamav/clamav:stable`). The Node.js worker connects via TCP only. ClamAV is NOT installed in the worker container — separate process, separate Docker service.

`VIRUS_SCAN_ENABLED=false` in `.env.example` — developers without ClamAV running can disable scanning locally. In production, must be `true`.

---

## 12. Search Architecture

### 12.1 Search Provider Interface

```typescript
type SearchCollection = 'tasks' | 'messages' | 'files' | 'users';

interface ISearchProvider {
  upsertDocument(collection: SearchCollection, doc: SearchDocument): Promise<void>;
  deleteDocument(collection: SearchCollection, id: string): Promise<void>;
  search(collection: SearchCollection, query: string, filters: SearchFilters, pagination: Pagination): Promise<SearchResult[]>;
  reindexAll(collection: SearchCollection, orgId: string): Promise<void>;
}
```

### 12.2 Typesense (pinned to 26.0 / npm 1.5.4)

Install `typesense@1.5.4` (pinned — no caret). Docker image: `typesense/typesense:26.0`. Both MUST match — version mismatch causes API incompatibility.

Every Typesense search query MUST include `filter_by: 'org_id:={orgId}'`. Unit test asserts this is present on every search call.

### 12.3 Search Index Lag Metric (BUG-NEW-007 fix)

```sql
SELECT EXTRACT(EPOCH FROM NOW() - MIN(occurred_at))
FROM outbox_events
WHERE status = 'pending'
  AND event_type IN (
    'task.created', 'task.updated', 'task.deleted',
    'message.created', 'message.deleted',
    'file.confirmed', 'file.deleted'
  )
```

Explicit IN list — not LIKE patterns. LIKE would match unrelated events and cause operator precedence bugs with multiple OR conditions.

Alert threshold: `search_index_lag_seconds > 60`. Additional alert: `bullmq_queue_depth{queue="search"} > 1000`.

### 12.4 Graceful Degradation

When Typesense circuit breaker is open → fall back to `PostgresFtsProvider` → set `degraded = true` → return `{ results, meta: { search_degraded: true } }`.

---

## 13. Scaling Strategy

### 13.1 Horizontal Scaling

- `app` and `worker` processes are stateless (Socket.IO uses Redis adapter for cross-instance broadcasting).
- BullMQ uses Redis for job coordination — safe to run multiple workers.
- Outbox poller uses `SELECT FOR UPDATE SKIP LOCKED` + Redis distributed lock — safe for multiple pollers.

### 13.2 Database Scaling

- Read replicas for heavy read queries (lists, search, reporting).
- Connection pooling limits: primary 15, replica 10.
- Partitioned tables enable partition pruning for `audit_logs` and `chat_messages`.

### 13.3 Outbox Adaptive Polling (SCALE-NEW-003 fix)

- Full batch (= `OUTBOX_POLL_BATCH_SIZE` events): wait minimum 10ms, then poll immediately.
- Partial batch (< batch size): wait 5 seconds.
- Configurable via `OUTBOX_POLL_BATCH_SIZE` env var (default 100).

---

## 14. Failure Handling & Recovery

### 14.1 Circuit Breakers (opossum)

| Service | Circuit Name | Threshold | Half-Open Delay |
|---|---|---|---|
| Razorpay | `razorpayBreaker` | 5 failures / 30s | 60s |
| SES | `sesBreaker` | 5 failures / 30s | 60s |
| SendGrid | `sendgridBreaker` | 5 failures / 30s | 60s |
| Typesense | `searchBreaker` | 5 failures / 30s | 60s |
| SAML IdP | `samlBreaker` | 3 failures / 30s | 120s |

### 14.2 Graceful Shutdown (audit issue C-05 fix)

The complete SIGTERM handler for `src/app.ts`:

```typescript
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received. Starting graceful shutdown...');

  // Step 1: Stop accepting new HTTP connections
  httpServer.close();

  // Step 2: Stop accepting new Socket.IO connections
  io.close();

  // Step 3: Wait for in-flight HTTP requests (30s max)
  const drainTimeout = setTimeout(() => {
    logger.error('Forced shutdown: 30s drain timeout exceeded.');
    process.exit(1);
  }, 30_000);

  // Step 4: Close DB pools (waits for active queries to complete)
  await primaryPool.end();
  await replicaPool.end();

  // Step 5: Close all Redis connections
  await closeAllRedisClients(); // calls quit() on all 4 clients

  clearTimeout(drainTimeout);
  logger.info('Graceful shutdown complete.');
  process.exit(0);
});
```

For `src/worker.ts`:
```typescript
process.on('SIGTERM', async () => {
  logger.info('Worker SIGTERM. Graceful shutdown...');
  // Step 1: Stop outbox poller
  await outboxPoller.stop();
  // Step 2: Close all BullMQ workers (waits for in-progress jobs)
  await Promise.all(allWorkers.map(w => w.close()));
  // Step 3: Close DB pools
  await primaryPool.end();
  await replicaPool.end();
  // Step 4: Close Redis
  await closeAllRedisClients();
  logger.info('Worker shutdown complete.');
  process.exit(0);
});
```

---

## 15. Observability

### 15.1 Structured Logging

Framework: `pino` with JSON output in production, pretty-print in development.

Mandatory fields: `timestamp`, `level`, `correlation_id`, `service`.
Request logs: `method`, `path`, `status_code`, `duration_ms`, `org_id`, `user_id`.

PII scrubbing: redact keys `password`, `password_hash`, `token`, `access_token`, `refresh_token`, `secret`, `totp_secret`, `totp_secret_encrypted`, `backup_codes`, `mfa_backup_codes`, `api_key`, `webhook_secret`, `encryption_key`, `Authorization` header; also redact strings matching JWT pattern `^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$`.

### 15.2 Prometheus Metrics

Endpoint: `GET /metrics` requires `Authorization: Bearer {METRICS_TOKEN}`. Returns 401 if missing or invalid. NEVER rely on "protected at load balancer" — protection must be in code.

| Metric | Type | Labels |
|---|---|---|
| `http_request_duration_ms` | Histogram | `method`, `route`, `status_code` |
| `http_requests_total` | Counter | `method`, `route`, `status_code` |
| `bullmq_queue_depth` | Gauge | `queue` |
| `bullmq_dlq_depth` | Gauge | `queue` |
| `bullmq_jobs_completed_total` | Counter | `queue` |
| `bullmq_jobs_failed_total` | Counter | `queue` |
| `outbox_pending_events` | Gauge | — |
| `search_index_lag_seconds` | Gauge | — |
| `db_pool_connections_active` | Gauge | `pool` |
| `db_query_duration_ms` | Histogram | `pool`, `operation` |
| `redis_cache_hits_total` | Counter | — |
| `redis_cache_misses_total` | Counter | — |
| `socket_connections_active` | Gauge | — |
| `circuit_breaker_state` | Gauge | `service` (0=closed, 1=open, 2=half-open) |
| `payment_webhook_processed_total` | Counter | `event_type` |

Queue metrics collected every 30 seconds in both `app.ts` and `worker.ts`.

**Alert thresholds:**
- `http_request_duration_ms p95 > 200ms` for > 5 min
- `http_error_rate > 1%` for > 2 min
- `bullmq_dlq_depth{queue="payments"} > 1`
- `bullmq_dlq_depth > 100` for any queue
- `outbox_pending_events > 500`
- `search_index_lag_seconds > 60`
- `bullmq_queue_depth{queue="search"} > 1000`

### 15.3 Distributed Tracing (audit issue C-01 fix)

Framework: OpenTelemetry SDK (pinned versions — no caret).

**Exact dependency versions to pin in `package.json`:**
```json
"@opentelemetry/sdk-node": "0.45.0",
"@opentelemetry/auto-instrumentations-node": "0.39.0",
"@opentelemetry/exporter-trace-otlp-http": "0.45.0"
```

Pinned without `^` because these are pre-1.0 packages with breaking API changes between minor versions.

**CRITICAL — First import (C-01 fix):** The OpenTelemetry SDK MUST be initialized at the absolute top of `src/app.ts` and `src/worker.ts`, before ANY other import. This is required for auto-instrumentation to correctly patch pg, ioredis, and Express.

```typescript
// src/app.ts — FIRST LINES (before any other import)
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const traceExporter = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  ? new OTLPTraceExporter({ url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT })
  : undefined;

const sdk = new NodeSDK({
  traceExporter,
  instrumentations: [getNodeAutoInstrumentations()],
});
sdk.start();

// Only after SDK started — import everything else
import express from 'express';
import helmet from 'helmet';
// ... rest of imports
```

Backend: `OTEL_EXPORTER_OTLP_ENDPOINT` (optional — no-op exporter if not set).

---

## 16. Security Considerations

### 16.1 Input Validation

- All HTTP request bodies validated with Zod schemas at the controller layer.
- Array fields have `maxItems` limits.
- Request body size limit: 1MB default; 10MB for file metadata endpoints.
- Razorpay webhook body parsed with `express.raw()` (not `express.json()`) — raw Buffer required for HMAC verification.

### 16.2 SQL Injection Prevention

Exclusively parameterized queries (`$1, $2, ...` placeholders). Zero string interpolation in SQL. Table and column names never come from user input.

### 16.3 Secrets Management

| Secret | Validation | Generation Command |
|---|---|---|
| `ENCRYPTION_KEY` | Exactly 64 hex chars `[0-9a-f]{64}` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `INVITE_SECRET` | Min 32 chars | `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `METRICS_TOKEN` | Min 16 chars | `node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"` |
| `JWT_PRIVATE_KEY` | Non-empty PEM | Generate RS256 key pair with `openssl` |

**JWT key storage note (audit issue 5.1):** Never log `JWT_PRIVATE_KEY`. In production, mount as a Docker secret or Kubernetes secret rather than an environment variable. If using env var, ensure the container runtime does not expose env vars in process listings or `docker inspect`. Add to RUNBOOK.md: "JWT_PRIVATE_KEY must never appear in logs or monitoring dashboards."

**PostgreSQL replica password (audit issue 5.2):** The `primary_conninfo` in `postgresql.auto.conf` contains the replication password in plaintext, persisted in the Docker volume. For production: create a dedicated PostgreSQL replication user with a separate (rotatable) password. Store that password in a Docker/Kubernetes secret — not the application superuser password.

### 16.4 Helmet Configuration (audit issue C-03 fix)

```typescript
// src/app.ts — configure Helmet with production-appropriate settings
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  frameguard: { action: 'deny' },
  noSniff: true,
  xssFilter: true,
}));
```

### 16.5 CORS Production Guard (audit issue C-02 fix)

```typescript
// In Zod config validation (src/shared/config.ts):
if (process.env.NODE_ENV === 'production' && process.env.CORS_ORIGINS === '*') {
  console.error('❌ CORS_ORIGINS must not be wildcard (*) in production');
  process.exit(1);
}
```

`CORS_ORIGINS` must be a comma-separated list of exact origin strings in production. Default `*` is only acceptable for local development (`NODE_ENV=development`).

### 16.6 Attack Surface Mitigations

| Threat | Control |
|---|---|
| CSRF | Stateless JWT (no cookies) |
| XSS | CSP header; sanitize rich text |
| HTTPS enforcement | HSTS header; load balancer redirect |
| Clickjacking | `X-Frame-Options: DENY` |
| SSRF | DNS resolution + RFC 1918 blocklist + direct-IP connection with Host header |
| Replay attacks | jti + Redis blacklist; idempotency keys; SAML presence-only check |
| Account takeover | MFA, backup codes, lockout, token family revocation + access token blacklist |
| File-based attacks | MIME allowlist, ClamAV (separate service), UUID storage keys |
| Enumeration | Password reset always 200; login error doesn't distinguish wrong email vs wrong password |
| Sensitive fields | `totp_secret`, `password_hash`, `mfa_backup_codes` NEVER in API responses |
| Secrets in logs | Middleware scrubs known sensitive field names and JWT patterns |

### 16.7 Audit Log Immutability

```sql
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_insert_only ON audit_logs
  FOR INSERT TO app_db_user
  WITH CHECK (true);
REVOKE UPDATE ON audit_logs FROM app_db_user;
REVOKE DELETE ON audit_logs FROM app_db_user;
```

CI pipeline grep test: `grep -r "UPDATE.*audit_logs\|DELETE.*audit_logs" src/` MUST return empty.

---

## 17. Deployment Architecture

### 17.1 Docker Compose (Development)

```yaml
version: '3.9'

services:
  app:
    build:
      context: .
      target: production
    command: node dist/app.js
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    env_file: .env
    environment:
      - DATABASE_URL=postgresql://app_user:${POSTGRES_PASSWORD}@postgres:5432/platform_db
      - DATABASE_REPLICA_URL=postgresql://app_user:${POSTGRES_PASSWORD}@postgres-replica:5432/platform_db
      - REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379
      - CLAMAV_HOST=clamav
      - CLAMAV_PORT=3310
      - TYPESENSE_URL=http://search:8108
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/live"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 60s
    restart: unless-stopped

  worker:
    build:
      context: .
      target: production
    command: node dist/worker.js
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    env_file: .env
    environment:
      - DATABASE_URL=postgresql://app_user:${POSTGRES_PASSWORD}@postgres:5432/platform_db
      - DATABASE_REPLICA_URL=postgresql://app_user:${POSTGRES_PASSWORD}@postgres-replica:5432/platform_db
      - REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379
      - CLAMAV_HOST=clamav
      - CLAMAV_PORT=3310
      - TYPESENSE_URL=http://search:8108
    deploy:
      replicas: 2
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: app_user
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: platform_db
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./scripts/postgres-init.sql:/docker-entrypoint-initdb.d/01-init.sql
    command: >
      postgres
        -c wal_level=replica
        -c max_wal_senders=3
        -c max_replication_slots=3
        -c hot_standby=on
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app_user -d platform_db"]
      interval: 5s
      timeout: 5s
      retries: 5
    ports: ["5432:5432"]

  postgres-replica:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: app_user
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      PGDATA: /var/lib/postgresql/data
    volumes:
      - pgreplicadata:/var/lib/postgresql/data
      - ./scripts/replica-entrypoint.sh:/replica-entrypoint.sh
    # CRITICAL (audit issue 7.2 fix): Do NOT mount to /docker-entrypoint-initdb.d/
    # and do NOT override entrypoint. The script starts PostgreSQL itself.
    entrypoint: ["/bin/bash", "/replica-entrypoint.sh"]
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app_user"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  search:
    image: typesense/typesense:26.0
    volumes:
      - searchdata:/data
    environment:
      TYPESENSE_DATA_DIR: /data
      TYPESENSE_API_KEY: ${TYPESENSE_API_KEY}
    ports: ["8108:8108"]

  clamav:
    image: clamav/clamav:stable
    volumes:
      - clamavdata:/var/lib/clamav
    environment:
      CLAMAV_NO_CLAMD: "false"
      CLAMAV_NO_FRESHCLAMD: "false"
    ports: ["3310:3310"]
    healthcheck:
      test: ["CMD", "clamdcheck.sh"]
      interval: 60s
      timeout: 30s
      retries: 3
      start_period: 120s

volumes:
  pgdata:
  pgreplicadata:
  redisdata:
  searchdata:
  clamavdata:
```

### 17.2 Postgres Replica Setup Script (audit issue 7.2 fix)

**Critical fix:** The script must NOT be placed in `/docker-entrypoint-initdb.d/` and the Docker service must NOT use the official Postgres `entrypoint` from `initdb.d`. The official entrypoint only processes `initdb.d` on a completely empty/new data directory. The `entrypoint` override in `docker-compose.yml` calls this script directly as a bash script. The script initializes the data directory via `pg_basebackup` if needed, then calls `exec postgres` to start the server. This is a one-container lifecycle — the script is the process entrypoint.

`scripts/replica-entrypoint.sh`:

```bash
#!/bin/bash
set -e

PRIMARY_HOST="${PRIMARY_HOST:-postgres}"
PRIMARY_PORT="${PRIMARY_PORT:-5432}"
PRIMARY_USER="${POSTGRES_USER:-app_user}"
PRIMARY_PASSWORD="${POSTGRES_PASSWORD}"
PGDATA="${PGDATA:-/var/lib/postgresql/data}"

echo "Waiting for primary at $PRIMARY_HOST:$PRIMARY_PORT..."
until pg_isready -h "$PRIMARY_HOST" -p "$PRIMARY_PORT" -U "$PRIMARY_USER"; do
  echo "Primary not ready, waiting 2s..."
  sleep 2
done
echo "Primary is ready."

if [ ! -f "$PGDATA/PG_VERSION" ]; then
  echo "Data directory empty. Initializing replica via pg_basebackup..."
  PGPASSWORD="$PRIMARY_PASSWORD" pg_basebackup \
    -h "$PRIMARY_HOST" \
    -p "$PRIMARY_PORT" \
    -U "$PRIMARY_USER" \
    -D "$PGDATA" \
    -Fp -Xs -R -P

  # standby.signal is written by pg_basebackup -R flag (PostgreSQL 12+)
  # primary_conninfo is written by pg_basebackup -R flag
  # Verify:
  if [ ! -f "$PGDATA/standby.signal" ]; then
    echo "ERROR: standby.signal not created by pg_basebackup. Check PostgreSQL version."
    exit 1
  fi

  echo "Replica initialization complete."
else
  echo "Data directory already initialized. Starting in replica mode."
fi

# Start PostgreSQL directly (not docker-entrypoint.sh — that would re-run initdb.d)
exec postgres -D "$PGDATA"
```

**Note on `primary_conninfo` password security (audit issue 5.2):** In this script, `pg_basebackup -R` writes the primary connection string (including password) to `postgresql.auto.conf`. For production, use a dedicated replication user with a separate password — not the application superuser password. Store the replication password in a Docker/Kubernetes secret and set `POSTGRES_REPLICATION_PASSWORD` separately from `POSTGRES_PASSWORD`.

### 17.3 Postgres Init Script

`scripts/postgres-init.sql`:

```sql
-- Run as superuser during container init (before app connections)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_db_user') THEN
    CREATE ROLE app_db_user LOGIN PASSWORD :'POSTGRES_PASSWORD';
  END IF;
END;
$$;

GRANT CONNECT ON DATABASE platform_db TO app_db_user;
GRANT USAGE ON SCHEMA public TO app_db_user;
-- Table-level grants are added by migration 014_misc.js
-- audit_logs INSERT-only restriction set in migration 011_audit_outbox.js
```

### 17.4 Dockerfile (Multi-Stage)

```dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

# Install curl for health checks
RUN apk add --no-cache curl

COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY migrations/ ./migrations/

EXPOSE 3000
CMD ["node", "dist/app.js"]
```

**Note:** ClamAV is NOT installed in the Node.js image. It runs as a separate `clamav` Docker service. The worker connects via TCP. This follows Docker single-responsibility principle.

### 17.5 package.json Scripts (audit issue 7.3 fix)

The `package.json` scripts section MUST include ALL of the following. Without these, CI (`npm run build`, `npm run test:unit`, etc.) fails with "missing script":

```json
{
  "scripts": {
    "build": "tsc",
    "start": "node dist/app.js",
    "start:worker": "node dist/worker.js",
    "dev": "ts-node --transpile-only src/app.ts",
    "dev:worker": "ts-node --transpile-only src/worker.ts",
    "migrate:up": "node-pg-migrate up --migration-file-language js",
    "migrate:down": "node-pg-migrate down --migration-file-language js",
    "migrate:test": "DATABASE_URL=$TEST_DATABASE_URL node-pg-migrate up --migration-file-language js",
    "test:unit": "jest --testPathPattern=tests/unit --passWithNoTests --forceExit",
    "test:integration": "jest --testPathPattern=tests/integration --runInBand --passWithNoTests --forceExit",
    "test:e2e": "jest --testPathPattern=tests/e2e --runInBand --passWithNoTests --forceExit",
    "test:smoke": "jest --testPathPattern=tests/smoke --runInBand --passWithNoTests --forceExit",
    "seed:loadtest": "ts-node scripts/seed-loadtest.ts",
    "generate:openapi": "ts-node scripts/generate-openapi.ts",
    "lint": "eslint src --ext .ts --max-warnings 0",
    "typecheck": "tsc --noEmit"
  }
}
```

### 17.6 CI/CD Pipeline

```
1.  lint              → ESLint + TypeScript strict check (npm run typecheck)
2.  secrets-scan      → trufflehog or git-secrets (no hardcoded secrets)
3.  audit-log-check   → grep -r "UPDATE.*audit_logs\|DELETE.*audit_logs" src/ (must return empty)
4.  test:unit         → Jest unit tests (no DB/Redis dependency)
5.  test:integration  → Jest integration tests (TEST_DATABASE_URL; npm run migrate:test first)
6.  build             → tsc compile to dist/
7.  migrate:staging   → Run migrations on staging DB
8.  deploy:staging    → Deploy to staging
9.  test:smoke        → Smoke tests on staging
10. manual-gate       → Human approval for production deploy
11. migrate:prod      → Run migrations on production DB (backward-compatible only)
12. deploy:prod       → Rolling restart (zero-downtime)
13. verify            → Health check polling until /ready returns 200
14. on-failure        → Rollback (redeploy previous image)
```

### 17.7 Non-Functional Targets

| Target | Value | Validation |
|---|---|---|
| API p95 latency | < 200ms | k6/Artillery load test at 100 VUs for 5 min |
| API error rate | < 1% | Load test + production alerts |
| Concurrent users | 100+ (designed for 1000+) | Load test |
| Uptime | 99.9% monthly | Uptime monitoring |
| RTO | < 30 minutes | Disaster recovery drill |
| RPO | < 5 minutes | PostgreSQL WAL archiving |
| Zero-downtime deploys | Required | Rolling restart + health checks |
| GDPR erasure SLA | < 30 days | Async job + monitoring |
| Search index lag | < 60 seconds | `search_index_lag_seconds` alert |
