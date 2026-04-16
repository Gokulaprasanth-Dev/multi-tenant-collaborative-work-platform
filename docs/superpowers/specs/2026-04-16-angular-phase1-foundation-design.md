# Angular Frontend — Phase 1: Foundation Design

**Date:** 2026-04-16
**Phase:** 1 of 8
**Scope:** Angular app scaffold + routing + auth (login, register, MFA, SSO, email verify, password reset)
**Status:** Approved

---

## Context

The backend is a fully built Express + Socket.IO + PostgreSQL platform with 15 modules. This document specifies the Angular 17+ frontend — Phase 1 only. Future phases add the app shell, chat, tasks, video, files, search, payments, and admin.

All frontend code lives in `frontend/` at the project root. Backend runs on `http://localhost:3000`.

---

## Decisions

| Concern | Decision | Rationale |
|---|---|---|
| Component model | Standalone (Angular 17+) | No NgModule boilerplate; future-proof |
| Auth state | Angular Signals | Lighter than NgRx for Phase 1; NgRx introduced in Phase 3 |
| Visual theme | Modern Gradient (dark, purple/cyan) | Distinctive SaaS aesthetic |
| Auth layout | Centered glassmorphism card | Clean, focused; fits the gradient theme |
| Build approach | Scaffold-first | Architecture visible before UI; reviewable layer by layer |

---

## Project Structure

```
frontend/
├── src/
│   ├── app/
│   │   ├── core/
│   │   │   ├── services/
│   │   │   │   ├── auth.service.ts
│   │   │   │   ├── tenant.service.ts
│   │   │   │   └── token-storage.service.ts
│   │   │   ├── interceptors/
│   │   │   │   ├── jwt.interceptor.ts
│   │   │   │   ├── idempotency.interceptor.ts
│   │   │   │   └── error.interceptor.ts
│   │   │   ├── guards/
│   │   │   │   ├── auth.guard.ts
│   │   │   │   └── org.guard.ts
│   │   │   └── models/
│   │   │       ├── user.model.ts
│   │   │       ├── org.model.ts
│   │   │       └── api-response.model.ts
│   │   ├── features/
│   │   │   └── auth/
│   │   │       ├── auth.routes.ts
│   │   │       ├── layout/
│   │   │       │   └── auth-layout.component.ts   # Shared gradient bg + glass card shell
│   │   │       ├── login/
│   │   │       ├── register/
│   │   │       ├── verify-email/
│   │   │       ├── mfa/
│   │   │       ├── forgot-password/
│   │   │       ├── reset-password/
│   │   │       └── sso-callback/
│   │   ├── shared/
│   │   │   └── components/
│   │   │       └── loading-spinner/
│   │   ├── app.config.ts
│   │   ├── app.routes.ts
│   │   └── app.component.ts
│   ├── environments/
│   │   ├── environment.ts
│   │   └── environment.prod.ts
│   ├── styles/
│   │   ├── _theme.scss
│   │   └── _auth.scss
│   └── index.html
├── e2e/                          # Playwright tests
├── proxy.conf.json
├── tailwind.config.js
├── angular.json
└── CLAUDE.md
```

---

## Routing

### Root (`app.routes.ts`)

```
/           → redirect /app
/auth/**    → auth routes (public, no guards)
/app/**     → canActivate: [AuthGuard, OrgGuard] → lazy (Phase 2 shell)
/admin/**   → canActivate: [AuthGuard, RoleGuard('platform_admin')] → lazy (Phase 8)
/**         → redirect /auth/login
```

### Auth (`features/auth/auth.routes.ts`)

| Path | Component | Notes |
|---|---|---|
| `/auth/login` | `LoginComponent` | Email/password + Google + SAML SSO |
| `/auth/register` | `RegisterComponent` | Name, email, password |
| `/auth/verify` | `VerifyEmailComponent` | Reads `?token=`, auto-calls API |
| `/auth/mfa` | `MfaComponent` | 6-digit TOTP, auto-submit on digit 6 |
| `/auth/forgot` | `ForgotPasswordComponent` | Email input → sends reset link |
| `/auth/reset` | `ResetPasswordComponent` | Reads `?token=`, new password form |
| `/auth/callback` | `SsoCallbackComponent` | Reads `?token=`, calls `handleSsoToken()` |

### Auth flow state machine

```
/auth/login
  → credentials valid, mfa_required=true  → /auth/mfa
  → credentials valid, mfa_required=false → /app  (via AuthGuard pass)
  → credentials invalid                   → show error signal on login page

/auth/mfa
  → TOTP valid   → /app
  → TOTP invalid → show error signal, clear input

/auth/callback (SSO)
  → token present → handleSsoToken() → /app
  → token missing → /auth/login

/auth/verify
  → token valid   → show success, link to /auth/login
  → token invalid → show error state
```

---

## Core Services

### `AuthService`

Signals:
```typescript
currentUser = signal<User | null>(null);       // null = not logged in
isLoggedIn  = computed(() => !!this.currentUser());
isLoading   = signal(false);
```

Methods:
```typescript
login(email: string, password: string): Observable<LoginResult>
  // LoginResult: { user } | { mfaRequired: true }

register(name: string, email: string, password: string): Observable<void>

verifyEmail(token: string): Observable<void>

submitMfa(code: string): Observable<{ user: User }>

refreshToken(): Observable<string>
  // Called by JwtInterceptor on 401.
  // Queues concurrent requests — only one refresh call fires.
  // On refresh failure: calls logout().

logout(): void
  // Clears signals, clears TokenStorageService, navigates to /auth/login.

handleSsoToken(token: string): void
  // Decodes JWT, sets currentUser signal, stores tokens.
```

### `TenantService`

```typescript
activeOrg   = signal<Org | null>(null);
activeOrgId = computed(() => this.activeOrg()?.id ?? null);

setOrg(org: Org): void
loadUserOrgs(): Observable<Org[]>   // GET /api/v1/organizations
```

### `TokenStorageService`

Wraps `localStorage`. Isolated so it can be swapped to httpOnly cookies later without touching other services.

```typescript
getAccessToken(): string | null
setAccessToken(token: string): void
getRefreshToken(): string | null
setRefreshToken(token: string): void
clear(): void
```

---

## Interceptors

### `JwtInterceptor`

- Attaches `Authorization: Bearer <token>` from `TokenStorageService`
- Attaches `X-Org-ID` from `TenantService.activeOrgId()`
- On 401: calls `AuthService.refreshToken()` once, retries original request
- On second 401: calls `AuthService.logout()`
- Skips auth endpoints (`/api/v1/auth/login`, `/api/v1/auth/register`, `/api/v1/auth/refresh`)

### `IdempotencyInterceptor`

- Applies to `POST`, `PUT`, `PATCH`, `DELETE` only
- Attaches `Idempotency-Key: <crypto.randomUUID()>` header

### `ErrorInterceptor`

- Reads `error.code` from backend envelope `{ data, error, meta }`
- Returns typed `AppError` object — consumed via `catchError` in services
- Does not swallow errors — re-throws so components can react

---

## Guards

### `AuthGuard`

```typescript
// canActivate
if (authService.isLoggedIn()) return true;
router.navigate(['/auth/login']);
return false;
```

### `OrgGuard`

```typescript
// canActivate (runs after AuthGuard)
if (tenantService.activeOrgId()) return true;
// load orgs; if exactly one, auto-select it
// if multiple, redirect to org-picker (Phase 2 shell)
// if none, show error
```

### `RoleGuard` *(stub — implemented in Phase 8)*

A functional guard factory: `RoleGuard(role: string)`. In Phase 1, the `/admin` route is registered in root routes but points to a placeholder component. Full implementation deferred to Phase 8.

---

## Visual Design

### Theme

- **Background:** `linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)`
- **Accent primary:** `#a855f7` (purple)
- **Accent secondary:** `#06b6d4` (cyan)
- **CTA gradient:** `linear-gradient(90deg, #a855f7, #06b6d4)`
- **Glass card:** `background: rgba(255,255,255,0.06)`, `backdrop-filter: blur(20px)`, `border: 1px solid rgba(255,255,255,0.12)`, `border-radius: 20px`

### `AuthLayoutComponent`

Shared wrapper for all auth pages. Renders:
1. Full-viewport gradient background with two radial blob effects (purple top-left, cyan bottom-right)
2. Centered glass card (`width: 380px`, responsive)
3. `<router-outlet>` inside the card — each auth page fills the card interior

### Auth page structure (inside card)

1. Logo + app name + page subtitle
2. SSO buttons (login page only)
3. Divider (login page only)
4. Form fields with ghost/glass inputs
5. Gradient CTA button
6. Footer link (register ↔ login)
7. Error display: inline below form, styled in amber/red with low opacity background

---

## Environment

```typescript
// environment.ts
export const environment = {
  production: false,
  apiUrl: '',          // proxied — leave empty in dev
  wsUrl: 'http://localhost:3000',
  razorpayKeyId: '',
};
```

```json
// proxy.conf.json
{ "/api": { "target": "http://localhost:3000", "changeOrigin": true } }
```

```javascript
// tailwind.config.js
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: { extend: {} },
  plugins: [],
};
```

---

## Testing

### Unit (Jest)

- `AuthService`: signal transitions (login → isLoggedIn, logout → null), MFA branch, refresh queuing
- `TokenStorageService`: get/set/clear round-trips
- `JwtInterceptor`: header injection, 401 → refresh → retry, second 401 → logout
- `IdempotencyInterceptor`: UUID header on mutations, absent on GET
- `LoginComponent`: form validation, error signal display
- `MfaComponent`: auto-submit fires on 6th digit, not before

### E2E (Playwright, `frontend/e2e/`)

- Full login → `/app` redirect
- Login with invalid credentials → error shown
- Register → "check your email" state shown
- MFA challenge → valid code → `/app`
- SSO callback with `?token=` → `/app`
- 401 mid-session → token refresh → original request retried transparently
- Unauthenticated access to `/app` → redirected to `/auth/login`

---

## `.gitignore` additions

```
frontend/node_modules/
frontend/dist/
frontend/.angular/
.superpowers/
```

---

## Out of scope (Phase 1)

- App shell, sidebar, topbar (Phase 2)
- NgRx Store (Phase 3+)
- All feature modules: chat, tasks, video, files, search, notifications, payments, admin
- Dark/light mode toggle
- Internationalisation (i18n)
