# Chaos Testing Scenarios

This document describes 6 manual chaos scenarios for the multi-tenant collaborative work platform.

---

## Scenario 1: Redis Total Unavailability

**Simulation steps:**
1. Stop the Redis container: `docker stop redis`
2. Send API requests (create task, list notifications, search)
3. Restore: `docker start redis`

**Expected behavior:**
- `POST /tasks`: succeeds with 201 — task persisted in PostgreSQL. Redis-dependent features (notifications, caching) are non-blocking and fail silently.
- `GET /notifications`: may return 503 with `CACHE_UNAVAILABLE` if Redis is used for the response, or fall through to DB query.
- `/health`: returns 503 `{"status":"degraded","checks":{"redis":"error","db":"ok"}}`.
- BullMQ workers (connected to Redis): stop processing new jobs. Existing in-flight jobs are held in the BullMQ queue and resume after Redis recovers.
- Rate limiting (Redis sliding window): if Redis is down, rate limiter fails open (allows all requests) — this is intentional to avoid blocking legitimate traffic during Redis outages.
- Socket.IO: connections drop. Clients reconnect via exponential backoff.

**Affected features:** Notifications, caching, rate limiting, BullMQ job processing, WebSocket presence.

**Recovery procedure:** `docker start redis` — workers reconnect automatically (ioredis retries). Outstanding jobs resume. Session and cache data is lost (users must re-authenticate if their tokens were cached).

**Note:** Redis restart invalidates all outstanding magic link, password reset, and email verification tokens. Users must request new tokens. Redis `appendonly yes` reduces data loss risk.

---

## Scenario 2: PostgreSQL Primary Failure

**Simulation steps:**
1. Stop the primary PostgreSQL container: `docker stop postgres-primary`
2. Send write requests (create org, update task)
3. Restore: `docker start postgres-primary`

**Expected behavior:**
- Write operations (`POST`, `PUT`, `DELETE`): return 503 after DB connection timeout (5s, configurable).
- Read operations routed to replica: remain functional if `DATABASE_REPLICA_URL` is configured.
- Outbox poller: stops publishing events. When primary recovers, events are re-published (at-least-once guarantee).
- BullMQ workers requiring DB: fail jobs with `ECONNREFUSED`. Jobs are retried with exponential backoff (up to 3 attempts, 30s delay).
- `/live`: returns 200 (liveness is not DB-dependent).
- `/ready`: continues returning 200 (already ready — readiness is migration-time only).
- `/health`: returns 503 `{"status":"degraded","checks":{"db":"error"}}`.

**Affected features:** All write operations, audit logging, outbox event publishing.

**Recovery procedure:** `docker start postgres-primary` — connection pool reconnects automatically. Outbox poller resumes from last published event. In-flight transactions that failed are retried at application level or replayed via admin API (`POST /admin/outbox/replay`).

---

## Scenario 3: Search Service (Typesense) Unavailability

**Simulation steps:**
1. Stop Typesense: `docker stop typesense`
2. Send search queries: `GET /orgs/:orgId/search?q=test`
3. Restore: `docker start typesense`

**Expected behavior:**
- Search queries: circuit breaker fires after 5 consecutive failures. All subsequent requests use PostgresFTS fallback.
- Response includes `meta.search_degraded: true`.
- Response HTTP status: 200 (not 503) — degraded mode is transparent to clients.
- New documents are still indexed in the `search` BullMQ queue — they are persisted and will be synced when Typesense recovers.
- `search_index_lag_seconds` Prometheus metric rises as the queue backs up.

**Affected features:** Full-text search quality (PostgresFTS is less capable than Typesense), real-time search indexing.

**Recovery procedure:** `docker start typesense` — circuit breaker transitions to `half-open` state after timeout. Next successful search resets the breaker. `POST /admin/search/reindex` triggers full re-index.

---

## Scenario 4: Worker Process Crash Mid-Job

**Simulation steps:**
1. Start a long-running job (e.g., org export for a large org)
2. Kill the worker process mid-execution: `kill -9 $(pgrep -f dist/worker.js)`
3. Restart worker: `pm2 restart worker` or `docker restart worker`

**Expected behavior:**
- BullMQ `stalling` mechanism: jobs that were active (dequeued but not acknowledged) are moved back to `waiting` state after the `stalledInterval` (30s by default).
- When worker restarts, stalled jobs are picked up and re-executed from the beginning.
- For idempotent jobs (search index, notifications): duplicate execution is harmless — idempotency keys prevent double-processing.
- For non-idempotent operations (e.g., writing an audit log): an idempotency key in `audit_logs` prevents duplicate entries.
- GDPR export jobs: re-run from scratch — the S3 object is overwritten. The new signed URL is issued. The user receives two emails if the job completes twice (acceptable).

**Affected features:** All BullMQ-processed operations: search indexing, notifications, GDPR exports, webhook delivery.

**Recovery procedure:** Restart worker process. BullMQ automatically picks up stalled jobs. Monitor `bullmq_dlq_depth` metric for jobs that exhaust retries.

---

## Scenario 5: Outbox Poller Crash Between PUBLISH and UPDATE

**Simulation steps:**
1. Instrument the outbox poller to crash immediately after `PUBLISH` but before `UPDATE outbox_events SET status='published'`
2. Restart the poller
3. Observe event processing

**Expected behavior:**
- The event is published to Redis pub/sub but `outbox_events.status` remains `'pending'`.
- On poller restart, the same event is published again (at-least-once delivery).
- Consumers must be idempotent:
  - Search indexing: idempotency key `search:indexed:{type}:{id}:{action}` with 5-min TTL prevents double-indexing.
  - Notification worker: idempotency key on `(userId, eventType, entityId)` prevents duplicate notifications.
  - Webhook delivery: `webhook_delivery_logs` table prevents duplicate HTTP calls for same `eventId` + `webhookId`.
- `outbox_events` rows older than 7 days with `status='published'` are cleaned up by the cleanup worker.
- Stale `'failed'` events older than 30 days are cleaned up.

**Affected features:** All event-driven features (search indexing, notifications, webhooks, presence).

**Recovery procedure:** Restart the outbox poller. All `'pending'` events are re-published. Downstream consumers deduplicate using their idempotency keys.

---

## Scenario 6: SAML IdP Unavailability

**Simulation steps:**
1. Configure the SAML IdP URL to an unreachable endpoint
2. Attempt SSO login: `GET /api/v1/auth/saml/:orgId/login`
3. Restore the IdP URL

**Expected behavior:**
- SAML SP-initiated login: redirect to IdP fails with network timeout or DNS error.
- The `passport-saml` strategy throws an error, caught by `express-async-errors`.
- The error handler returns 503 `{"code":"SSO_UNAVAILABLE","message":"SAML IdP is unreachable"}`.
- Users with local password credentials can still log in via `POST /api/v1/auth/login`.
- Users who are SSO-only (no `password_hash`) cannot log in. Support must either enable a temporary password or the IdP must be restored.
- SAML assertion replay protection (`saml_used_assertions` table) remains intact — no security regression.

**Affected features:** SSO login flow only. Local password login and magic link login are unaffected.

**Recovery procedure:** Restore the IdP URL in environment config or database. SAML login resumes immediately on next request — no restart required.

---

## Monitoring During Chaos

All scenarios should be monitored via:
- `GET /health` — DB and Redis status
- `GET /metrics` (Prometheus) — `bullmq_queue_depth`, `bullmq_dlq_depth`, `search_index_lag_seconds`, `outbox_pending_events`, `db_pool_connections_active`
- Pino structured logs (JSON) — search for `level: "error"` or `level: "warn"` entries
- Grafana dashboard: [grafana.internal/d/api-latency](grafana.internal/d/api-latency) — oncall latency board
