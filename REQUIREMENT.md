# REQUIREMENT.md

> **Revision note (full rewrite — all audit fixes applied):** FR-006 (SAML replay logic), FR-013 (Redis cache invalidation on password change), FR-061 (pre-scan download returns 202), FR-015 (MFA backup codes defined), NFR-037 (audit log RLS), all env variable requirements; plus all second-pass audit issues: magic link / password reset / email verification token storage definitions (audit 2.6/2.7/2.8), outbox ordering correction (3.1), grace_period_ends_at setter (3.2), token family revocation + access token blacklist (3.3), SAML cleanup buffer (3.5), notification event type enum (2.9), VideoCall domain model (C-07), GDPR export redaction (C-08), CORS production guard (C-02), Helmet config (C-03), Razorpay payload schema (C-04), SIGTERM handler (C-05), outbox min polling delay (C-06), WebSocket re-auth (5.6), Redis Sentinel support (2.4), per-channel sequence scale note, nodeclam → clamscan (4.1), email template pipeline order (4.2), OTel version pinning (4.3), Razorpay TS types (4.4), app/worker Docker service definitions (4.5), npm scripts (7.3).

---

## Functional Requirements

### Authentication (FR-001 – FR-020)

**FR-001: Email/Password Registration**
The system must allow a user to register with an email address and password.
Acceptance criteria: POST /api/v1/auth/register with valid email and password (min 8 chars) returns 201 with user object; duplicate email returns 409; invalid fields return 400 with field-level error details.
Priority: Critical
Source: SPEC.md §6.1

**FR-002: Email Verification Gate**
A registered user must not access any org resource until `email_verified = TRUE`.
Acceptance criteria: Any authenticated request to a resource endpoint returns 403 with code `EMAIL_NOT_VERIFIED` if `email_verified = false`; verification email sent on registration via outbox event `user.email_verification_requested`; token stored in Redis `email_verify:{sha256_of_token}` with 24-hour TTL; clicking the verification link sets `email_verified = true` and deletes the Redis key (one-time use); second use of the same token returns 401.
Priority: Critical
Source: SPEC.md §4.2 INV-USR-01

**FR-003: Email/Password Login**
The system must authenticate a user with email and password and return a JWT access token and a refresh token.
Acceptance criteria: POST /api/v1/auth/login with valid credentials returns 200 with `access_token` (expires in 900s), `refresh_token`, and user object; invalid credentials return 401; locked account returns 403 with code `ACCOUNT_LOCKED`; unverified email returns 403 with code `EMAIL_NOT_VERIFIED`. JWT `access_token` MUST contain `auth_time` claim set to `Math.floor(Date.now() / 1000)` at the moment of authentication.
Priority: Critical
Source: SPEC.md §6.1, §9.1

**FR-004: Google OAuth Login**
The system must allow login via Google OAuth using a Google ID token.
Acceptance criteria: POST /api/v1/auth/oauth/google with valid `id_token` returns 200 (existing user) or 201 (new user) with JWT pair including `auth_time` claim; invalid/expired token returns 401.
Priority: High
Source: SPEC.md §6.1

**FR-005: Magic Link (Passwordless) Login**
The system must support passwordless login via a time-limited signed link sent to the user's email.
Acceptance criteria: POST /api/v1/auth/magic-link/request always returns 200 (no enumeration); token stored in Redis `magic:{sha256_of_token}` with 15-minute TTL containing `{ userId, orgId }`; GET /api/v1/auth/magic-link/verify?token=... with valid token deletes the Redis key (one-time use) and returns 200 with JWT pair including `auth_time` claim; second use of same token returns 401; Redis restart invalidates all outstanding tokens (users request a new token).
Priority: High
Source: SPEC.md §6.1

**FR-006: SAML 2.0 / SSO (Enterprise)**
The system must support SAML 2.0 SP-initiated SSO for orgs on an enterprise plan.
Acceptance criteria: GET /api/v1/auth/saml/:org_id/initiate redirects to configured IdP (wrapped in samlBreaker circuit breaker); POST /api/v1/auth/saml/:org_id/callback validates assertion signature and NotOnOrAfter; valid assertion issues JWT pair including `auth_time` claim; replay of same assertion returns 400 SAML_ASSERTION_REPLAYED. SAML only available on enterprise plan.

Replay prevention (CONSISTENCY-003 fix): Query `saml_used_assertions` for `WHERE assertion_id = $id AND org_id = $orgId`. If ANY row is found, reject with `400 SAML_ASSERTION_REPLAYED`. Do NOT check `not_on_or_after` in the gate condition — presence in the table is the sufficient and complete signal.

Cleanup buffer (audit issue 3.5 fix): The cleanup job purges rows WHERE `not_on_or_after < NOW() - INTERVAL '24 hours'` (24-hour buffer). This prevents the cleanup job from removing an assertion that just expired, which could create a brief window allowing replay. Rows are retained for at least 24 hours after their `not_on_or_after` timestamp.

Priority: Medium
Source: SPEC.md §4.2 INV-AUTH-03, §1.23

**FR-007: JWT Refresh Token Rotation**
The system must rotate refresh tokens on every use; reusing an old token must revoke the entire token family unconditionally.
Acceptance criteria: POST /api/v1/auth/refresh with valid token returns new access + refresh tokens and revokes the old refresh token; presenting a revoked token returns 401 TOKEN_FAMILY_REVOKED; ALL tokens in that family are immediately revoked in DB.

In-flight access token blacklist (audit issue 3.3 fix): On family revocation, the `last_access_token_jti` stored on the refresh token row MUST be added to the Redis blacklist with the remaining access token TTL. This closes the window where a revoked family's access tokens could continue to be used for up to 15 minutes. Requires: `last_access_token_jti VARCHAR` column on `refresh_tokens` table, populated at each refresh operation.

Priority: Critical
Source: SPEC.md §4.2 INV-AUTH-01

**FR-008: Logout**
The system must revoke the active access token and refresh token on logout.
Acceptance criteria: POST /api/v1/auth/logout marks refresh token as revoked in DB and adds access token `jti` to Redis blacklist with remaining TTL; subsequent requests with the blacklisted access token return 401.
Priority: Critical
Source: SPEC.md §6.1

**FR-009: Password Reset**
The system must provide a secure password reset flow with time-limited tokens stored in Redis.
Acceptance criteria: POST /api/v1/auth/password-reset/request always returns 200 (no enumeration); token stored in Redis `pwd_reset:{sha256_of_token}` with 1-hour TTL; POST /api/v1/auth/password-reset/confirm with valid token sets new password, sets `password_changed_at`, revokes all existing refresh tokens, immediately deletes Redis user cache key `user:cache:{userId}` (SEC-NEW-001 fix — eliminates 60-second bypass window), deletes the Redis reset key; expired or already-used token returns 401; all existing sessions return 401 on next request.
Priority: Critical
Source: SPEC.md §4.2 INV-USR-05

**FR-010: Account Lockout**
The system must lock a user account after N consecutive failed login attempts (N configurable per org, default 5).
Acceptance criteria: After N failed attempts, subsequent login returns 403 with code `ACCOUNT_LOCKED` and a `locked_until` timestamp; lockout cleared by platform admin unlock tool or expiry.
Priority: High
Source: SPEC.md §4.2 INV-USR-04

**FR-011: MFA / TOTP Enrollment and Verification**
The system must support TOTP-based MFA enrollment, verification, and backup codes per user.
Acceptance criteria: TOTP secret stored encrypted at rest using AES-256-GCM with `ENCRYPTION_KEY`; MFA challenge injected into login flow when `totp_enabled = true`; invalid TOTP code returns 401; `mfa_required = true` on org forces all members to complete MFA enrollment; POST /api/v1/auth/mfa/backup-codes/generate returns 8 single-use codes; each code stored as bcrypt hash (cost 10) in `users.mfa_backup_codes[]` array; POST /api/v1/auth/mfa/backup-codes/use consumes one code (removes hash from array) and logs `user.backup_code_used` audit event; using a code that doesn't match returns 401; using an already-consumed code returns 401. Platform admin can reset MFA for a user (documented in RUNBOOK.md).
Priority: High
Source: SPEC.md §4.6, §1.31

**FR-012: JWT Key Rotation**
The system must support RS256 key rotation with a 15-minute graceful overlap period.
Acceptance criteria: New key pair activatable via admin tool; both old and new keys accepted for 15 minutes; after overlap, only new key accepted; rotation logged in audit log.
Priority: High
Source: SPEC.md §9.1

**FR-013: Session Invalidation on Password Change**
Changing a password must immediately invalidate all existing sessions with zero bypass window.
Acceptance criteria: After password change: all previously issued refresh tokens marked revoked in DB; `password_changed_at` updated; Redis user cache key `user:cache:{userId}` deleted immediately (SEC-NEW-001 fix — forces JWT middleware to re-fetch user on next request, seeing updated `password_changed_at`); subsequent requests with old tokens return 401 on the very next request (no 60-second bypass window).
Priority: Critical
Source: SPEC.md §4.2 INV-USR-05

**FR-014: Rate Limiting on Auth Endpoints**
Auth endpoints must be rate-limited per IP to prevent brute-force attacks.
Acceptance criteria: More than 10 login requests from same IP within 60s returns 429 with `Retry-After` header; more than 5 registration requests from same IP within 60s returns 429; rate limit counters are Redis-backed with in-process fallback if Redis is down (per-process only — documented degradation).
Priority: Critical
Source: SPEC.md §9.2

**FR-015: Account Linking Between Auth Providers**
A user must be able to link multiple auth providers to the same account.
Acceptance criteria: A user logged in via email can link their Google account; linked provider stored in `auth_providers`; user can then log in via either provider.
Priority: Medium

**FR-016: Consent and ToS Tracking**
The system must record the version and timestamp of Terms of Service and Privacy Policy accepted by each user.
Acceptance criteria: `consent_tos_version`, `consent_tos_at`, and `privacy_policy_version` stored per user; included in GDPR data export; PATCH /api/v1/me/consent updates them.
Priority: Medium
Source: SPEC.md §1.2

**FR-017: General Rate Limiting (Per User, Per Tenant, Per Endpoint)**
The system must enforce rate limits per user and per org on all endpoints.
Acceptance criteria: Configurable rate limits per endpoint class; Redis sliding window; 429 with `Retry-After` header on excess; in-process fallback when Redis unavailable; WebSocket events also rate-limited (task:subscribe 20/60s, presence:heartbeat 1/10s, call:ice-candidate 100/1s, typing:start 1/1s/channel); during Redis outage, per-process in-memory fallback applies — effective limit is `configured_limit × process_count` (documented limitation).
Priority: High
Source: SPEC.md §3.1, ARCHITECTURE.md §5.2

**FR-018: JWT auth_time Claim**
All issued JWT access tokens must include an `auth_time` claim.
Acceptance criteria: `auth_time` is set on login, OAuth callback, magic link verify, and SAML callback; it is NOT updated on token refresh; the GDPR erasure endpoint checks `auth_time` is within 5 minutes (300 seconds); a token without `auth_time` returns 403 MISSING_AUTH_TIME when attempting erasure.
Priority: Critical
Source: SPEC.md §9.1, COMPLETENESS-009 fix

**FR-019: WebSocket Session Re-validation**
WebSocket connections must be periodically re-validated to detect invalidated sessions.
Acceptance criteria: Per-socket background check every 5 minutes queries DB for `user.status = 'active'` and `membership.status = 'active'`; on failure: emit `session:expired` then disconnect; on password change or account suspension, outbox event `session.revoked` causes worker to emit `session:expired` to `org:{orgId}:user:{userId}` room; all connected sockets for the affected user are disconnected within 5 minutes.
Priority: High
Source: SPEC.md §12.5, audit issue 5.6

---

### Organization Management (FR-021 – FR-030)

**FR-021: Org Creation with Atomic Provisioning**
The system must atomically provision a new organization with all required defaults.
Acceptance criteria: POST /api/v1/organizations creates org, membership (org_owner), default workspace, default notification preferences for ALL event types in SPEC.md §7 `NOTIFICATION_EVENT_TYPES` enum, and a free subscription record — all in a single DB transaction. If any step fails, the entire transaction rolls back. Returns 201 with full org object.
Priority: Critical
Source: SPEC.md §4.1 INV-ORG-02

**FR-022: Org Lifecycle State Machine**
The system must enforce valid organization state transitions.
Acceptance criteria: `suspendOrg` ONLY transitions from `active`; if org is already `suspended`, `offboarding`, or `deleted`: log WARN and return without emitting events or modifying any DB rows (BUG-NEW-003 fix); `reactivateOrg` ONLY transitions from `suspended`; `startOffboarding` ONLY from `active` or `suspended`; invalid transitions return 422 INVALID_STATE_TRANSITION.
Priority: Critical
Source: SPEC.md §5.1

**FR-023: Member Invitation Flow**
The system must support inviting members to an org via email.
Acceptance criteria: POST /api/v1/org/:org_id/invitations creates invitation with HMAC token (signed using `INVITE_SECRET` — validated at startup as min 32 chars), 72-hour expiry, sends invite email via outbox event; accepting an expired/revoked invitation returns 410; accepting valid invitation creates membership; re-inviting same email while pending invitation exists returns 409; inviting when at member limit returns 403 PLAN_MEMBER_LIMIT_EXCEEDED.
Priority: High
Source: SPEC.md §1.24, COMPLETENESS-001 fix

**FR-024: Member Role Management**
The system must allow org admins to change member roles.
Acceptance criteria: PATCH /api/v1/org/:org_id/members/:user_id/role; org_admin cannot elevate to org_admin unless they are org_owner; cannot change role of last org_owner; returns 200 with updated membership.
Priority: High

**FR-025: Storage Quota Enforcement**
The system must atomically enforce per-org storage quotas.
Acceptance criteria: Quota reservation uses atomic conditional UPDATE: `UPDATE organizations SET storage_used_bytes = storage_used_bytes + $delta WHERE id = $orgId AND storage_used_bytes + $delta <= storage_quota_bytes RETURNING *`; zero rows = quota exceeded → 403 PLAN_STORAGE_QUOTA_EXCEEDED; S3 URL generation happens BEFORE quota reservation (BUG-NEW-004 fix); two concurrent requests that together exceed quota result in exactly one success and one rejection.
Priority: Critical
Source: SPEC.md §4.1 INV-ORG-03

**FR-026: Recurring Tasks**
The system must support recurring task creation using RFC 5545 RRULE strings.
Acceptance criteria: Tasks with `is_recurring = true` and valid RRULE generate next occurrence on completion using the `rrule` npm library; deduplication enforced via `UNIQUE INDEX idx_tasks_recurrence_dedup ON tasks(recurrence_parent_id, (due_date::date)) WHERE recurrence_parent_id IS NOT NULL AND deleted_at IS NULL`; this index MUST be created in migration `005_tasks.js`; if next instance already exists (index conflict), creation is silently skipped.
Priority: High
Source: SPEC.md §5.3, COMPLETENESS-007 fix

**FR-027: Task Dependency Cycle Detection**
Creating a task dependency that would form a circular chain must be rejected.
Acceptance criteria: POST to create dependency runs DFS cycle detection; circular dependency returns 422 with the cycle path in error details.
Priority: High
Source: SPEC.md §4.3 INV-TASK-03

**FR-028: Bulk Task Operations**
The system must support bulk task operations.
Acceptance criteria: POST /api/v1/org/:org_id/tasks/bulk with up to 100 task IDs; returns partial success with per-task results; requires org_admin role.
Priority: Medium
Source: SPEC.md §6.5

**FR-029: Task Templates**
The system must support creating tasks from templates.
Acceptance criteria: POST with `template_id` applies default values from the template; template defaults can be overridden.
Priority: Low

**FR-030: Task Activity Feed**
Every mutation on a task must generate an activity log entry.
Acceptance criteria: GET /api/v1/org/:org_id/tasks/:task_id/activity returns chronological list of activity events with actor, timestamp, and changed fields.
Priority: Medium

---

### Chat (FR-031 – FR-038)

**FR-031: Channel Management**
The system must support creating and managing direct and group channels.
Acceptance criteria: POST /api/v1/org/:org_id/channels creates group channel; POST /api/v1/org/:org_id/channels/direct creates or returns existing direct channel (deduplication via `direct_channel_pairs` PK — ON CONFLICT returns existing channel with 200); direct channel has exactly 2 members and null name; group channel requires name. On channel creation, `create_channel_sequence(channelId)` MUST be called to create the per-channel PostgreSQL sequence.
Priority: High
Source: SPEC.md §4.4 INV-CHAT-01, COMPLETENESS-008 fix

**FR-032: Message Persistence and Sequence**
Every chat message must be persisted with a server-assigned monotonically increasing sequence number per channel.
Acceptance criteria: Messages assigned sequence numbers via per-channel PostgreSQL sequences (SELECT nextval on PRIMARY pool only); duplicate `client_message_id` for same channel returns existing message without creating a new row; sequence numbers are gapless within a channel.
Priority: Critical
Source: SPEC.md §4.4 INV-CHAT-02/03

**FR-033: Chat Spam Throttling**
Chat message sending must be rate-limited.
Acceptance criteria: More than 60 messages within 10 seconds per user in any channel returns error (WebSocket) or 429 (HTTP); tracked per user via Redis sliding window.
Priority: High
Source: SPEC.md §3.1

**FR-034: Message Editing with History**
Users may edit their own messages; edit history must be preserved.
Acceptance criteria: PATCH by message sender updates `body`, sets `is_edited = true`, appends `{body, edited_at}` to `edit_history` array; non-sender returns 403.
Priority: Medium

**FR-035: Thread Replies and Cross-Partition Support**
Messages may be replied to in threads; thread replies must work across monthly partitions.
Acceptance criteria: Sending a message with `parent_message_id` creates a thread reply; application validates parent message exists by querying WITHOUT a `created_at` partition filter (so all partitions are scanned); cross-partition threads work correctly (BUG-NEW-005 fix). Integration test required: "thread reply to a message from a different calendar month succeeds."
Priority: Medium

**FR-036: Read Receipts**
The system must track per-user, per-channel read position.
Acceptance criteria: `channel_members.last_read_sequence` updated when user reads messages; GET /api/v1/org/:org_id/channels returns unread count per channel.
Priority: Medium

**FR-037: Offline Message Catch-Up**
Users must receive missed messages on reconnect.
Acceptance criteria: On `client:sync({ channelId, lastSequence })` WebSocket event, server emits all messages with `sequence_number > lastSequence`; exact set, no duplicates, correct order.
Priority: Critical
Source: SPEC.md §10.3

**FR-038: Message Soft Delete**
Messages may be soft-deleted; content hidden but record retained.
Acceptance criteria: DELETE sets `deleted_at = NOW()`; subsequent read returns body as null with `deleted: true`; sequence number retained.
Priority: Medium

---

### Notifications and Email (FR-039 – FR-044)

**FR-039: In-App Notifications**
The system must create and deliver in-app notifications for key events.
Acceptance criteria: Events from SPEC.md §7 `NOTIFICATION_EVENT_TYPES` enum generate notifications; GET /api/v1/org/:org_id/notifications returns paginated list; unread count is accurate.
Priority: High

**FR-040: Notification Preferences**
Users must be able to configure per-event-type notification preferences.
Acceptance criteria: GET/PATCH /api/v1/org/:org_id/notification-preferences; per event type: in-app toggle, email toggle, digest mode (`realtime` / `daily_digest`), quiet hours (start time, end time); preferences respected during delivery. Rows seeded for all event types in `NOTIFICATION_EVENT_TYPES` enum on member join.
Priority: High

**FR-041: Email Delivery with Failover**
The system must deliver notification emails with automatic provider failover.
Acceptance criteria: SES is primary; when SES circuit breaker is open, attempt SendGrid; when both open, DLQ the job; templates rendered by running Handlebars first (resolves `{{}}` tokens) then MJML (renders HTML) — this order is mandatory; RFC 8058-compliant List-Unsubscribe header included.
Priority: High
Source: ARCHITECTURE.md §6.2

**FR-042: Daily Email Digest**
Users with digest mode enabled must receive a daily summary email.
Acceptance criteria: Daily BullMQ job collects unread notifications since last digest, grouped by event type; single digest email sent at 08:00 user's local time; respects quiet hours; idempotency via Redis key prevents double-sending.
Priority: Medium

**FR-043: Real-Time Notification Delivery**
Notifications must be pushed in real time to connected clients.
Acceptance criteria: When notification created for connected user, notification emitted immediately to socket room `org:{org_id}:user:{user_id}`.
Priority: High

**FR-044: Verification Email on Registration**
The system must send a verification email on user registration.
Acceptance criteria: `register` writes outbox event `user.email_verification_requested` with `{ userId, email, token_hash, expires_at }`; token stored in Redis `email_verify:{hash}` with 24h TTL; notification worker subscribes to this event and triggers email delivery; `email-verification.hbs` template required.
Priority: Critical
Source: SPEC.md §7 (GAP-010 fix)

---

### File Storage (FR-045 – FR-051)

**FR-045: Presigned POST Upload URL**
The system must generate S3 presigned POST URLs with server-enforced constraints.
Acceptance criteria: POST /api/v1/org/:org_id/files/upload-url with valid mime_type and size_bytes returns `{ fileId, uploadUrl, uploadFields, expiresAt }`; `uploadFields` contains S3 POST policy fields including `content-length-range`; URL generated using `@aws-sdk/s3-presigned-post` package (NOT `@aws-sdk/s3-request-presigner` PutObject).
Priority: Critical
Source: SPEC.md §11.2

**FR-046: Upload Sequence**
Upload URL generation and quota reservation must follow the correct sequence.
Acceptance criteria: MIME allowlist check → per-plan size check → generate storage key → generate presigned URL (if this fails, return error immediately — NO quota touched, NO DB row created) → atomically reserve quota AND insert file row in single DB transaction → return response.
Priority: Critical
Source: SPEC.md §4.5 INV-FILE-02, BUG-NEW-004 fix

**FR-047: Upload Confirmation**
The client must confirm file upload after completing the S3 POST.
Acceptance criteria: POST /api/v1/org/:org_id/files/:id/confirm updates status to `confirmed`, writes outbox event `file.confirmed`, enqueues virus scan job.
Priority: Critical

**FR-048: Virus Scan**
Confirmed files must be asynchronously virus-scanned by ClamAV.
Acceptance criteria: `virus-scan` BullMQ job downloads file to `/tmp`, scans via ClamAV TCP connection using `clamscan` npm package (NOT `nodeclam` — abandoned since 2020); clean → `scan_status = 'clean'`; infected → `scan_status = 'infected'`, `status = 'quarantined'`, quota reclaimed, outbox event `file.quarantined`; temp file deleted in finally block; if `VIRUS_SCAN_ENABLED = false`, set `scan_status = 'clean'` immediately.
Priority: High
Source: ARCHITECTURE.md §11.4

**FR-049: File Download URL**
The system must generate presigned download URLs for clean, confirmed files.
Acceptance criteria: GET /api/v1/org/:org_id/files/:id/download-url:
- `status = 'confirmed'` AND `scan_status = 'clean'` → presigned URL (1-hour TTL)
- `scan_status = 'pending'` → `202 Accepted` with `Retry-After: 30` header and body `{ "message": "File scan in progress", "retry_after": 30 }` (CONSISTENCY-005 fix)
- `status = 'quarantined'` → 422 FILE_QUARANTINED
Only org members may download.
Priority: Critical
Source: SPEC.md §4.5 INV-FILE-01

**FR-050: Pending File Cleanup**
The system must automatically clean up timed-out pending uploads.
Acceptance criteria: BullMQ repeat job every 1 hour; finds `status = 'pending'` files with `created_at < NOW() - INTERVAL '1 hour'`; reclaims quota, soft-deletes file row.
Priority: High

**FR-051: MIME Type Allowlist**
Only approved MIME types may be uploaded.
Acceptance criteria: Allowlist: `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `application/pdf`, `text/plain`, `application/zip`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`; request with disallowed MIME returns 422.
Priority: High

---

### Payments (FR-052 – FR-058)

**FR-052: Razorpay Order Creation**
The system must create Razorpay payment orders.
Acceptance criteria: POST creates Razorpay order via API (wrapped in razorpayBreaker); inserts payment record; returns order details; idempotent via Idempotency-Key header.
Priority: High

**FR-053: Payment Verification**
The system must verify Razorpay payment signatures server-side.
Acceptance criteria: Verify HMAC-SHA256 using `RAZORPAY_KEY_SECRET`; comparison MUST use `crypto.timingSafeEqual`; invalid signature returns 400; valid → update payment status; write outbox event.
Priority: Critical

**FR-054: Razorpay Webhook Processing**
The system must process Razorpay webhooks idempotently.
Acceptance criteria: Body parsed with `express.raw()` (NOT `express.json()`); verify `X-Razorpay-Signature` via `crypto.timingSafeEqual` (SEC fix); invalid signature returns 400; payload validated against `RazorpayWebhookPayloadSchema` (Zod); duplicate `razorpay_event_id` returns 200 no-op; routes events to handlers.
Priority: Critical
Source: SPEC.md §10.4

**FR-055: Grace Period Handling**
The system must implement a 7-day grace period on payment failure before suspension.
Acceptance criteria: `payment.failed` event causes payment worker to execute `UPDATE organizations SET grace_period_ends_at = NOW() + INTERVAL '7 days' WHERE id = $orgId AND status = 'active'` (audit issue 3.2 fix — this write is mandatory; without it the grace period job never fires); delayed BullMQ job fires at `grace_period_ends_at`; job checks `org.status === 'active'` — if not active, logs WARN and exits (BUG-NEW-003 fix); if active and no recovery, calls `suspendOrg`; `payment.captured` on suspended org calls `reactivateOrg` and clears `grace_period_ends_at`.
Priority: High
Source: SPEC.md §10.4

**FR-056: Subscription Lifecycle**
The system must manage Razorpay subscription state via webhook events.
Acceptance criteria: Subscription events update `subscriptions` table; plan tier changes reflected in `organizations.plan_tier`; cancelled subscriptions degrade to free tier at period end.
Priority: High

**FR-057: Payment Record Retention**
Payment records must be retained for a minimum of 7 years.
Acceptance criteria: GDPR erasure jobs explicitly skip `payments` and `subscriptions` tables; offboarding worker retains payment rows; integration test asserts payment rows survive org deletion.
Priority: Critical
Source: SPEC.md §1.16

**FR-058: Payment Idempotency**
Razorpay webhook events must be processed exactly once.
Acceptance criteria: `razorpay_event_id` stored in payment `metadata`; duplicate event ID → no-op; return 200.
Priority: Critical

---

### Search (FR-059 – FR-062)

**FR-059: Cross-Entity Search**
The system must support full-text search across tasks, messages, files, and users within an org.
Acceptance criteria: GET /api/v1/org/:org_id/search?q={query}&type={type} returns paginated results; results NEVER include data from other orgs; `org_id` filter always applied; minimum query length 1 character.
Priority: High

**FR-060: Search Provider Abstraction**
The system must support switching between PostgreSQL FTS and Typesense.
Acceptance criteria: `ISearchProvider` interface with `upsertDocument`, `deleteDocument`, `search`, `reindexAll`; `SEARCH_PROVIDER` env var selects implementation; switching requires no code changes.
Priority: High

**FR-061: Search Graceful Degradation**
The system must fall back to PostgreSQL FTS when Typesense is unavailable.
Acceptance criteria: When Typesense circuit breaker is open, search falls back to PostgreSQL FTS; response includes `"meta.search_degraded": true`; no data loss.
Priority: High

**FR-062: Search Index Synchronization**
The system must keep the search index in sync with DB changes via BullMQ.
Acceptance criteria: Events `task.created`, `task.updated`, `task.deleted`, `message.created`, `message.deleted`, `file.confirmed`, `file.deleted` trigger `index-entity` jobs; jobs are idempotent (Redis dedup key, 5-min TTL); `search_index_lag_seconds` metric tracks lag using explicit IN list (not LIKE patterns — BUG-NEW-007 fix).
Priority: High

---

### Real-Time (FR-063 – FR-068)

**FR-063: Socket.IO Authentication**
WebSocket connections must be authenticated via JWT.
Acceptance criteria: JWT passed via `auth.token` in socket handshake; invalid/expired JWT → `auth:error` event then disconnect; valid JWT → join org room and all channel rooms.
Priority: Critical

**FR-064: Task Real-Time Updates**
Task mutations must be broadcast to all collaborators in real time.
Acceptance criteria: Task update by user A received by user B's socket in `org:{org_id}:task:{task_id}` room within 1 second; task:subscribe and task:unsubscribe events manage room membership.
Priority: High

**FR-065: Chat Real-Time Delivery**
Chat messages sent via WebSocket must be delivered to all channel members.
Acceptance criteria: `message:send` event creates message in DB, emits `message:new` to channel room; ACK-retry wrapper re-emits up to 3 times if no ACK (5s timeout per attempt).
Priority: Critical

**FR-066: Presence System**
The system must track and broadcast user presence in real time.
Acceptance criteria: Connect → `setOnline` + emit `presence:update` to org room; `presence:heartbeat` refreshes 90s Redis TTL; disconnect → `setOffline` + emit `presence:update`; presence key expires after 90s without heartbeat.
Priority: Medium

**FR-067: Typing Indicators**
The system must support per-channel typing indicators.
Acceptance criteria: `typing:start` sets `typing:{channelId}:{userId}` Redis key (5s TTL), emits to channel room; `typing:stop` deletes key; key auto-expires if client disconnects.
Priority: Low

**FR-068: Video Call Signaling**
The system must relay WebRTC signaling messages for video calls.
Acceptance criteria: `call:join`, `call:leave`, `call:offer`, `call:answer`, `call:ice-candidate` events relayed to call room members; call state tracked in Redis `call:state:{callId}` hash with 4h TTL; `video_calls` table records call lifecycle.
Priority: Medium
Source: SPEC.md §1.31 VideoCall domain model (C-07 fix)

---

### Webhooks (FR-069 – FR-073)

**FR-069: Webhook Subscription Management**
Tenants must be able to register HTTPS webhook endpoints.
Acceptance criteria: POST creates subscription with URL validation (HTTPS only), event_type filtering, HMAC secret; secret stored with encryption key version prefix `v{N}:{base64_iv}:{base64_ciphertext}`; secret_key_version column tracks which key was used; returns secret in plaintext only once (on creation); subsequent reads return `secret_preview` only.
Priority: High

**FR-070: Webhook Delivery with SSRF Protection**
Webhooks must be delivered with SSRF protection.
Acceptance criteria: Before each HTTP delivery, resolve hostname via `dns.promises.lookup()`; check resolved IP against private ranges (RFC 1918: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16; loopback: 127.0.0.0/8; link-local: 169.254.0.0/16; IPv6: ::1); if private → mark delivery `failed` with error `SSRF_BLOCKED`, log WARN, do not attempt HTTP; connect to resolved IP directly with `Host` header = original hostname (prevents DNS rebinding); signed with HMAC-SHA256.
Priority: High
Source: SEC-NEW-003 fix

**FR-071: Webhook Retry and DLQ**
Failed webhook deliveries must be retried with exponential backoff.
Acceptance criteria: Retry schedule: 10s, 30s, 90s; after 3 failures: mark `exhausted`, move to DLQ; manual retry available via admin API.
Priority: High

**FR-072: Webhook Encryption Key Rotation**
Webhook secrets must remain functional after encryption key rotation.
Acceptance criteria: `secret_encrypted` format: `v{N}:{base64_iv}:{base64_ciphertext}`; `secret_key_version` tracks key version; rotation job re-encrypts all rows with new key and increments `secret_key_version`.
Priority: Medium
Source: SEC-NEW-004 fix

**FR-073: Webhook Delivery Log**
All delivery attempts must be logged.
Acceptance criteria: Every attempt creates a `webhook_delivery_log` row; `UNIQUE (webhook_id, event_id)` prevents duplicate log entries per event; accessible via GET /api/v1/org/:org_id/webhooks/:id/deliveries.
Priority: Medium

---

### GDPR (FR-074 – FR-078)

**FR-074: User Data Export**
Users must be able to export all their personal data.
Acceptance criteria: GET /api/v1/me/data-export enqueues export job; job produces ZIP file using streaming approach (cursor-based, `@aws-sdk/lib-storage` — separate package from `@aws-sdk/client-s3`) to avoid OOM on large datasets; other users' PII (commenter names in comments, assignee names in tasks assigned by others) is redacted in the export (C-08 fix); signed download URL (24h TTL) emailed to user; payment records excluded from user export.
Priority: High

**FR-075: Org Data Export**
Org admins must be able to export all org data.
Acceptance criteria: POST /api/v1/org/:org_id/export (org_admin role) enqueues org export job; streaming ZIP to S3; includes all entity types; payment records included.
Priority: High

**FR-076: GDPR User Erasure with Re-auth Gate**
Users must be able to request erasure of their personal data.
Acceptance criteria: DELETE /api/v1/me checks `jwt.auth_time` — if `NOW() - auth_time > 300 seconds` → 403 REAUTHENTICATION_REQUIRED; token without `auth_time` claim → 403 MISSING_AUTH_TIME; enqueues `erase-user` job; job anonymizes: `email → deleted_{userId}@anonymised.invalid`, `name → Deleted User`, `phone → NULL`, `avatar_url → NULL`, `password_hash → NULL`, `totp_secret → NULL`; sets `status = 'deleted'`, `deleted_at = NOW()`; calls `revokeAllUserTokens`; retains payment rows; anonymizes `audit_logs.actor_id → NULL` (rows retained); removes `auth_providers` rows; writes `user.erased` audit event.
Priority: Critical

**FR-077: Org Offboarding Pipeline**
The system must support complete tenant offboarding.
Acceptance criteria: `org.offboarding_started` event triggers 30-day delayed job; job verifies `org.status === 'offboarding'` (if `deleted`, skip); anonymizes all member PII; soft-deletes all org data; retains payments; sets `status = 'deleted'`, `deleted_at`; writes `org.deleted` audit entry.
Priority: Critical

**FR-078: Consent Management**
The system must record user consent versions.
Acceptance criteria: PATCH /api/v1/me/consent updates `consent_tos_version`, `consent_tos_at`, `privacy_policy_version`; included in GDPR export.
Priority: Medium

---

### Platform Admin (FR-079 – FR-083)

**FR-079: Platform Admin Authentication**
Platform admin endpoints must require MFA and IP allowlist.
Acceptance criteria: All `/admin/*` endpoints apply `platformAdminMiddleware`; checks: (1) valid JWT with `is_platform_admin = true`, (2) `mfa_verified_at` within last 3600 seconds — hard 1-hour expiry from `mfa_verified_at`, NOT an inactivity timeout; activity DOES NOT extend the window (SEC-NEW-002 fix), (3) `req.ip` in `PLATFORM_ADMIN_IP_ALLOWLIST` — requires `app.set('trust proxy', config.platformAdminTrustedProxy || 'loopback')` called BEFORE any middleware in `src/app.ts` (COMPLETENESS-004 fix); fails any check → 403 with specific error code.
Priority: Critical
Source: ARCHITECTURE.md §16.5

**FR-080: Platform Admin Cross-Tenant Operations**
Platform admins must be able to manage any organization.
Acceptance criteria: suspend, reactivate, offboard any org; unlock any user account; trigger payment recovery; all operations write synchronously to `audit_logs` BEFORE returning HTTP response.
Priority: High

**FR-081: Operational Tooling**
Platform admins must have tools to manage the system operationally.
Acceptance criteria: replay outbox event (by ID); requeue DLQ jobs (by queue + limit); trigger search reindex (by entity type + optional org_id); rotate JWT key pair with 15-minute overlap; reset user MFA (clears `totp_enabled`, `mfa_backup_codes`, `totp_secret`).
Priority: High

**FR-082: Cross-Tenant Audit Log Access**
Platform admins must be able to query audit logs across all tenants.
Acceptance criteria: GET /admin/audit-logs with optional filters (org_id, actor_id, event_type, date range); paginated; read-only; results include actor, entity, payload, IP.
Priority: High

**FR-083: Feature Flag Management**
Platform admins must be able to manage feature flags.
Acceptance criteria: CRUD on `/admin/feature-flags` (routes MUST apply `platformAdminMiddleware`); enabled/disabled per org override; global toggle; percentage rollout; on write: publish to `featureflag:invalidate` Redis channel. TASK execution order: TASK-086 (platform admin middleware) MUST be complete before TASK-085 (feature flag routes) can be implemented (CONSISTENCY-002 fix).
Priority: Medium
Source: CONSISTENCY-002 fix

---

### Observability (FR-084 – FR-088)

**FR-084: Health Check Endpoints**
The system must expose three health check endpoints.
Acceptance criteria: GET /live → 200 always (process alive); GET /ready → 503 with `{ "reason": "migrations_in_progress" }` until `appReady = true`; GET /health → checks DB, Redis, search; returns `{ "status": "ok" | "degraded", "checks": { "db": ..., "redis": ..., "search": ... } }`.
Priority: Critical

**FR-085: Prometheus Metrics**
The system must expose Prometheus-compatible metrics.
Acceptance criteria: GET /metrics requires `Authorization: Bearer {METRICS_TOKEN}`; returns 401 if missing/invalid; returns Prometheus text format if authorized; includes all metrics from ARCHITECTURE.md §15.2; queue metrics collected every 30s; missing `METRICS_TOKEN` env var causes startup crash (fail-fast).
Priority: High
Source: ARCHITECTURE.md §15.2

**FR-086: Structured Logging**
All application logs must be structured JSON.
Acceptance criteria: pino logger; mandatory fields: `timestamp`, `level`, `correlation_id`, `service`; request logs include `org_id`, `user_id` when authenticated; sensitive fields scrubbed: Authorization, password, password_hash, token, access_token, refresh_token, secret, totp_secret, backup_codes, mfa_backup_codes, api_key, webhook_secret, encryption_key, and JWT pattern strings.
Priority: High

**FR-087: Distributed Tracing**
The system must emit OpenTelemetry traces.
Acceptance criteria: `@opentelemetry/sdk-node` initialized as the ABSOLUTE FIRST import in `src/app.ts` and `src/worker.ts` before any other import (C-01 fix); packages pinned to exact versions `0.45.0` (no caret — pre-1.0 packages have breaking changes); auto-instrumentations for HTTP, Express, pg, ioredis; `OTEL_EXPORTER_OTLP_ENDPOINT` optional (no-op if not set).
Priority: Medium

**FR-088: JWKS Endpoint**
The system must expose JWT public keys for external verification.
Acceptance criteria: GET /.well-known/jwks.json returns current public key set in JWK format; includes `kid` for key identification.
Priority: High

---

## Non-Functional Requirements

### Performance

**NFR-001: API p95 Latency**
API p95 latency must be below 200ms under load.
Acceptance criteria: k6 load test at 100 concurrent users, 5 minutes; p95 < 200ms.
Priority: Critical

**NFR-002: Error Rate**
API error rate must be below 1% under load.
Acceptance criteria: k6 load test at 100 concurrent users, 5 minutes; error rate < 1%.
Priority: Critical

**NFR-003: Concurrent Users**
The system must support 100+ concurrent users with the architecture designed for 1000+.
Acceptance criteria: Load test at 100 VUs for 5 minutes without degradation.
Priority: Critical

### Reliability

**NFR-004: Zero-Downtime Deployments**
Deployments must not cause service interruptions.
Acceptance criteria: Rolling restart; old instances drain in-flight requests before shutdown; `/ready` returns 503 during migration.
Priority: Critical

**NFR-005: Graceful Shutdown**
The system must drain all in-flight work before exiting (C-05 fix).
Acceptance criteria: SIGTERM triggers ordered shutdown: stop HTTP server → stop Socket.IO → drain in-flight HTTP (30s max) → close BullMQ workers (waits for in-progress jobs) → stop outbox poller → close DB pools (primary + replica) → close Redis (all 4 clients: `redisClient`, `redisPubSubClient`, `redisAdapterPubClient`, `redisAdapterSubClient`); `process.exit(0)` only after all connections closed.
Priority: Critical

**NFR-006: RTO/RPO**
RTO < 30 minutes. RPO < 5 minutes.
Acceptance criteria: PostgreSQL WAL archiving every 5 minutes; documented recovery procedure.
Priority: High

**NFR-007: Graceful Degradation**
The system must remain partially operational when dependencies fail.
Acceptance criteria: Redis down: task writes succeed, rate limiting falls back to in-process (per-process limit — documented), token blacklist fails-open (logged), Socket.IO single-node; search down: falls back to PG FTS with `search_degraded: true`; DB replica down: primary serves all traffic; Redis restart: outstanding auth tokens (magic link, password reset, email verify) invalidated — users request new tokens.
Priority: High

### Security

**NFR-008: Password Hashing**
Passwords must be hashed with bcrypt at cost 12.
Acceptance criteria: `hashPassword` uses bcrypt cost 12; `verifyPassword` uses bcrypt compare.
Priority: Critical

**NFR-009: JWT Algorithm**
JWTs must use RS256 algorithm.
Acceptance criteria: All issued JWTs use RS256; symmetric algorithms (HS256) forbidden.
Priority: Critical

**NFR-010: Refresh Token Entropy**
Refresh tokens must have sufficient entropy.
Acceptance criteria: 32 cryptographically random bytes (64 hex chars) via `crypto.randomBytes(32).toString('hex')`.
Priority: Critical

**NFR-011: Timing-Safe Comparisons**
Token comparison must be timing-safe.
Acceptance criteria: All token comparisons use `crypto.timingSafeEqual`; including magic link tokens, password reset tokens, Razorpay HMAC signatures, and webhook HMAC signatures.
Priority: Critical

**NFR-012: No Secrets in Git**
No secrets may be committed to the repository.
Acceptance criteria: `.env` in `.gitignore`; `.env.example` with all keys documented (no values); `git-secrets` or `trufflehog` in CI.
Priority: Critical

**NFR-013: SQL Injection Prevention**
All database queries must use parameterized queries.
Acceptance criteria: Zero string interpolation in SQL; exclusively `$1, $2, ...` placeholders.
Priority: Critical

**NFR-014: Input Validation**
All HTTP request bodies must be validated with Zod schemas.
Acceptance criteria: Controllers validate before service calls; array fields have `maxItems`; body size limit 1MB default, 10MB for file endpoints.
Priority: High

**NFR-015: Sensitive Fields Never in API Response**
Sensitive user fields must never appear in API responses.
Acceptance criteria: `totp_secret`, `password_hash`, `mfa_backup_codes`, `mfa_backup_codes_generated_at` excluded from all HTTP response serialization via explicit `sanitizeUser()` allowlist function; integration test asserts these fields absent from `GET /api/v1/me`.
Priority: Critical
Source: SEC-NEW-006 fix

**NFR-016: Structured Log PII Scrubbing**
PII must not appear in logs.
Acceptance criteria: Middleware strips Authorization, password, token, secret, api_key from logged request bodies; JWT pattern strings redacted.
Priority: High

**NFR-017: CORS Production Guard**
CORS must not use wildcard in production.
Acceptance criteria: If `NODE_ENV = production` AND `CORS_ORIGINS = '*'`: startup exits with clear error message (C-02 fix); `CORS_ORIGINS` must be explicit comma-separated origin list in production.
Priority: High

### Scalability

**NFR-018: Database Connection Pooling**
DB connections must be pooled and bounded.
Acceptance criteria: Primary pool max 15, replica pool max 10; idle timeout 30s; connection timeout 5s; statement timeout 10s.
Priority: High

**NFR-019: Partition Management**
Partitioned tables must have pre-created partitions.
Acceptance criteria: `chat_messages_YYYY_MM` and `audit_logs_YYYY_MM` partitions created for current month + next 3 months at deployment; daily BullMQ repeat job creates partitions with `CREATE TABLE IF NOT EXISTS` (idempotent — runs daily, not monthly, for fault tolerance); `_default` catch-all partition always exists for both tables.
Priority: Critical
Source: SCALE-NEW-001/002 fix

**NFR-020: Adaptive Outbox Polling**
Outbox poller must scale polling speed with load.
Acceptance criteria: Batch of `OUTBOX_POLL_BATCH_SIZE` events processed → wait minimum 10ms → immediately poll again (C-06 fix); partial batch → wait 5s; batch size configurable via `OUTBOX_POLL_BATCH_SIZE` env var (default 100).
Priority: High
Source: SCALE-NEW-003 fix

**NFR-021: Feature Flag Bounds**
Feature flag UUID arrays must be bounded.
Acceptance criteria: `enabled_org_ids` and `disabled_org_ids` arrays have CHECK constraint `array_length(..., 1) < 10000`; exceeding limit returns 400.
Priority: Low
Source: SCALE-NEW-004 fix

### Compliance

**NFR-022: GDPR Erasure Timeline**
PII anonymization must complete within 30 days of erasure request.
Acceptance criteria: BullMQ erasure job enqueued immediately on request; completes anonymization; monitoring alerts if deadline at risk.
Priority: Critical

**NFR-023: Audit Log Immutability**
Audit log records must be immutable at the database level.
Acceptance criteria: PostgreSQL RLS enabled on `audit_logs`; `INSERT` policy for `app_db_user` only; `REVOKE UPDATE ON audit_logs FROM app_db_user`; `REVOKE DELETE ON audit_logs FROM app_db_user`; CI grep test verifies no `UPDATE.*audit_logs` or `DELETE.*audit_logs` SQL in `src/`; `AuditRepository.append()` is the only write method.
Priority: Critical
Source: COMPLETENESS-005 fix

**NFR-024: Audit Log Cleanup via Partition Drop**
Audit log retention cleanup must use partition dropping, not DELETE.
Acceptance criteria: Cleanup worker identifies expired monthly partitions; drops with `DROP TABLE IF EXISTS audit_logs_YYYY_MM`; NEVER uses `DELETE FROM audit_logs`.
Priority: High
Source: CROSS-001 fix

**NFR-025: Payment Record Retention**
Payment records must be retained for a minimum of 7 years.
Acceptance criteria: GDPR erasure jobs explicitly skip `payments` and `subscriptions`; offboarding worker retains payment rows; test asserts payment rows survive org deletion.
Priority: Critical

**NFR-026: UTC Timestamp Storage**
All timestamps must be stored in UTC.
Acceptance criteria: All `TIMESTAMPTZ` columns use `NOW()` defaults; application uses `new Date().toISOString()`; all API responses return ISO-8601 UTC timestamps.
Priority: High

**NFR-027: Outbox Delivery Ordering**
Outbox events must be delivered at-least-once.
Acceptance criteria: Outbox poller PUBLISHES to Redis before marking events as `published` in DB (audit issue 3.1 fix); if PUBLISH fails, event stays `pending` and retries; if app crashes after PUBLISH but before DB UPDATE, event is re-delivered (at-least-once); consumers deduplicate via `correlation_id`.
Priority: Critical

---

## Environment Variable Requirements

All required environment variables. Missing mandatory variables cause `process.exit(1)` at startup.

| Variable | Type | Validation | Description |
|---|---|---|---|
| `DATABASE_URL` | string | Non-empty | PostgreSQL primary connection string |
| `DATABASE_REPLICA_URL` | string | Optional | Falls back to primary if absent |
| `REDIS_URL` | string | Required if no Sentinel | Redis standalone connection string |
| `REDIS_SENTINEL_HOSTS` | string | Optional | Comma-separated `host:port` pairs; triggers Sentinel mode when set |
| `REDIS_PASSWORD` | string | Optional | Redis auth password |
| `JWT_PRIVATE_KEY` | string | Non-empty PEM | RS256 private key for signing |
| `JWT_PUBLIC_KEY` | string | Non-empty PEM | RS256 public key for verification |
| `ENCRYPTION_KEY` | string | Exactly 64 hex chars `[0-9a-f]{64}` | AES-256-GCM key (32 bytes) |
| `INVITE_SECRET` | string | Min 32 chars | HMAC key for invitation tokens |
| `METRICS_TOKEN` | string | Min 16 chars | Bearer token for `/metrics` |
| `PORT` | number | Default 3000 | HTTP server port |
| `NODE_ENV` | string | `development`/`production`/`test` | Runtime environment |
| `LOG_LEVEL` | string | Default `info` | Pino log level |
| `CORS_ORIGINS` | string | Must not be `*` in production | Comma-separated allowed origins |
| `STORAGE_PROVIDER` | string | `local` or `s3` | File storage backend |
| `AWS_REGION` | string | Required if S3 | AWS region |
| `AWS_S3_BUCKET` | string | Required if S3 | S3 bucket name |
| `RAZORPAY_KEY_ID` | string | Non-empty | Razorpay key ID |
| `RAZORPAY_KEY_SECRET` | string | Non-empty | Razorpay key secret |
| `RAZORPAY_WEBHOOK_SECRET` | string | Non-empty | Razorpay webhook HMAC secret |
| `EMAIL_PROVIDER` | string | `ses` or `sendgrid` | Primary email provider |
| `AWS_SES_REGION` | string | Required if SES | SES region |
| `SENDGRID_API_KEY` | string | Required if SendGrid | SendGrid API key |
| `SEARCH_PROVIDER` | string | `postgres` or `typesense` | Search backend |
| `TYPESENSE_URL` | string | Required if Typesense | Typesense server URL |
| `TYPESENSE_API_KEY` | string | Required if Typesense | Typesense API key |
| `PLATFORM_ADMIN_IP_ALLOWLIST` | string | Optional | Comma-separated CIDRs |
| `PLATFORM_ADMIN_TRUSTED_PROXY` | string | Default `loopback` | Express trust proxy value |
| `CLAMAV_HOST` | string | Default `clamav` | ClamAV daemon hostname |
| `CLAMAV_PORT` | number | Default `3310` | ClamAV daemon TCP port |
| `VIRUS_SCAN_ENABLED` | boolean | Default `false` | Enable ClamAV scanning |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | string | Optional | OTel OTLP endpoint (no-op if absent) |
| `OUTBOX_POLL_BATCH_SIZE` | number | Default `100` | Outbox poller batch size |
| `TEST_DATABASE_URL` | string | Optional (required in test env) | Separate PostgreSQL DB for integration tests |
| `LOADTEST_ORG_ID` | string | Optional | Set by `scripts/seed-loadtest.ts` |
| `LOADTEST_USER_PREFIX` | string | Default `loadtest_user_` | Set by seed script |

---

## Conflicts, Gaps, and Assumptions — Resolved Issues

All issues from the original audit and the second-pass audit have been resolved in this document and the corresponding implementation documents (SPEC.md, ARCHITECTURE.md, PLAN.md, TASK.md).

**CONFLICT-001 (Resolved):** Search index updates via outbox event system, not direct service calls.
**CONFLICT-002 (Resolved):** Email failover: SES → SendGrid → DLQ.
**GAP-001 (Resolved):** Direct channel dedup via `direct_channel_pairs` table.
**GAP-002 (Resolved):** Recurring task dedup via partial UNIQUE index in migration 005.
**GAP-003 (Resolved):** SAML replay via presence-only check + 24-hour cleanup buffer.
**GAP-004 (Resolved):** Chat spam throttling at 60 messages/10s per user.
**GAP-005 (Resolved):** Quota check uses atomic conditional UPDATE.
**GAP-006 (Resolved):** Typesense `0.25.2` selected and pinned.
**GAP-007 (Resolved):** `PLATFORM_ADMIN_IP_ALLOWLIST` env var with CIDRs.
**GAP-008 (Resolved):** Idempotency-Key required on POST, PUT, PATCH only.
**GAP-009 (Resolved):** Outbox cleanup purges published > 7 days, failed > 30 days.
**GAP-010 (Resolved):** `user.registered` triggers verification email.
**GAP-011 (Resolved):** `PLATFORM_ADMIN_TRUSTED_PROXY` + `app.set('trust proxy', ...)`.
**GAP-012 (Resolved):** All token comparisons use `crypto.timingSafeEqual`.
**GAP-013 (Resolved):** `src/modules/video/` added to source tree.
**AUDIT-2.4 (Resolved):** Redis Sentinel mode supported via `REDIS_SENTINEL_HOSTS` env var.
**AUDIT-2.5 (Resolved):** `app_db_user` table-level GRANT strategy defined in migration 014.
**AUDIT-2.6/2.7/2.8 (Resolved):** Magic link, password reset, email verification tokens stored in Redis with TTL.
**AUDIT-2.9 (Resolved):** Complete `NOTIFICATION_EVENT_TYPES` enum defined in SPEC.md §7.
**AUDIT-3.1 (Resolved):** Outbox poller PUBLISHES first, then marks published — at-least-once semantics.
**AUDIT-3.2 (Resolved):** Payment worker explicitly sets `grace_period_ends_at` on `payment.failed`.
**AUDIT-3.3 (Resolved):** Token family revocation also blacklists in-flight access tokens via `last_access_token_jti`.
**AUDIT-3.5 (Resolved):** SAML cleanup buffer of 24 hours prevents replay window.
**AUDIT-4.1 (Resolved):** `nodeclam` replaced with `clamscan` (actively maintained).
**AUDIT-4.2 (Resolved):** MJML/Handlebars pipeline order: Handlebars first, MJML second.
**AUDIT-4.3 (Resolved):** OpenTelemetry packages pinned to exact versions `0.45.0`.
**AUDIT-4.4 (Resolved):** Razorpay TypeScript types declared in `src/types/razorpay.d.ts`.
**AUDIT-4.5 (Resolved):** `app` and `worker` service definitions in `docker-compose.yml`.
**AUDIT-5.1 (Resolved):** JWT private key storage warning documented in RUNBOOK.md.
**AUDIT-5.2 (Resolved):** PostgreSQL replica uses dedicated replication user, not superuser password.
**AUDIT-5.5 (Resolved):** MFA reset procedure defined, documented in RUNBOOK.md.
**AUDIT-5.6 (Resolved):** WebSocket sessions re-validated every 5 minutes; terminated on invalidation.
**AUDIT-6.1 (Resolved):** Per-channel sequence scale note and migration path documented.
**AUDIT-6.2 (Resolved):** Partition jobs run daily (not monthly) for fault tolerance.
**AUDIT-7.2 (Resolved):** `replica-entrypoint.sh` fixed — no `initdb.d` confusion, calls `exec postgres` directly.
**AUDIT-7.3 (Resolved):** Complete `package.json` scripts section defined in ARCHITECTURE.md §17.5.
**AUDIT-7.4 (Resolved):** `TEST_DATABASE_URL` is optional in Zod config; required assertion in test setup.
**AUDIT-C-01 (Resolved):** OTel SDK is the absolute first import in `app.ts` and `worker.ts`.
**AUDIT-C-02 (Resolved):** CORS wildcard rejected in production with startup crash.
**AUDIT-C-03 (Resolved):** Helmet configured with CSP, HSTS, frameguard in ARCHITECTURE.md §16.4.
**AUDIT-C-04 (Resolved):** Razorpay webhook payload validated against Zod schema.
**AUDIT-C-05 (Resolved):** Complete SIGTERM handler with correct shutdown sequence defined.
**AUDIT-C-06 (Resolved):** Outbox poller has minimum 10ms inter-batch delay even for full batches.
**AUDIT-C-07 (Resolved):** `VideoCall` domain model defined in SPEC.md §1.31 and ARCHITECTURE.md §2.16.
**AUDIT-C-08 (Resolved):** GDPR export redacts other users' PII; signed download URL emailed.
