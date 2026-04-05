# Operations Runbook

## §5.1 — JWT Private Key Security

**WARNING: Never log `JWT_PRIVATE_KEY` or `JWT_PRIVATE_KEY_BASE64`.**

In production, prefer Docker secrets or Kubernetes secrets over environment variables:
```yaml
# Kubernetes
kubectl create secret generic jwt-keys \
  --from-file=private.key=./private.key \
  --from-file=public.key=./public.key
```

Environment variable approach is acceptable for development and CI only.

---

## §5.2 — PostgreSQL Replica Password Security

In production, create a dedicated PostgreSQL replication user with a separate password. Do not use the application superuser password in `primary_conninfo`.

```sql
CREATE USER replicator WITH REPLICATION LOGIN ENCRYPTED PASSWORD 'secure_replica_password';
```

In `primary_conninfo` on the replica, use `replicator` credentials — not `app_user`.

---

## §5.5 — MFA Reset Procedure

To reset MFA for a user:
```
POST /api/v1/admin/users/{userId}/reset-mfa
Authorization: Bearer <platform-admin-jwt>
```

Requires platform admin JWT with recent `mfaVerifiedAt` (within 1 hour).

This clears `totp_enabled = false`, `mfa_backup_codes = NULL`, `totp_secret = NULL`.

An audit event `admin.user.mfa_reset` is written before the reset is performed.

Org admin approval is tracked via the audit trail. MFA reset should be approved by the user's org admin before being performed by a platform admin.

---

## §6.1 — Per-Channel Sequence Scalability

The per-channel PostgreSQL sequence approach (`channel_seq_{channelId}`) does not scale beyond ~100K channels.

**At >100K channels:** Migrate sequence allocation to Redis INCR with DB high-water mark sync:
1. `INCR channel:seq:{channelId}` in Redis
2. Periodically sync Redis counter to `channels.sequence_high_water` in DB
3. On Redis restart: seed from `sequence_high_water + safety_buffer`

Document this migration path before the 100K threshold is reached.

---

## §2 — Operational Tools

### 1. Suspend Organization
```
POST /api/v1/admin/organizations/{orgId}/suspend
```
Sets `organizations.status = 'suspended'`. Members cannot log in to the org context.

### 2. Reactivate Organization
```
POST /api/v1/admin/organizations/{orgId}/reactivate
```
Sets `organizations.status = 'active'`.

### 3. Initiate Org Offboarding
```
POST /api/v1/admin/orgs/{orgId}/offboard
```
Sets status to `offboarding`, enqueues offboarding job. All member data is erased, org data soft-deleted. Payments retained for 7 years.

### 4. Unlock User Account
```
POST /api/v1/admin/users/{userId}/unlock
```
Clears `locked_until`, `failed_login_attempts`.

### 5. Reset User MFA
```
POST /api/v1/admin/users/{userId}/reset-mfa
```
See §5.5 above.

### 6. Trigger Payment Recovery
```
POST /api/v1/admin/payments/recovery
```
Retries all payments with `status = 'failed'` that are within the grace period.

### 7. Replay Outbox Event
```
POST /api/v1/admin/outbox/replay
Body: { "eventId": "uuid" }
```
Resets `outbox_events.status = 'pending'` for the specified event. The outbox poller re-publishes it on the next poll cycle.

### 8. Requeue DLQ Jobs
```
POST /api/v1/admin/dlq/requeue
Body: { "queue": "search", "limit": 100 }
```
Moves failed jobs from DLQ back to the active queue.

### 9. Trigger Search Reindex
```
POST /api/v1/admin/search/reindex
Body: { "orgId": "uuid" } // optional — all orgs if omitted
```
Enqueues full reindex jobs for all entities in the specified org.

### 10. Rotate JWT Keys
```
POST /api/v1/admin/jwt/rotate-keys
```
Updates JWT private/public key pair. In-flight tokens remain valid until expiry (RS256 with previous public key is still verified during grace period if configured).

---

## Redis Restart Token Behavior

Redis restart invalidates all outstanding:
- Magic link tokens
- Password reset tokens
- Email verification tokens
- MFA challenge tokens

**Users must request new tokens.** Redis `appendonly yes` reduces this risk by persisting data across restarts.

For production, enable AOF persistence: `appendonly yes` in `redis.conf`.

---

## Audit Log Retention

Audit logs are stored in monthly partitions (`audit_logs_YYYY_MM`). The cleanup worker drops partitions older than `MIN(org.retention_audit_days)` across all active orgs.

**Never run `DELETE FROM audit_logs`** — this scans the default partition and is O(n). Always use `DROP TABLE audit_logs_{partition}`.

---

## MIGRATIONS.md Reference

See [MIGRATIONS.md](MIGRATIONS.md) for the expand-contract migration procedure.

---

## Monitoring

- `/metrics` — Prometheus metrics (requires `METRICS_TOKEN` bearer auth)
- `/health` — DB and Redis status
- `/live` — Liveness probe (always 200)
- `/ready` — Readiness probe (503 during migrations)

Key metrics to watch:
- `bullmq_queue_depth{queue="*"}` — job backlog
- `bullmq_dlq_depth{queue="*"}` — failed jobs
- `outbox_pending_events` — unprocessed outbox backlog
- `search_index_lag_seconds` — search indexing delay
- `db_pool_connections_active{pool="primary"}` — DB connection pressure
- `http_request_duration_ms{p95}` — API latency
