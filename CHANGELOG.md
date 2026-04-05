# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- `scripts/generate-openapi.ts` completely rewritten: expanded from 12 hardcoded stub paths to 96 full endpoint operations (82 paths) covering all modules — Auth, User, Organization, Workspace, Task, Chat, Notification, File, Payment, Search, Webhook, Feature Flag, Platform Admin, GDPR, and Health. Swagger UI at `GET /api-docs` now reflects the complete API surface.

### Fixed
- `src/modules/chat/channel.service.ts`: `createDirect()` now returns `400 CANNOT_DM_SELF` when `creatorId === otherUserId` before any database work occurs. Previously this fell through to the `direct_channel_pairs CHECK (user_a_id < user_b_id)` constraint, producing an unhandled 500.
- `src/shared/realtime/video.service.ts`: Fixed `video_calls` INSERT/UPDATE using wrong column name `status` — the table schema defines `state`. Also added missing `initiator_id` to the INSERT (was `NOT NULL` in schema, causing all call-join operations to fail at the DB level).

## [1.0.0] - 2025-04-05

### Added
- Multi-tenant organization and workspace management
- Task management with assignees, comments, recurring tasks, dependencies, and activity logs
- Real-time chat with Socket.IO, presence tracking, and reconnect handling
- File upload with virus scanning (ClamAV), S3/MinIO storage, and presigned URLs
- Full-text search via Typesense with background reindex worker
- Webhook subscriptions with SSRF-safe delivery and retry logic
- Notification system: in-app, email (SendGrid/SES/SMTP), and digest worker
- Payment integration (Razorpay) with webhook event handling
- GDPR compliance: user data export, org data export, and offboarding workers
- Platform admin panel with MFA management and tenant oversight
- Audit logging with append-only enforcement and CI guard
- Google OAuth and SAML SSO authentication
- TOTP-based two-factor authentication with backup codes
- Rate limiting on auth and API endpoints
- OpenTelemetry tracing and Prometheus metrics
- Multi-stage Docker build and full docker-compose dev stack
- 82 test suites (unit, integration, e2e, smoke, load, authorization, realtime)
- CI/CD pipeline with lint, type-check, secrets scan, audit log guard, and staged deployments
