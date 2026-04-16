# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev              # HTTP server (ts-node --transpile-only)
npm run dev:worker       # Background worker process (separate terminal)

# Build & type checking
npm run build            # tsc — outputs to dist/
npm run typecheck        # tsc --noEmit
npm run lint             # eslint src --max-warnings 0

# Database migrations
npm run migrate:up       # Apply all pending migrations
npm run migrate:down     # Roll back last migration

# Tests
npm run test:unit                              # No DB/Redis required
npm run test:integration                       # Requires TEST_DATABASE_URL + REDIS_URL
npm run test:unit -- --testPathPattern="foo"   # Run a single unit test file
npm run test:integration -- --testPathPattern="foo"  # Run a single integration test file

# Utilities
npm run generate:openapi  # Regenerate dist/openapi.json (Swagger UI at /api-docs)
npm run seed:loadtest     # Seed 100 users + 1 org for load testing
```

Integration tests require environment variables:
```bash
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/platform_test \
REDIS_URL=redis://localhost:6379 \
npm run test:integration
```

## Architecture Overview

### Two processes, one codebase
- **`src/app.ts`** — HTTP server + Socket.IO. Mounts all routers, starts `OutboxPoller`, exports `io`.
- **`src/worker.ts`** — BullMQ worker process. Registers all queue workers. Must run separately from the HTTP server.

### Module layout (`src/modules/`)
Each module follows the pattern: `router.ts` → `controllers/` → `services/` → `repositories/` → `workers/`. Modules: `auth`, `chat`, `feature-flag`, `file`, `gdpr`, `notification`, `organization`, `payment`, `platform-admin`, `search`, `task`, `user`, `video`, `webhook`, `workspace`.

### Shared infrastructure (`src/shared/`)
| Path | Purpose |
|---|---|
| `config.ts` | Zod-validated config; crashes on startup if required env vars are missing |
| `database/pool.ts` | `queryPrimary()` / `queryReplica()` / `withTransaction()` — never use `primaryPool` / `replicaPool` directly in modules |
| `redis/clients.ts` | `redisClient` (general), `redisPubSubClient` (outbox subscribe), `redisAdapterPubClient/SubClient` (Socket.IO adapter) — each is a dedicated connection |
| `errors/app-errors.ts` | `AppError(statusCode, code, message)` and typed subclasses — throw these; the error handler middleware converts them to JSON |
| `response/response.middleware.ts` | Adds `res.success()`, `res.created()`, `res.accepted()` — all responses must use these, never `res.json()` directly |
| `queue/queues.ts` | BullMQ `Queue` instances — enqueue jobs from HTTP process; consume them in worker process |
| `events/outbox-poller.ts` | Transactional outbox — DB rows in `outbox_events` are polled and published to Redis pub/sub |
| `realtime/socket-server.ts` | Socket.IO setup: JWT auth middleware, per-user room `org:{orgId}:user:{userId}`, per-org room `org:{orgId}` |
| `auth-middleware/jwt.middleware.ts` | `jwtMiddleware` / `optionalJwtMiddleware` — sets `req.user.{userId, orgId, role}` |
| `idempotency/` | `idempotencyMiddleware` — all mutating endpoints require `Idempotency-Key` header |

### Request middleware stack (per org-scoped route)
`jwtMiddleware` → `orgContextMiddleware` (validates `X-Org-ID` header matches token) → `orgStatusMiddleware` (blocks suspended orgs) → `idempotencyMiddleware` → route handler

### Feature flags
Two-level cache: L1 in-process Map (5s TTL) + L2 Redis hash. Invalidated via Redis pub/sub channel `featureflag:invalidate`. Check with `isEnabled(key, orgId)` from `src/modules/feature-flag/feature-flag.service.ts`. Chat requires `feature.chat`; webhooks require `feature.webhooks`.

### Database conventions
- All SQL goes through `queryPrimary` / `queryReplica` — parameterized queries only, no string interpolation.
- Column names to know: `video_calls.state` (not `status`), `notifications.type` (not `event_type`), `recurrence_rule` (not `rrule`), `comments` table (not `task_comments`).
- `GENERATED ALWAYS AS STORED` columns (e.g. `search_vector`) cannot be SET manually.
- Migrations live in `migrations/` as plain JS files (`001_extensions.js` → `016_digest_sent_at.js`).

### Real-time (Socket.IO)
`src/shared/realtime/` contains: `socket-server.ts` (auth + room join), `presence.service.ts`, `chat-broadcaster.ts` (subscribes to Redis channel `chat:*`), `task-broadcaster.ts`, `video.service.ts` (WebRTC signaling), `reconnect.handler.ts`, `room-manager.ts`.

`startChatBroadcaster` and `registerReconnectHandlers` are **not** wired in `socket-server.ts` or `app.ts` — they must be started explicitly (relevant for integration tests).

### OpenAPI / Swagger
`scripts/generate-openapi.ts` generates `dist/openapi.json` (82 paths, 96 operations). Run `npm run generate:openapi` then restart the server for changes to appear at `/api-docs`. The script must be kept in sync with router changes manually.

## Testing Patterns

### Unit tests
- Mock `src/shared/database/pool`, `src/shared/redis/clients`, and `src/shared/config` at the top of the file using `jest.mock()` hoisted factories.
- Config mock must include `logLevel: 'silent', nodeEnv: 'test'` — pino requires `logLevel`.
- `jest.fn()` mocks declared at module scope work in factory closures; `const` values do not (they are not yet initialized when the factory runs).

### Integration tests
- Guard with `const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL)` and `describe.skip` when not set.
- `tests/setup.ts` (globalSetup) points `DATABASE_URL` at `TEST_DATABASE_URL` and runs migrations automatically.
- Comment body for task comments must be Quill delta JSON: `{ ops: [{ insert: "text" }] }`.
- Socket.IO test clients: set `reconnection: false`; add `await wait(300)` after `connect` before emitting events (the server awaits a DB query in `io.on('connection')` before registering event handlers).

### Response envelope
All API responses follow `{ data, error, meta: { correlation_id, request_id, timestamp } }`. In tests, access the payload as `res.body.data` and errors as `res.body.error.code`.
