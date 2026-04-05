# Multi-Tenant Collaborative Work Platform

[![CI](https://github.com/Gokulaprasanth-Dev/multi-tenant-collaborative-work-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/Gokulaprasanth-Dev/multi-tenant-collaborative-work-platform/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](https://www.typescriptlang.org)

A production-ready multi-tenant SaaS platform built with Node.js, TypeScript, PostgreSQL, and Redis. Ships with real-time collaboration, task management, chat, file storage, full-text search, webhooks, payments, and GDPR compliance — all in a single deployable service.

## Features

- **Multi-tenancy** — Organization and workspace isolation with role-based access control
- **Task management** — Assignees, comments, recurring tasks, dependencies, activity logs, and templates
- **Real-time chat** — Socket.IO with presence tracking, typing indicators, and reconnect handling
- **File storage** — Upload to S3/MinIO with virus scanning (ClamAV) and presigned URLs
- **Full-text search** — Typesense integration with background reindex worker
- **Notifications** — In-app, email (SendGrid/SES/SMTP), and digest scheduling
- **Webhooks** — Outbound webhook subscriptions with SSRF prevention and retry logic
- **Payments** — Razorpay integration with webhook event processing
- **Auth** — JWT (RS256), Google OAuth, SAML SSO, and TOTP two-factor authentication
- **GDPR** — User and org data export, account offboarding workers
- **Audit logging** — Append-only audit trail with CI enforcement
- **Observability** — OpenTelemetry tracing and Prometheus metrics
- **Testing** — 82 test suites covering unit, integration, e2e, smoke, load, and realtime scenarios

## Prerequisites

- Node.js 20+
- PostgreSQL 16
- Redis 7
- Docker & Docker Compose (for local dev)
- Optional: Typesense 0.25, ClamAV, AWS S3, Razorpay

## Quick Start

```bash
# 1. Clone and install
git clone <repo>
cd multi-tenant_collaborative_work_platform
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — see Environment Reference below

# 3. Start infrastructure
docker-compose up postgres redis -d

# 4. Run migrations
npm run migrate:up

# 5. Start development server
npm run dev

# 6. Start worker process (separate terminal)
npm run dev:worker
```

## Run Migrations

```bash
# Run all pending migrations
npm run migrate:up

# Roll back last migration
npm run migrate:down

# Run against test database
TEST_DATABASE_URL=postgresql://... npm run migrate:test
```

## Run Tests

```bash
# Unit tests (no DB or Redis required)
npm run test:unit

# Integration tests (requires TEST_DATABASE_URL + Redis)
TEST_DATABASE_URL=postgresql://test_user:pass@localhost:5432/platform_test \
REDIS_URL=redis://localhost:6379 \
npm run test:integration

# Smoke tests (requires full environment)
npm run test:smoke

# Type check
npm run typecheck
```

## Environment Reference

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL primary connection string |
| `DATABASE_REPLICA_URL` | No | PostgreSQL replica (defaults to primary) |
| `REDIS_URL` | Yes | Redis connection string (standalone) |
| `REDIS_SENTINEL_HOSTS` | No | Comma-separated sentinel host:port list (production) |
| `REDIS_PASSWORD` | No | Redis authentication password |
| `JWT_PRIVATE_KEY_BASE64` | Yes | RS256 private key, base64-encoded |
| `JWT_PUBLIC_KEY_BASE64` | Yes | RS256 public key, base64-encoded |
| `JWT_ACCESS_EXPIRY` | No | Access token TTL (default: `15m`) |
| `JWT_REFRESH_EXPIRY` | No | Refresh token TTL (default: `7d`) |
| `RAZORPAY_KEY_ID` | No | Razorpay API key ID |
| `RAZORPAY_KEY_SECRET` | No | Razorpay API key secret |
| `RAZORPAY_WEBHOOK_SECRET` | No | Razorpay webhook signing secret |
| `AWS_REGION` | No | AWS region (default: `ap-south-1`) |
| `AWS_S3_BUCKET` | No | S3 bucket for file storage and GDPR exports |
| `TYPESENSE_URL` | No | Typesense server URL |
| `TYPESENSE_API_KEY` | No | Typesense API key |
| `CLAMAV_HOST` | No | ClamAV daemon host |
| `CLAMAV_PORT` | No | ClamAV daemon port (default: `3310`) |
| `VIRUS_SCAN_ENABLED` | No | Enable virus scanning (`true`/`false`) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | OpenTelemetry OTLP endpoint |
| `METRICS_TOKEN` | Yes | Bearer token for `/metrics` endpoint |
| `PLATFORM_ADMIN_IP_ALLOWLIST` | No | Comma-separated CIDR list for admin access |
| `ENCRYPTION_KEY` | Yes | 32-byte hex key for AES-256-GCM encryption |
| `CORS_ORIGINS` | Yes | Comma-separated allowed CORS origins |
| `LOG_LEVEL` | No | Pino log level (default: `info`) |
| `PORT` | No | HTTP server port (default: `3000`) |
| `TEST_DATABASE_URL` | Integration tests | Test database URL (separate from production) |

## Docker Compose

```bash
# Development (all services)
docker-compose up

# Test environment (ephemeral, no persistence)
docker-compose -f docker-compose.test.yml up

# Production (Redis Sentinel, multiple replicas)
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up
```

## Generate OpenAPI Documentation

```bash
npm run generate:openapi    # writes dist/openapi.json
npm run dev                 # then visit http://localhost:3000/api-docs
```

## Seed Load Test Data

```bash
npm run seed:loadtest       # creates 100 users + 1 org, writes .env.loadtest
```

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for system design, [SPEC.md](SPEC.md) for feature specification, and [docs/RUNBOOK.md](docs/RUNBOOK.md) for operational procedures.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, branch naming, and PR guidelines.

## Security

Found a vulnerability? See [SECURITY.md](SECURITY.md) — please do not open a public issue.

## License

[MIT](LICENSE)
