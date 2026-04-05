# OVERVIEW.md

> **Revision note (full rewrite — all audit fixes applied):** CROSS-002 (MFA backup codes defined as in-scope), SEC-NEW-002 (platform admin session hard expiry, not inactivity timeout), CONSISTENCY-005 (pre-scan file download behavior documented), COMPLETENESS-001 (INVITE_SECRET referenced), COMPLETENESS-002 (ENCRYPTION_KEY requirements stated); plus second-pass audit issues: VideoCall domain model (C-07), notification event type enum (2.9), token storage mechanism for magic link / password reset / email verification (2.6/2.7/2.8), outbox ordering correction (3.1), grace_period_ends_at setter (3.2), SAML cleanup buffer (3.5), CORS production guard (C-02), GDPR export redaction (C-08).

---

## Project Summary

We are building a production-grade, multi-tenant collaborative work platform backend — a single deployable system that gives teams everything they need to plan work, communicate in real time, manage files, and track billing, all within strict per-tenant security boundaries. The system is designed for software development teams and knowledge workers who need task tracking with hierarchy and dependencies, persistent group chat, video call signaling, and structured notifications, delivered over a reliable, observable API that their own front-end or integration clients can consume.

The platform is built as a modular monolith so that it ships quickly and cohesively today, while remaining structured for extraction into independent services as usage scales.

---

## Core Problem Statement

Teams using multiple disconnected tools — a task tracker here, a chat app there, a billing portal somewhere else — lose context, miss updates, and cannot enforce consistent access rules across their organization. This system solves that by providing a single, multi-tenant backend where every feature (tasks, chat, notifications, files, payments) is unified under one security model, one event bus, and one observable API. A tenant's data is always isolated from every other tenant's data, and every actor operates only within the boundaries their role allows.

---

## Key Actors / Personas

| Actor | Description |
|---|---|
| **Platform Admin** | Operator-level super-administrator. Can view, suspend, reactivate, or offboard any tenant organization. Has cross-tenant visibility for compliance and support. Requires TOTP MFA on every session — **hard 1-hour expiry from `mfa_verified_at`** (this is a hard time limit from authentication, NOT an inactivity timeout; activity does NOT extend the session). |
| **Org Owner** | The person who created or was transferred ownership of an organization. Has full control within their org: billing, member management, settings, and deletion. |
| **Org Admin** | A trusted team member elevated to manage members, invite people, manage webhooks, and handle billing within one org. Cannot delete the org or transfer ownership. |
| **Member** | A standard team member. Can create and manage their own tasks, participate in chat, upload files, and view notifications. |
| **Guest** | A limited-access collaborator. Can read tasks and data shared with them but cannot write or create new work items. |
| **System / Worker** | Background processes (BullMQ workers) that perform async operations: sending email, delivering webhooks, indexing search, running cleanups. Not a human actor. |
| **External Integration** | A tenant's own application or CI/CD system that subscribes to outgoing webhooks to react to platform events. |

---

## High-Level Feature Surface

### Task Management

Hierarchical tasks (tasks → subtasks → sub-subtasks, maximum depth 2), dependencies with cycle detection, recurring tasks via RRULE (RFC 5545), bulk operations (up to 100 tasks per call), task templates, activity feed, and @mention support in descriptions and comments.

### Real-Time Collaboration

Live task updates pushed to all collaborators via Socket.IO, typing indicators, presence (online/away/offline), and reconnection with automatic catch-up of missed events via sequence number sync. All inbound Socket.IO events are rate-limited per event type to prevent abuse. WebSocket sessions are periodically re-validated (every 5 minutes) against the database to detect suspended or deleted users — sessions are terminated within 5 minutes of any invalidation event.

### Chat Messaging

Persistent 1:1 and group channels with threading, read receipts, offline delivery, message editing with history, soft delete, and @mentions. One direct channel per user pair per org enforced by database constraint (`direct_channel_pairs` table). Thread replies work correctly across monthly partitions — the parent message is always fetched without a partition filter.

### Video Conferencing (Signaling)

WebRTC signaling relay via Socket.IO for 1:1 and small-group calls. Call state tracked in Redis with 4-hour TTL. Call lifecycle: `ringing → active → ended`. No media storage — signaling only.

### Notifications and Email

Per-user, per-org notification preferences with quiet hours, real-time in-app delivery, email via SES/SendGrid (SES primary, SendGrid fallback), daily digest mode, and RFC 8058-compliant unsubscribe. The complete list of notification event types is defined in SPEC.md §7 and is the authoritative enum — `notification_preferences` rows are seeded for every event type when a member joins an org.

### File Storage

Secure upload via presigned POST (S3) with server-enforced size limits via S3 `content-length-range` policy conditions. Per-org storage quota enforced atomically via conditional UPDATE. Server-side MIME validation, async ClamAV virus scanning via dedicated ClamAV Docker service (TCP connection at port 3310). Files with `scan_status = 'pending'` are **NOT downloadable** until `scan_status = 'clean'` — returns `202 Accepted` with `Retry-After: 30` header when a download is attempted on a pending file. Pluggable storage backend (local for dev, S3 for production).

**Upload sequence:** Presigned URL generated first → if URL generation fails, no quota is touched and no DB row is created → quota reserved and file row inserted atomically in a single DB transaction. This prevents orphaned quota reservations.

### Payments and Billing

Full Razorpay integration: order creation, client-side checkout, server-side HMAC signature verification (timing-safe comparison), webhook processing, subscription lifecycle management, and grace period handling on failure. Grace period check job validates org is `active` before suspending — it does not perform the transition on already-suspended or offboarding orgs. The `grace_period_ends_at` field is explicitly set by the payment worker when a `payment.failed` event is processed.

### Tenant Integrations (Outgoing Webhooks)

Tenants register HTTPS endpoints to receive signed platform events. Delivery includes SSRF protection: DNS resolution + private IP blocklist + direct-IP connection (preventing DNS rebinding). Delivery is tracked, retried with backoff, and has a manual retry API.

### Full-Text Search

Search across tasks, messages, files, and users within an org. PostgreSQL FTS in development; Typesense `0.25.2` in production. Graceful degradation if search service is down — falls back to PostgreSQL FTS with `search_degraded: true` in the response.

### MFA and Backup Codes (CROSS-002 fix)

TOTP-based multi-factor authentication. Users may also generate 8 single-use backup codes (bcrypt-hashed) for account recovery when TOTP device is unavailable. This is a **fully implemented feature**, not a placeholder. Each code is stored as a bcrypt hash (cost 10); successful use removes the hash from the array. A platform admin MFA reset procedure exists for users who lose both their TOTP device and backup codes — documented in `RUNBOOK.md`.

### Auth Token Storage

Magic link tokens, password reset tokens, and email verification tokens are all stored in Redis with TTL-based expiry and single-use invalidation. Redis restart invalidates all outstanding tokens; users must request new tokens. Redis `appendonly yes` persistence mitigates restart losses.

### Multi-Tenant Security and Lifecycle

Every org is a fully isolated tenant. Tenant lifecycle states (`active → suspended → offboarding → deleted`) enforce data access rules. GDPR data export and erasure are supported end-to-end. GDPR user exports redact other users' personal information — only the requesting user's own PII is included in the export.

### Observability and Operations

Structured JSON logs, Prometheus-compatible metrics (Bearer token protected — not just load balancer protected), OpenTelemetry tracing (SDK initialized as the very first import in `app.ts` and `worker.ts`), three health check endpoints, and a suite of platform admin operational tools (replay events, requeue jobs, rotate JWT keys).

---

## System Boundaries

### In Scope

- REST API backend (Node.js / Express)
- Real-time layer (Socket.IO with Redis adapter)
- Background job processing (BullMQ)
- PostgreSQL database (primary + read replica)
- Redis (cache, pub/sub, rate limiting, presence, token storage)
- File storage (S3 in production, local filesystem in dev)
- Email delivery (SES primary, SendGrid fallback)
- Payment processing (Razorpay)
- Full-text search (Typesense in production, PostgreSQL FTS fallback)
- Virus scanning (ClamAV as separate Docker service)
- GDPR tooling (data export, erasure, offboarding)
- Platform admin tooling

### Out of Scope

- Front-end UI (the system provides only an API)
- WebRTC media servers (signaling relay only — no media storage)
- SMS delivery
- CI/CD infrastructure provisioning
- Infrastructure as Code (Terraform / Pulumi)

---

## Technical Constraints

| Constraint | Decision |
|---|---|
| **Runtime** | Node.js 20 LTS, TypeScript strict mode |
| **Framework** | Express 4.x (modular, not NestJS) |
| **Database** | PostgreSQL 16 (primary + replica); `node-pg-migrate` for migrations; no ORMs |
| **Queue** | BullMQ on Redis (all 10 queues share the same Redis instance) |
| **Real-time** | Socket.IO 4.x with `@socket.io/redis-adapter` for multi-instance broadcasting |
| **Multi-tenancy** | Shared database, row-level isolation via `org_id` on every tenant-scoped table |
| **Security** | Passwords: bcrypt cost 12. JWTs: RS256, rotatable with 15-minute overlap. Refresh tokens: 32 cryptographically random bytes (64 hex chars). All token comparisons: `crypto.timingSafeEqual`. Metrics endpoint: Bearer token auth. Platform admin IP allowlist requires correct `trust proxy` config. All secrets via environment variables — never hardcoded. `ENCRYPTION_KEY`: exactly 64 hex chars (32 bytes). `INVITE_SECRET`: minimum 32 chars. `METRICS_TOKEN`: minimum 16 chars. `CORS_ORIGINS` must not be `*` in production. HTTPS only in production. |
| **Compliance** | GDPR: right of access, right to erasure, right to portability. Payment records retained minimum 7 years. Audit logs retained minimum 1 year. PII anonymized within 30 days of erasure request. Audit logs immutable at DB layer (RLS + no DELETE/UPDATE grants). |
| **Reliability** | RTO < 30 minutes. RPO < 5 minutes (PostgreSQL WAL archiving). Zero-downtime deployments required. Graceful shutdown with in-flight drain (30s max for HTTP, full BullMQ job drain). |
| **Performance** | API p95 latency < 200ms. Error rate < 1%. Validated by k6 or Artillery load test at 100 concurrent users for 5 sustained minutes. |

---

## Success Criteria

The system is working correctly at launch when all of the following are verified:

1. A tenant can be created, atomically provisioned with a default workspace and roles and notification preferences for all standard event types, and all members can log in, create tasks, assign them, and receive real-time updates within their isolated org.
2. A member can send and receive chat messages in 1:1 and group channels, with offline catch-up working correctly on reconnect via sequence number sync. Thread replies to messages in different monthly partitions work correctly.
3. A payment flow can be completed end-to-end: order created, Razorpay webhook received and HMAC-signature-verified (timing-safe), subscription activated, and plan limits enforced correctly.
4. A file can be uploaded via presigned POST (S3) with `content-length-range` enforcement, confirmed, virus-scanned asynchronously via ClamAV service (TCP), and downloaded with atomic quota enforcement blocking over-quota uploads. Pre-scan download attempts return `202 Accepted` with `Retry-After: 30`.
5. An org can be suspended on payment failure (after grace period, with `grace_period_ends_at` explicitly set by the payment worker), reactivated on recovery, and fully offboarded with PII anonymization — all operations idempotent.
6. An authenticated user from Org A receives a 403 or empty result for all attempts to access Org B's data across every endpoint. Zero cross-tenant data leakage in search results.
7. API p95 latency stays below 200ms and error rate below 1% under a 100-concurrent-user load test for 5 sustained minutes.
8. The system survives a Redis failure and a search service failure without losing task or chat data; degraded features return appropriate warnings.
9. A platform admin (with MFA) can suspend, reactivate, replay events, and view cross-tenant audit logs; all platform admin actions appear in the audit log synchronously before the HTTP response is returned. Platform admin session expires exactly 1 hour from MFA verification (hard expiry, not inactivity).
10. GDPR export and erasure jobs complete with all PII fields anonymized within the defined SLA. Payment records are retained. Erasure requires re-authentication within 5 minutes. Exported data does not contain other users' PII.
11. MFA backup codes can be generated, used (single-use), and audited. A platform admin can reset MFA for a user who has lost both TOTP device and backup codes.
12. WebSocket sessions are terminated within 5 minutes of a password change or account suspension.

---

## Glossary

| Term | Definition |
|---|---|
| **Tenant / Org** | An `Organization` record. The root unit of data isolation. |
| **org_id** | The UUID primary key of an Organization. |
| **Workspace** | A named container for boards and tasks within an org. |
| **Board / Sprint** | A grouping of tasks within a workspace. |
| **Task** | The primary unit of work. Can have a parent task (subtask hierarchy up to depth 2). |
| **Subtask** | A task with `parent_task_id` set and `depth = 1`. |
| **RRULE** | RFC 5545 recurrence rule string (e.g., `FREQ=WEEKLY;BYDAY=MO`) used to define recurring task schedules. |
| **Outbox Pattern** | Domain writes and event records committed in the same DB transaction; background poller publishes them. |
| **OutboxEvent** | A row in `outbox_events` representing a domain event pending publication. |
| **Idempotency Key** | A client-supplied key that makes a mutation safe to retry. Required on POST, PUT, PATCH. Not required on DELETE. |
| **Optimistic Locking** | Each mutable entity carries a `version` integer. Updates assert the expected version; mismatch returns 409. |
| **Soft Delete** | Marking a record as deleted by setting `deleted_at` instead of removing the row. All queries filter `WHERE deleted_at IS NULL`. |
| **ABAC** | Attribute-Based Access Control. Extends role checks with contextual conditions. |
| **RBAC** | Role-Based Access Control. Permissions derived from the user's assigned role within an org. |
| **Token Family** | A chain of refresh tokens linked by `family_id`. Any revoked token re-presented unconditionally triggers full family revocation. |
| **DLQ** | Dead-Letter Queue. Where BullMQ jobs land after exhausting all retries. |
| **Circuit Breaker** | Resilience pattern via `opossum` library. Stops calling failing external services until they recover. |
| **Presence** | Real-time tracking of whether a user is online/away/offline, stored in Redis with TTL-based heartbeat. |
| **Channel** | A chat room — `direct` (2-person) or `group` (named, 2+ person). |
| **sequence_number** | Server-assigned, strictly monotonically increasing integer per chat channel. Used for ordered delivery and offline catch-up. |
| **Presigned POST** | S3 upload mechanism with server-enforced policy conditions (`content-length-range`, MIME type). Prevents clients from bypassing file size limits. |
| **Presigned URL** | Time-limited pre-authenticated URL for S3 download (GetObject). |
| **SAML / SSO** | Security Assertion Markup Language / Single Sign-On. Enterprise authentication. |
| **Plan Tier** | Subscription level (`free`, `pro`, `business`, `enterprise`), determines feature access, member limits, storage quotas. |
| **Grace Period** | 7-day window after payment failure during which the org retains access before suspension. `grace_period_ends_at` is explicitly set by the payment worker on `payment.failed` event. |
| **Offboarding** | 30-day period after tenant requests deletion. Data can be exported; PII anonymized at end. |
| **Expand-Contract** | Zero-downtime DB migration pattern: add (expand), backfill, switch, remove (contract). |
| **Socket.IO Room** | Named group in Socket.IO for broadcasting events to subscribed clients. |
| **WebRTC Signaling** | Exchange of session metadata (SDP offers/answers, ICE candidates) for peer-to-peer video calls. Platform handles signaling only — not media. |
| **WAL** | Write-Ahead Log. PostgreSQL's mechanism for durability and point-in-time recovery. |
| **tsvector** | PostgreSQL data type for preprocessed full-text search documents. |
| **HMAC-SHA256** | Cryptographic MAC used to sign outgoing webhook payloads and verify Razorpay webhook signatures. All comparisons use `crypto.timingSafeEqual`. |
| **PII** | Personally Identifiable Information. Fields anonymized on GDPR erasure. |
| **Bounded Context** | Module boundary within the modular monolith. Owns its tables exclusively. |
| **READ REPLICA** | PostgreSQL instance receiving continuous changes from primary. Used for read-heavy queries. |
| **Graceful Shutdown** | Ordered shutdown: stop HTTP, drain in-flight (30s max), drain BullMQ, close DB pools, close Redis (all 4 clients). |
| **UploadSpec** | Return type of `IStorageProvider.generateUploadUrl`: `{ url, fields?, expiresAt }`. `fields` is S3 presigned POST form fields. |
| **appReady** | Internal boolean flag — true after all migrations complete. `/ready` returns 503 until true. |
| **DNS Rebinding** | Attack where hostname resolves to public IP at check time but private IP at connection time. Mitigated by resolving once and connecting directly to the resolved IP. |
| **MFA Backup Codes** | 8 single-use alphanumeric codes generated per MFA enrollment. Each stored as a bcrypt hash (cost 10). Consuming a code removes it from the array. Fully implemented feature. |
| **INVITE_SECRET** | Environment variable (min 32 chars) used as the HMAC key for signing invitation tokens. Must be defined in `.env`. Validated at startup by Zod schema. |
| **ENCRYPTION_KEY** | Environment variable — exactly 64 hexadecimal characters (32 bytes) — used for AES-256-GCM encryption of TOTP secrets and webhook secrets. Must be defined in `.env`. Validated at startup. |
| **METRICS_TOKEN** | Environment variable (min 16 chars) used as Bearer token for authenticating `GET /metrics` requests. |
| **REDIS_SENTINEL_HOSTS** | Optional environment variable — comma-separated `host:port` list. When set, all 4 Redis clients are initialized in Sentinel mode instead of standalone mode. Required for production HA Redis. |
| **Platform Admin Hard Expiry** | Platform admin sessions expire exactly 1 hour after `mfa_verified_at`. This is NOT an inactivity timeout. Activity does not extend the session. After 1 hour, a new MFA verification is required. |
| **SamlUsedAssertion** | Record in `saml_used_assertions` for replay prevention. Presence check only — if row exists for `(assertion_id, org_id)`, the assertion is rejected regardless of `not_on_or_after`. Cleanup purges rows where `not_on_or_after < NOW() - INTERVAL '24 hours'` (24-hour buffer for safety). |
| **Direct Channel Pair** | Record in `direct_channel_pairs` enforcing the one-direct-channel-per-user-pair invariant via DB primary key constraint. |
| **Adaptive Outbox Polling** | Outbox poller immediately re-polls after a full batch (minimum 10ms delay). Waits 5 seconds after a partial batch. Configurable via `OUTBOX_POLL_BATCH_SIZE`. |
| **auth_time** | JWT claim (Unix timestamp) recording when the user authenticated. Required for GDPR erasure re-auth gate (must authenticate within 5 minutes of `DELETE /api/v1/me`) and platform admin session expiry check. |
| **Pre-scan Download Block** | Files with `scan_status = 'pending'` return `202 Accepted` with `Retry-After: 30` header when download is attempted. Only `scan_status = 'clean'` files are downloadable. |
| **VideoCall** | Domain model in `video_calls` table. Tracks `state` (ringing, active, ended), `initiator_id`, `channel_id`, timestamps. Real-time state in Redis `call:state:{callId}` (4h TTL). |
| **Notification Event Types** | The complete authoritative enum of notification event types is defined in SPEC.md §7. `notification_preferences` rows are seeded for every type on member join. |
