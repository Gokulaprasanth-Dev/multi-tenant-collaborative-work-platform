# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Context

This is the Angular frontend for a multi-tenant collaborative work platform. The backend lives in `../src/` (Express + Socket.IO + PostgreSQL). All frontend work must stay inside this `frontend/` directory.

Backend API runs on `http://localhost:3000`. OpenAPI spec is at `http://localhost:3000/api-docs`.

## Commands

```bash
# Development
ng serve                        # Dev server at http://localhost:4200
ng serve --proxy-config proxy.conf.json   # With API proxy to backend

# Build
ng build                        # Development build → dist/
ng build --configuration production      # Production build

# Code generation
ng generate component features/chat/components/chat-window
ng generate service core/services/auth
ng generate guard core/guards/auth
ng generate module features/tasks --routing

# Testing
ng test                         # Unit tests (Karma/Jest)
ng test --include="**/chat/**"  # Single feature tests
npx playwright test             # E2E tests
npx playwright test --grep "login"  # Single E2E test

# Lint & type check
ng lint                         # ESLint
npx tsc --noEmit               # Type check without build

# Storybook
npx storybook dev -p 6006      # Component development
```

## Architecture

### Module layout (`src/app/`)

```
core/                    # Singleton services, guards, interceptors — imported once in AppModule
  services/              # AuthService, TenantService, SocketService
  guards/                # AuthGuard, RoleGuard, OrgGuard
  interceptors/          # JwtInterceptor (attaches Bearer token + X-Org-ID header)
  models/                # TypeScript interfaces matching backend response shapes

shared/                  # Reusable, stateless components/pipes/directives
  components/            # Buttons, modals, avatars, file-upload, quill-editor wrapper
  pipes/                 # DatePipe wrappers, file size, truncate
  directives/

features/                # One folder per backend module — lazy-loaded
  auth/                  # Login, register, MFA, SSO
  workspace/             # Workspace switcher, org context
  chat/                  # Channels, DMs, message thread, real-time
  tasks/                 # Board, list, detail, comments (Quill delta)
  video/                 # WebRTC call UI, signaling via Socket.IO
  files/                 # Upload, preview, download
  notifications/         # Notification bell, preference center
  search/                # Global search (Typesense-backed)
  admin/                 # Platform admin panel (platform-admin role only)
  settings/              # User profile, org settings, payment/billing

layout/                  # App shell: sidebar, topbar, org switcher

store/                   # NgRx root state — feature states live inside each feature folder
```

### Multi-tenancy pattern

Every API request must include:
- `Authorization: Bearer <jwt>` — attached by `JwtInterceptor`
- `X-Org-ID: <orgId>` — current org from `TenantService`
- `Idempotency-Key: <uuid>` — required on all mutating requests (POST/PUT/PATCH/DELETE)

`TenantService` holds the active org. Route guards check both auth and org membership before activating any feature route.

### Real-time (Socket.IO)

`SocketService` (core singleton) wraps `socket.io-client`. Connect once after login, disconnect on logout.

```typescript
// Pattern for feature services consuming socket events
this.socketService.fromEvent<ChatMessage>('chat:message')
  .pipe(takeUntilDestroyed())
  .subscribe(msg => this.store.dispatch(ChatActions.messageReceived({ msg })));
```

Socket rooms: `org:{orgId}:user:{userId}` (personal) and `org:{orgId}` (broadcast). The backend joins users to these rooms automatically on connection.

### State management (NgRx)

Use NgRx Store + Effects for features with real-time updates (chat, tasks, notifications). Use `@ngrx/signals` (`SignalStore`) for local UI state within components.

Feature state lives in `features/<name>/store/` with `actions.ts`, `reducer.ts`, `effects.ts`, `selectors.ts`.

### API conventions

- All responses: `{ data, error, meta: { correlation_id, request_id, timestamp } }` — access payload as `response.data`
- Errors: `response.error.code` (string code like `UNAUTHORIZED`, `NOT_FOUND`)
- Use `HttpClient` only through feature-specific API services (never directly in components)
- Task comment body must be Quill delta JSON: `{ ops: [{ insert: "text" }] }`

### Auth flow

1. Login → receive `accessToken` + `refreshToken`
2. `JwtInterceptor` attaches token; on 401, calls refresh endpoint, retries original request once
3. MFA: after credentials, backend returns `mfa_required: true` → redirect to MFA step
4. SSO (Google/SAML): handled via backend redirect — frontend receives token via query param on callback route

### Routing structure

```
/auth/**              → AuthModule (public, no guard)
/app/                 → AppShell (AuthGuard + OrgGuard)
  workspace/          → WorkspaceModule
  chat/               → ChatModule
  tasks/              → TaskModule
  video/              → VideoModule
  files/              → FileModule
  search/             → SearchModule
  settings/           → SettingsModule
/admin/               → AdminModule (RoleGuard: platform_admin only)
```

### Payments

Razorpay is the payment provider. Billing UI lives in `features/settings/billing/`. Load Razorpay script dynamically; never hardcode keys — read from environment.

## Environment files

```typescript
// src/environments/environment.ts (dev)
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000',
  wsUrl: 'http://localhost:3000',
  razorpayKeyId: '',
};
```

Use `proxy.conf.json` during development to proxy `/api` to `http://localhost:3000` to avoid CORS.

## Key dependencies

| Package | Purpose |
|---|---|
| `@angular/material` + `@angular/cdk` | UI components |
| `@ngrx/store`, `@ngrx/effects`, `@ngrx/entity` | Global state |
| `@ngrx/signals` | Local/component state |
| `socket.io-client` | Real-time connection to backend |
| `ngx-quill` + `quill` | Rich text editor for task comments |
| `ngx-dropzone` | File upload UI |
| `ngx-echarts` + `echarts` | Charts/dashboards |
| `tailwindcss` | Utility CSS alongside Angular Material |
| `@playwright/test` | E2E tests |
| `@storybook/angular` | Component development |
