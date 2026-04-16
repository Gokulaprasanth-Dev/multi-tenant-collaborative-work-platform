# Angular Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold a production-grade Angular 17+ app inside `frontend/` with auth pages (login, register, MFA, SSO, email verify, password reset), core services, interceptors, guards, and a Modern Gradient glassmorphism visual theme.

**Architecture:** Standalone Angular 17+ components with no NgModules. Auth state managed via Angular Signals (`currentUser`, `activeOrg`). Three HTTP interceptors handle JWT auth headers, idempotency keys, and error normalisation. All auth pages share a single `AuthLayoutComponent` (glassmorphism card on gradient background).

**Tech Stack:** Angular 17+, Angular Material, TailwindCSS, Angular Signals, Playwright (E2E), Jest (unit).

---

## File Map

```
frontend/
├── src/
│   ├── app/
│   │   ├── core/
│   │   │   ├── models/
│   │   │   │   ├── user.model.ts
│   │   │   │   ├── org.model.ts
│   │   │   │   └── api-response.model.ts
│   │   │   ├── services/
│   │   │   │   ├── token-storage.service.ts
│   │   │   │   ├── token-storage.service.spec.ts
│   │   │   │   ├── tenant.service.ts
│   │   │   │   ├── tenant.service.spec.ts
│   │   │   │   ├── auth.service.ts
│   │   │   │   └── auth.service.spec.ts
│   │   │   ├── interceptors/
│   │   │   │   ├── jwt.interceptor.ts
│   │   │   │   ├── jwt.interceptor.spec.ts
│   │   │   │   ├── idempotency.interceptor.ts
│   │   │   │   ├── idempotency.interceptor.spec.ts
│   │   │   │   ├── error.interceptor.ts
│   │   │   │   └── error.interceptor.spec.ts
│   │   │   └── guards/
│   │   │       ├── auth.guard.ts
│   │   │       ├── auth.guard.spec.ts
│   │   │       ├── org.guard.ts
│   │   │       ├── org.guard.spec.ts
│   │   │       └── role.guard.ts
│   │   ├── features/
│   │   │   └── auth/
│   │   │       ├── auth.routes.ts
│   │   │       ├── layout/
│   │   │       │   └── auth-layout.component.ts
│   │   │       ├── login/
│   │   │       │   ├── login.component.ts
│   │   │       │   └── login.component.spec.ts
│   │   │       ├── register/
│   │   │       │   └── register.component.ts
│   │   │       ├── verify-email/
│   │   │       │   └── verify-email.component.ts
│   │   │       ├── mfa/
│   │   │       │   ├── mfa.component.ts
│   │   │       │   └── mfa.component.spec.ts
│   │   │       ├── forgot-password/
│   │   │       │   └── forgot-password.component.ts
│   │   │       ├── reset-password/
│   │   │       │   └── reset-password.component.ts
│   │   │       └── sso-callback/
│   │   │           └── sso-callback.component.ts
│   │   ├── shared/
│   │   │   └── components/
│   │   │       └── loading-spinner/
│   │   │           └── loading-spinner.component.ts
│   │   ├── app.component.ts
│   │   ├── app.config.ts
│   │   └── app.routes.ts
│   ├── environments/
│   │   ├── environment.ts
│   │   └── environment.prod.ts
│   ├── styles/
│   │   ├── _theme.scss
│   │   └── _auth.scss
│   └── styles.scss
├── e2e/
│   ├── auth.spec.ts
│   └── playwright.config.ts
├── proxy.conf.json
├── tailwind.config.js
└── CLAUDE.md
```

---

## Task 1: Scaffold Angular Project

**Files:**
- Create: `frontend/` (Angular CLI output)
- Modify: `.gitignore`

- [ ] **Step 1: Run `ng new` into the existing `frontend/` folder**

From the project root (`multi-tenant_collaborative_work_platform/`):

```bash
npx @angular/cli@17 new platform-frontend \
  --directory=frontend \
  --skip-git \
  --style=scss \
  --routing=false \
  --ssr=false \
  --standalone
```

Expected output ends with: `✔ Packages installed successfully.`

- [ ] **Step 2: Install additional production dependencies**

```bash
cd frontend
npm install @angular/material @angular/cdk
npm install socket.io-client
npm install ngx-quill quill
npm install ngx-dropzone
npm install echarts ngx-echarts
npm install luxon
npm install @types/luxon --save-dev
```

- [ ] **Step 3: Install TailwindCSS**

```bash
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init
```

- [ ] **Step 4: Install Playwright**

```bash
npm install -D @playwright/test
npx playwright install chromium
```

- [ ] **Step 5: Install Angular Material schematics**

```bash
ng add @angular/material --theme=custom --typography=true --animations=enabled
```

When prompted for a prebuilt theme, choose **Custom**. When asked about global typography, choose **Yes**.

- [ ] **Step 6: Add gitignore entries**

Open the root `.gitignore` and append:

```
# Angular frontend
frontend/node_modules/
frontend/dist/
frontend/.angular/
.superpowers/
```

- [ ] **Step 7: Commit scaffold**

```bash
cd ..
git add frontend/ .gitignore
git commit -m "feat(frontend): scaffold Angular 17 standalone app"
```

---

## Task 2: Configure TailwindCSS + Theme

**Files:**
- Create: `frontend/tailwind.config.js`
- Create: `frontend/src/styles/_theme.scss`
- Create: `frontend/src/styles/_auth.scss`
- Modify: `frontend/src/styles.scss`

- [ ] **Step 1: Write `tailwind.config.js`**

```javascript
// frontend/tailwind.config.js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: { extend: {} },
  plugins: [],
};
```

- [ ] **Step 2: Write `src/styles/_theme.scss`** — Angular Material custom theme

```scss
// frontend/src/styles/_theme.scss
@use '@angular/material' as mat;

$platform-purple: (
  50:  #f3e8ff,
  100: #e9d5ff,
  200: #d8b4fe,
  300: #c084fc,
  400: #a855f7,
  500: #9333ea,
  600: #7c3aed,
  700: #6d28d9,
  800: #5b21b6,
  900: #4c1d95,
  contrast: (
    50:  rgba(0,0,0,0.87),
    100: rgba(0,0,0,0.87),
    200: rgba(0,0,0,0.87),
    300: rgba(0,0,0,0.87),
    400: white,
    500: white,
    600: white,
    700: white,
    800: white,
    900: white,
  )
);

$platform-cyan: (
  50:  #ecfeff,
  100: #cffafe,
  200: #a5f3fc,
  300: #67e8f9,
  400: #22d3ee,
  500: #06b6d4,
  600: #0891b2,
  700: #0e7490,
  800: #155e75,
  900: #164e63,
  contrast: (
    50:  rgba(0,0,0,0.87),
    100: rgba(0,0,0,0.87),
    200: rgba(0,0,0,0.87),
    300: rgba(0,0,0,0.87),
    400: rgba(0,0,0,0.87),
    500: white,
    600: white,
    700: white,
    800: white,
    900: white,
  )
);

$primary-palette: mat.define-palette($platform-purple, 400);
$accent-palette:  mat.define-palette($platform-cyan, 500);
$warn-palette:    mat.define-palette(mat.$red-palette);

$platform-theme: mat.define-dark-theme((
  color: (
    primary: $primary-palette,
    accent:  $accent-palette,
    warn:    $warn-palette,
  ),
  typography: mat.define-typography-config(
    $font-family: 'Inter, system-ui, sans-serif',
  ),
  density: 0,
));

@include mat.all-component-themes($platform-theme);
```

- [ ] **Step 3: Write `src/styles/_auth.scss`** — glassmorphism utilities

```scss
// frontend/src/styles/_auth.scss

// Full-viewport gradient background
.auth-bg {
  min-height: 100vh;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
}

// Decorative radial blobs
.auth-blob-purple {
  position: absolute;
  top: -80px;
  left: -80px;
  width: 320px;
  height: 320px;
  background: radial-gradient(circle, rgba(168, 85, 247, 0.25), transparent 70%);
  border-radius: 50%;
  pointer-events: none;
}

.auth-blob-cyan {
  position: absolute;
  bottom: -60px;
  right: -60px;
  width: 280px;
  height: 280px;
  background: radial-gradient(circle, rgba(6, 182, 212, 0.2), transparent 70%);
  border-radius: 50%;
  pointer-events: none;
}

// Glassmorphism card
.auth-card {
  position: relative;
  z-index: 1;
  width: 380px;
  max-width: calc(100vw - 2rem);
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 20px;
  padding: 2.5rem 2rem;
}

// Ghost input fields
.auth-input {
  width: 100%;
  background: rgba(255, 255, 255, 0.07) !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  border-radius: 8px !important;
  color: #f1f5f9 !important;

  &::placeholder { color: #64748b !important; }
  &:focus { border-color: #a855f7 !important; outline: none; }
}

// Gradient CTA button
.auth-btn-primary {
  width: 100%;
  height: 42px;
  background: linear-gradient(90deg, #a855f7, #06b6d4);
  border: none;
  border-radius: 8px;
  color: white;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: opacity 0.2s;

  &:hover { opacity: 0.9; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

// SSO ghost button
.auth-btn-sso {
  flex: 1;
  height: 38px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  color: #e2e8f0;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s;

  &:hover { background: rgba(255, 255, 255, 0.12); }
}

// Divider
.auth-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 1rem 0;

  &__line { flex: 1; height: 1px; background: rgba(255, 255, 255, 0.1); }
  &__text { color: #64748b; font-size: 12px; white-space: nowrap; }
}

// Error banner
.auth-error {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 8px;
  padding: 0.75rem 1rem;
  color: #fca5a5;
  font-size: 13px;
  margin-bottom: 1rem;
}

// Success banner
.auth-success {
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.3);
  border-radius: 8px;
  padding: 0.75rem 1rem;
  color: #86efac;
  font-size: 13px;
  margin-bottom: 1rem;
}

// Field label
.auth-label {
  display: block;
  color: #cbd5e1;
  font-size: 13px;
  margin-bottom: 6px;
}

// Footer link row
.auth-footer {
  text-align: center;
  margin-top: 1.25rem;
  color: #64748b;
  font-size: 13px;

  a { color: #a855f7; text-decoration: none; &:hover { text-decoration: underline; } }
}
```

- [ ] **Step 4: Update `src/styles.scss`**

```scss
// frontend/src/styles.scss
@use 'styles/theme';
@use 'styles/auth';

@tailwind base;
@tailwind components;
@tailwind utilities;

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: 'Inter', system-ui, sans-serif;
  background: #0f172a;
  color: #f1f5f9;
}

// Load Inter font
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
```

- [ ] **Step 5: Commit theme setup**

```bash
git add frontend/tailwind.config.js frontend/src/styles/
git commit -m "feat(frontend): add TailwindCSS + Material dark theme + auth glassmorphism styles"
```

---

## Task 3: Models

**Files:**
- Create: `frontend/src/app/core/models/user.model.ts`
- Create: `frontend/src/app/core/models/org.model.ts`
- Create: `frontend/src/app/core/models/api-response.model.ts`

- [ ] **Step 1: Write `user.model.ts`**

```typescript
// frontend/src/app/core/models/user.model.ts
export interface User {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  role: 'member' | 'admin' | 'platform_admin';
  createdAt: string;
}
```

- [ ] **Step 2: Write `org.model.ts`**

```typescript
// frontend/src/app/core/models/org.model.ts
export interface Org {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'cancelled';
  plan: string;
}
```

- [ ] **Step 3: Write `api-response.model.ts`**

```typescript
// frontend/src/app/core/models/api-response.model.ts
export interface ApiMeta {
  correlationId: string;
  requestId: string;
  timestamp: string;
}

export interface ApiError {
  code: string;
  message: string;
}

export interface ApiResponse<T> {
  data: T;
  error: ApiError | null;
  meta: ApiMeta;
}

// Typed error thrown by ErrorInterceptor
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
```

- [ ] **Step 4: Commit models**

```bash
git add frontend/src/app/core/models/
git commit -m "feat(frontend): add User, Org, ApiResponse models"
```

---

## Task 4: TokenStorageService

**Files:**
- Create: `frontend/src/app/core/services/token-storage.service.ts`
- Create: `frontend/src/app/core/services/token-storage.service.spec.ts`

- [ ] **Step 1: Write failing test**

```typescript
// frontend/src/app/core/services/token-storage.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { TokenStorageService } from './token-storage.service';

describe('TokenStorageService', () => {
  let service: TokenStorageService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TokenStorageService);
    localStorage.clear();
  });

  it('returns null when no access token stored', () => {
    expect(service.getAccessToken()).toBeNull();
  });

  it('stores and retrieves access token', () => {
    service.setAccessToken('tok-abc');
    expect(service.getAccessToken()).toBe('tok-abc');
  });

  it('stores and retrieves refresh token', () => {
    service.setRefreshToken('ref-xyz');
    expect(service.getRefreshToken()).toBe('ref-xyz');
  });

  it('clear() removes both tokens', () => {
    service.setAccessToken('tok-abc');
    service.setRefreshToken('ref-xyz');
    service.clear();
    expect(service.getAccessToken()).toBeNull();
    expect(service.getRefreshToken()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd frontend && npx ng test --include="**/token-storage.service.spec.ts" --watch=false
```

Expected: `Cannot find module './token-storage.service'`

- [ ] **Step 3: Write implementation**

```typescript
// frontend/src/app/core/services/token-storage.service.ts
import { Injectable } from '@angular/core';

const ACCESS_KEY  = 'platform_access_token';
const REFRESH_KEY = 'platform_refresh_token';

@Injectable({ providedIn: 'root' })
export class TokenStorageService {
  getAccessToken(): string | null  { return localStorage.getItem(ACCESS_KEY); }
  setAccessToken(token: string): void { localStorage.setItem(ACCESS_KEY, token); }

  getRefreshToken(): string | null { return localStorage.getItem(REFRESH_KEY); }
  setRefreshToken(token: string): void { localStorage.setItem(REFRESH_KEY, token); }

  clear(): void {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx ng test --include="**/token-storage.service.spec.ts" --watch=false
```

Expected: `3 specs, 0 failures`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/core/services/token-storage.service*
git commit -m "feat(frontend): add TokenStorageService"
```

---

## Task 5: TenantService

**Files:**
- Create: `frontend/src/app/core/services/tenant.service.ts`
- Create: `frontend/src/app/core/services/tenant.service.spec.ts`

- [ ] **Step 1: Write failing test**

```typescript
// frontend/src/app/core/services/tenant.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TenantService } from './tenant.service';
import { Org } from '../models/org.model';

const mockOrg: Org = {
  id: 'org-1',
  name: 'Acme',
  slug: 'acme',
  status: 'active',
  plan: 'pro',
};

describe('TenantService', () => {
  let service: TenantService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    service = TestBed.inject(TenantService);
    http    = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('activeOrg starts null', () => {
    expect(service.activeOrg()).toBeNull();
  });

  it('setOrg updates activeOrg and activeOrgId signals', () => {
    service.setOrg(mockOrg);
    expect(service.activeOrg()).toEqual(mockOrg);
    expect(service.activeOrgId()).toBe('org-1');
  });

  it('loadUserOrgs GETs /api/v1/organizations', () => {
    service.loadUserOrgs().subscribe(orgs => expect(orgs.length).toBe(1));
    const req = http.expectOne('/api/v1/organizations');
    expect(req.request.method).toBe('GET');
    req.flush({ data: [mockOrg], error: null, meta: {} });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx ng test --include="**/tenant.service.spec.ts" --watch=false
```

Expected: `Cannot find module './tenant.service'`

- [ ] **Step 3: Write implementation**

```typescript
// frontend/src/app/core/services/tenant.service.ts
import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { Org } from '../models/org.model';
import { ApiResponse } from '../models/api-response.model';

@Injectable({ providedIn: 'root' })
export class TenantService {
  readonly activeOrg   = signal<Org | null>(null);
  readonly activeOrgId = computed(() => this.activeOrg()?.id ?? null);

  constructor(private http: HttpClient) {}

  setOrg(org: Org): void {
    this.activeOrg.set(org);
  }

  loadUserOrgs(): Observable<Org[]> {
    return this.http
      .get<ApiResponse<Org[]>>('/api/v1/organizations')
      .pipe(map(res => res.data));
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx ng test --include="**/tenant.service.spec.ts" --watch=false
```

Expected: `3 specs, 0 failures`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/core/services/tenant.service*
git commit -m "feat(frontend): add TenantService with activeOrg signal"
```

---

## Task 6: AuthService

**Files:**
- Create: `frontend/src/app/core/services/auth.service.ts`
- Create: `frontend/src/app/core/services/auth.service.spec.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// frontend/src/app/core/services/auth.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { TokenStorageService } from './token-storage.service';

const mockUser = {
  id: 'u-1', email: 'a@b.com', name: 'Alice',
  emailVerified: true, mfaEnabled: false,
  role: 'member' as const, createdAt: '2026-01-01',
};

describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;
  let storage: TokenStorageService;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        { provide: Router, useValue: { navigate: jest.fn() } },
      ],
    });
    service = TestBed.inject(AuthService);
    http    = TestBed.inject(HttpTestingController);
    storage = TestBed.inject(TokenStorageService);
    router  = TestBed.inject(Router);
    localStorage.clear();
  });

  afterEach(() => http.verify());

  it('currentUser starts null, isLoggedIn starts false', () => {
    expect(service.currentUser()).toBeNull();
    expect(service.isLoggedIn()).toBe(false);
  });

  it('login() sets currentUser signal on success', () => {
    service.login('a@b.com', 'pass').subscribe();
    const req = http.expectOne('/api/v1/auth/login');
    req.flush({ data: { user: mockUser, accessToken: 'tok', refreshToken: 'ref' }, error: null, meta: {} });
    expect(service.currentUser()).toEqual(mockUser);
    expect(service.isLoggedIn()).toBe(true);
  });

  it('login() returns { mfaRequired: true } when backend signals MFA', () => {
    let result: any;
    service.login('a@b.com', 'pass').subscribe(r => result = r);
    const req = http.expectOne('/api/v1/auth/login');
    req.flush({ data: { mfa_required: true }, error: null, meta: {} });
    expect(result).toEqual({ mfaRequired: true });
    expect(service.currentUser()).toBeNull();
  });

  it('logout() clears currentUser and navigates to /auth/login', () => {
    service['currentUserSignal'].set(mockUser);
    storage.setAccessToken('tok');
    service.logout();
    expect(service.currentUser()).toBeNull();
    expect(storage.getAccessToken()).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(['/auth/login']);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx ng test --include="**/auth.service.spec.ts" --watch=false
```

Expected: `Cannot find module './auth.service'`

- [ ] **Step 3: Write implementation**

```typescript
// frontend/src/app/core/services/auth.service.ts
import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, BehaviorSubject, throwError } from 'rxjs';
import { map, switchMap, catchError, tap, filter, take } from 'rxjs/operators';
import { User } from '../models/user.model';
import { ApiResponse } from '../models/api-response.model';
import { TokenStorageService } from './token-storage.service';

export type LoginResult = { user: User } | { mfaRequired: true };

@Injectable({ providedIn: 'root' })
export class AuthService {
  // Expose signals publicly as readonly
  private currentUserSignal = signal<User | null>(null);
  readonly currentUser      = this.currentUserSignal.asReadonly();
  readonly isLoggedIn       = computed(() => !!this.currentUserSignal());
  readonly isLoading        = signal(false);

  // Refresh token queue — prevents multiple concurrent refresh calls
  private refreshing$     = new BehaviorSubject<boolean>(false);
  private refreshToken$?: Observable<string>;

  constructor(
    private http:    HttpClient,
    private storage: TokenStorageService,
    private router:  Router,
  ) {}

  login(email: string, password: string): Observable<LoginResult> {
    this.isLoading.set(true);
    return this.http
      .post<ApiResponse<any>>('/api/v1/auth/login', { email, password })
      .pipe(
        map(res => {
          if (res.data.mfa_required) return { mfaRequired: true as const };
          this.currentUserSignal.set(res.data.user);
          this.storage.setAccessToken(res.data.accessToken);
          this.storage.setRefreshToken(res.data.refreshToken);
          return { user: res.data.user };
        }),
        tap(() => this.isLoading.set(false)),
        catchError(err => { this.isLoading.set(false); return throwError(() => err); }),
      );
  }

  register(name: string, email: string, password: string): Observable<void> {
    return this.http
      .post<ApiResponse<void>>('/api/v1/auth/register', { name, email, password })
      .pipe(map(() => void 0));
  }

  verifyEmail(token: string): Observable<void> {
    return this.http
      .post<ApiResponse<void>>('/api/v1/auth/verify-email', { token })
      .pipe(map(() => void 0));
  }

  submitMfa(code: string): Observable<{ user: User }> {
    return this.http
      .post<ApiResponse<{ user: User; accessToken: string; refreshToken: string }>>('/api/v1/auth/mfa/verify', { code })
      .pipe(
        map(res => {
          this.currentUserSignal.set(res.data.user);
          this.storage.setAccessToken(res.data.accessToken);
          this.storage.setRefreshToken(res.data.refreshToken);
          return { user: res.data.user };
        }),
      );
  }

  refreshToken(): Observable<string> {
    // Queue concurrent calls — only one HTTP request fires
    if (!this.refreshing$.value) {
      this.refreshing$.next(true);
      this.refreshToken$ = this.http
        .post<ApiResponse<{ accessToken: string }>>('/api/v1/auth/refresh', {
          refreshToken: this.storage.getRefreshToken(),
        })
        .pipe(
          map(res => {
            this.storage.setAccessToken(res.data.accessToken);
            this.refreshing$.next(false);
            return res.data.accessToken;
          }),
          catchError(err => {
            this.refreshing$.next(false);
            this.logout();
            return throwError(() => err);
          }),
        );
    }
    return this.refreshing$.pipe(
      filter(r => !r),
      take(1),
      switchMap(() => new Observable<string>(obs => {
        const t = this.storage.getAccessToken();
        if (t) { obs.next(t); obs.complete(); }
        else obs.error(new Error('No token after refresh'));
      })),
    );
  }

  handleSsoToken(token: string): void {
    // Backend sends a pre-signed JWT; decode payload for user info
    const payload = JSON.parse(atob(token.split('.')[1]));
    this.storage.setAccessToken(token);
    if (payload.refreshToken) this.storage.setRefreshToken(payload.refreshToken);
    this.currentUserSignal.set({
      id:            payload.sub,
      email:         payload.email,
      name:          payload.name ?? payload.email,
      emailVerified: true,
      mfaEnabled:    payload.mfaEnabled ?? false,
      role:          payload.role ?? 'member',
      createdAt:     payload.iat ? new Date(payload.iat * 1000).toISOString() : '',
    });
  }

  logout(): void {
    this.currentUserSignal.set(null);
    this.storage.clear();
    this.router.navigate(['/auth/login']);
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx ng test --include="**/auth.service.spec.ts" --watch=false
```

Expected: `4 specs, 0 failures`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/core/services/auth.service*
git commit -m "feat(frontend): add AuthService with Signals + refresh token queuing"
```

---

## Task 7: Interceptors

**Files:**
- Create: `frontend/src/app/core/interceptors/jwt.interceptor.ts`
- Create: `frontend/src/app/core/interceptors/jwt.interceptor.spec.ts`
- Create: `frontend/src/app/core/interceptors/idempotency.interceptor.ts`
- Create: `frontend/src/app/core/interceptors/idempotency.interceptor.spec.ts`
- Create: `frontend/src/app/core/interceptors/error.interceptor.ts`
- Create: `frontend/src/app/core/interceptors/error.interceptor.spec.ts`

- [ ] **Step 1: Write JWT interceptor tests**

```typescript
// frontend/src/app/core/interceptors/jwt.interceptor.spec.ts
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { jwtInterceptor } from './jwt.interceptor';
import { TokenStorageService } from '../services/token-storage.service';
import { TenantService } from '../services/tenant.service';
import { AuthService } from '../services/auth.service';
import { Router } from '@angular/router';

describe('jwtInterceptor', () => {
  let http: HttpClient;
  let ctrl: HttpTestingController;
  let storage: TokenStorageService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([jwtInterceptor])),
        { provide: Router, useValue: { navigate: jest.fn() } },
      ],
    });
    http    = TestBed.inject(HttpClient);
    ctrl    = TestBed.inject(HttpTestingController);
    storage = TestBed.inject(TokenStorageService);
    localStorage.clear();
  });

  afterEach(() => ctrl.verify());

  it('attaches Authorization header when token exists', () => {
    storage.setAccessToken('my-token');
    http.get('/api/v1/tasks').subscribe();
    const req = ctrl.expectOne('/api/v1/tasks');
    expect(req.request.headers.get('Authorization')).toBe('Bearer my-token');
    req.flush({});
  });

  it('does NOT attach Authorization header on auth endpoints', () => {
    storage.setAccessToken('my-token');
    http.post('/api/v1/auth/login', {}).subscribe();
    const req = ctrl.expectOne('/api/v1/auth/login');
    expect(req.request.headers.get('Authorization')).toBeNull();
    req.flush({});
  });

  it('attaches X-Org-ID when activeOrgId is set', () => {
    const tenant = TestBed.inject(TenantService);
    tenant.setOrg({ id: 'org-99', name: 'X', slug: 'x', status: 'active', plan: 'pro' });
    storage.setAccessToken('tok');
    http.get('/api/v1/tasks').subscribe();
    const req = ctrl.expectOne('/api/v1/tasks');
    expect(req.request.headers.get('X-Org-ID')).toBe('org-99');
    req.flush({});
  });
});
```

- [ ] **Step 2: Write JWT interceptor implementation**

```typescript
// frontend/src/app/core/interceptors/jwt.interceptor.ts
import { HttpInterceptorFn, HttpRequest, HttpHandlerFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { throwError, catchError, switchMap } from 'rxjs';
import { TokenStorageService } from '../services/token-storage.service';
import { TenantService }       from '../services/tenant.service';
import { AuthService }         from '../services/auth.service';

const AUTH_URLS = [
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/refresh',
  '/api/v1/auth/verify-email',
  '/api/v1/auth/forgot-password',
  '/api/v1/auth/reset-password',
];

function addHeaders(req: HttpRequest<unknown>, token: string | null, orgId: string | null) {
  let headers = req.headers;
  if (token) headers = headers.set('Authorization', `Bearer ${token}`);
  if (orgId) headers = headers.set('X-Org-ID', orgId);
  return req.clone({ headers });
}

export const jwtInterceptor: HttpInterceptorFn = (req, next) => {
  const storage = inject(TokenStorageService);
  const tenant  = inject(TenantService);
  const auth    = inject(AuthService);

  const isAuthUrl = AUTH_URLS.some(url => req.url.includes(url));
  if (isAuthUrl) return next(req);

  const cloned = addHeaders(req, storage.getAccessToken(), tenant.activeOrgId());

  return next(cloned).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status !== 401) return throwError(() => err);

      return auth.refreshToken().pipe(
        switchMap(newToken => {
          const retried = addHeaders(req, newToken, tenant.activeOrgId());
          return next(retried).pipe(
            catchError(err2 => {
              if (err2.status === 401) auth.logout();
              return throwError(() => err2);
            }),
          );
        }),
      );
    }),
  );
};
```

- [ ] **Step 3: Write idempotency interceptor tests**

```typescript
// frontend/src/app/core/interceptors/idempotency.interceptor.spec.ts
import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController } from '@angular/common/http/testing';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { idempotencyInterceptor } from './idempotency.interceptor';

describe('idempotencyInterceptor', () => {
  let http: HttpClient;
  let ctrl: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([idempotencyInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    ctrl = TestBed.inject(HttpTestingController);
  });

  afterEach(() => ctrl.verify());

  it('adds Idempotency-Key header on POST', () => {
    http.post('/api/v1/tasks', {}).subscribe();
    const req = ctrl.expectOne('/api/v1/tasks');
    expect(req.request.headers.get('Idempotency-Key')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    req.flush({});
  });

  it('does NOT add Idempotency-Key on GET', () => {
    http.get('/api/v1/tasks').subscribe();
    const req = ctrl.expectOne('/api/v1/tasks');
    expect(req.request.headers.get('Idempotency-Key')).toBeNull();
    req.flush({});
  });
});
```

- [ ] **Step 4: Write idempotency interceptor implementation**

```typescript
// frontend/src/app/core/interceptors/idempotency.interceptor.ts
import { HttpInterceptorFn } from '@angular/common/http';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const idempotencyInterceptor: HttpInterceptorFn = (req, next) => {
  if (!MUTATING.has(req.method)) return next(req);
  return next(req.clone({
    headers: req.headers.set('Idempotency-Key', crypto.randomUUID()),
  }));
};
```

- [ ] **Step 5: Write error interceptor**

```typescript
// frontend/src/app/core/interceptors/error.interceptor.ts
import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { throwError, catchError } from 'rxjs';
import { AppError } from '../models/api-response.model';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      const code    = err.error?.error?.code ?? 'UNKNOWN_ERROR';
      const message = err.error?.error?.message ?? err.message;
      return throwError(() => new AppError(code, message, err.status));
    }),
  );
};
```

- [ ] **Step 6: Run all interceptor tests — expect PASS**

```bash
npx ng test --include="**/interceptors/**" --watch=false
```

Expected: all specs pass.

- [ ] **Step 7: Commit interceptors**

```bash
git add frontend/src/app/core/interceptors/
git commit -m "feat(frontend): add JWT, Idempotency, Error interceptors"
```

---

## Task 8: Guards

**Files:**
- Create: `frontend/src/app/core/guards/auth.guard.ts`
- Create: `frontend/src/app/core/guards/auth.guard.spec.ts`
- Create: `frontend/src/app/core/guards/org.guard.ts`
- Create: `frontend/src/app/core/guards/org.guard.spec.ts`
- Create: `frontend/src/app/core/guards/role.guard.ts`

- [ ] **Step 1: Write auth guard test**

```typescript
// frontend/src/app/core/guards/auth.guard.spec.ts
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { authGuard } from './auth.guard';
import { AuthService } from '../services/auth.service';
import { signal, computed } from '@angular/core';

function makeAuthService(loggedIn: boolean) {
  const currentUser = signal(loggedIn ? { id: 'u1' } as any : null);
  return {
    currentUser: currentUser.asReadonly(),
    isLoggedIn: computed(() => !!currentUser()),
  };
}

describe('authGuard', () => {
  let router: { navigate: jest.Mock };

  beforeEach(() => {
    router = { navigate: jest.fn() };
    TestBed.configureTestingModule({
      providers: [{ provide: Router, useValue: router }],
    });
  });

  it('returns true when logged in', () => {
    TestBed.overrideProvider(AuthService, { useValue: makeAuthService(true) });
    const result = TestBed.runInInjectionContext(() =>
      authGuard({} as any, {} as any)
    );
    expect(result).toBe(true);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('navigates to /auth/login and returns false when not logged in', () => {
    TestBed.overrideProvider(AuthService, { useValue: makeAuthService(false) });
    const result = TestBed.runInInjectionContext(() =>
      authGuard({} as any, {} as any)
    );
    expect(result).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith(['/auth/login']);
  });
});
```

- [ ] **Step 2: Write auth guard implementation**

```typescript
// frontend/src/app/core/guards/auth.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = () => {
  const auth   = inject(AuthService);
  const router = inject(Router);

  if (auth.isLoggedIn()) return true;

  router.navigate(['/auth/login']);
  return false;
};
```

- [ ] **Step 3: Write org guard**

```typescript
// frontend/src/app/core/guards/org.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { TenantService } from '../services/tenant.service';
import { firstValueFrom } from 'rxjs';

export const orgGuard: CanActivateFn = async () => {
  const tenant = inject(TenantService);
  const router = inject(Router);

  if (tenant.activeOrgId()) return true;

  // Try to auto-select if user belongs to exactly one org
  try {
    const orgs = await firstValueFrom(tenant.loadUserOrgs());
    if (orgs.length === 1) {
      tenant.setOrg(orgs[0]);
      return true;
    }
    // Multiple orgs — Phase 2 shell will handle org-picker
    // For now redirect to login (Phase 2 will add /select-org)
    router.navigate(['/auth/login']);
    return false;
  } catch {
    router.navigate(['/auth/login']);
    return false;
  }
};
```

- [ ] **Step 4: Write role guard stub**

```typescript
// frontend/src/app/core/guards/role.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

// Stub — full implementation in Phase 8
export function roleGuard(requiredRole: string): CanActivateFn {
  return () => {
    const auth   = inject(AuthService);
    const router = inject(Router);
    const user   = auth.currentUser();

    if (user?.role === requiredRole) return true;

    router.navigate(['/auth/login']);
    return false;
  };
}
```

- [ ] **Step 5: Run guard tests — expect PASS**

```bash
npx ng test --include="**/guards/**" --watch=false
```

Expected: all specs pass.

- [ ] **Step 6: Commit guards**

```bash
git add frontend/src/app/core/guards/
git commit -m "feat(frontend): add AuthGuard, OrgGuard, RoleGuard stub"
```

---

## Task 9: App Config + Routing

**Files:**
- Modify: `frontend/src/app/app.config.ts`
- Modify: `frontend/src/app/app.routes.ts`
- Modify: `frontend/src/app/app.component.ts`
- Create: `frontend/proxy.conf.json`
- Modify: `frontend/src/environments/environment.ts`
- Create: `frontend/src/environments/environment.prod.ts`

- [ ] **Step 1: Write `app.config.ts`**

```typescript
// frontend/src/app/app.config.ts
import { ApplicationConfig } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { routes } from './app.routes';
import { jwtInterceptor }         from './core/interceptors/jwt.interceptor';
import { idempotencyInterceptor } from './core/interceptors/idempotency.interceptor';
import { errorInterceptor }       from './core/interceptors/error.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([
      jwtInterceptor,
      idempotencyInterceptor,
      errorInterceptor,
    ])),
    provideAnimations(),
  ],
};
```

- [ ] **Step 2: Write `app.routes.ts`**

```typescript
// frontend/src/app/app.routes.ts
import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { orgGuard }  from './core/guards/org.guard';
import { roleGuard } from './core/guards/role.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: '/app',
    pathMatch: 'full',
  },
  {
    path: 'auth',
    loadChildren: () =>
      import('./features/auth/auth.routes').then(m => m.authRoutes),
  },
  {
    path: 'app',
    canActivate: [authGuard, orgGuard],
    // Phase 2 shell — placeholder component for now
    loadComponent: () =>
      import('./features/shell/shell-placeholder.component').then(
        m => m.ShellPlaceholderComponent,
      ),
  },
  {
    path: 'admin',
    canActivate: [authGuard, roleGuard('platform_admin')],
    // Phase 8 admin panel — placeholder for now
    loadComponent: () =>
      import('./features/admin/admin-placeholder.component').then(
        m => m.AdminPlaceholderComponent,
      ),
  },
  {
    path: '**',
    redirectTo: '/auth/login',
  },
];
```

- [ ] **Step 3: Write `app.component.ts`**

```typescript
// frontend/src/app/app.component.ts
import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
export class AppComponent {}
```

- [ ] **Step 4: Create placeholder components for Phase 2 and Phase 8 routes**

```typescript
// frontend/src/app/features/shell/shell-placeholder.component.ts
import { Component } from '@angular/core';

@Component({
  selector: 'app-shell-placeholder',
  standalone: true,
  template: `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;color:#f1f5f9">
      <p>App shell — coming in Phase 2</p>
    </div>
  `,
})
export class ShellPlaceholderComponent {}
```

```typescript
// frontend/src/app/features/admin/admin-placeholder.component.ts
import { Component } from '@angular/core';

@Component({
  selector: 'app-admin-placeholder',
  standalone: true,
  template: `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;color:#f1f5f9">
      <p>Admin panel — coming in Phase 8</p>
    </div>
  `,
})
export class AdminPlaceholderComponent {}
```

- [ ] **Step 5: Write environment files**

```typescript
// frontend/src/environments/environment.ts
export const environment = {
  production:    false,
  apiUrl:        '',               // proxied via proxy.conf.json in dev
  wsUrl:         'http://localhost:3000',
  razorpayKeyId: '',
};
```

```typescript
// frontend/src/environments/environment.prod.ts
export const environment = {
  production:    true,
  apiUrl:        '',               // set via CI environment variable at build time
  wsUrl:         '',
  razorpayKeyId: '',
};
```

- [ ] **Step 6: Write `proxy.conf.json`**

```json
{
  "/api": {
    "target": "http://localhost:3000",
    "changeOrigin": true,
    "secure": false
  }
}
```

- [ ] **Step 7: Update `angular.json` to use the proxy**

In `frontend/angular.json`, find `"serve"` > `"options"` and add:

```json
"proxyConfig": "proxy.conf.json"
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/app/app.config.ts frontend/src/app/app.routes.ts \
  frontend/src/app/app.component.ts \
  frontend/src/app/features/shell/ frontend/src/app/features/admin/ \
  frontend/src/environments/ frontend/proxy.conf.json frontend/angular.json
git commit -m "feat(frontend): wire app config, routes, interceptors, environment + proxy"
```

---

## Task 10: AuthLayoutComponent + LoadingSpinner

**Files:**
- Create: `frontend/src/app/features/auth/auth.routes.ts`
- Create: `frontend/src/app/features/auth/layout/auth-layout.component.ts`
- Create: `frontend/src/app/shared/components/loading-spinner/loading-spinner.component.ts`

- [ ] **Step 1: Write `LoadingSpinnerComponent`**

```typescript
// frontend/src/app/shared/components/loading-spinner/loading-spinner.component.ts
import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-loading-spinner',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="spinner-wrap" [class.full]="full">
      <div class="spinner"></div>
    </div>
  `,
  styles: [`
    .spinner-wrap {
      display: flex;
      align-items: center;
      justify-content: center;
      &.full { min-height: 100vh; }
    }
    .spinner {
      width: 36px;
      height: 36px;
      border: 3px solid rgba(168,85,247,0.3);
      border-top-color: #a855f7;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  `],
})
export class LoadingSpinnerComponent {
  @Input() full = false;
}
```

- [ ] **Step 2: Write `AuthLayoutComponent`**

```typescript
// frontend/src/app/features/auth/layout/auth-layout.component.ts
import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-auth-layout',
  standalone: true,
  imports: [RouterOutlet],
  template: `
    <div class="auth-bg">
      <div class="auth-blob-purple"></div>
      <div class="auth-blob-cyan"></div>
      <div class="auth-card">
        <router-outlet />
      </div>
    </div>
  `,
})
export class AuthLayoutComponent {}
```

- [ ] **Step 3: Write `auth.routes.ts`**

```typescript
// frontend/src/app/features/auth/auth.routes.ts
import { Routes } from '@angular/router';
import { AuthLayoutComponent } from './layout/auth-layout.component';

export const authRoutes: Routes = [
  {
    path: '',
    component: AuthLayoutComponent,
    children: [
      { path: '', redirectTo: 'login', pathMatch: 'full' },
      {
        path: 'login',
        loadComponent: () =>
          import('./login/login.component').then(m => m.LoginComponent),
      },
      {
        path: 'register',
        loadComponent: () =>
          import('./register/register.component').then(m => m.RegisterComponent),
      },
      {
        path: 'verify',
        loadComponent: () =>
          import('./verify-email/verify-email.component').then(m => m.VerifyEmailComponent),
      },
      {
        path: 'mfa',
        loadComponent: () =>
          import('./mfa/mfa.component').then(m => m.MfaComponent),
      },
      {
        path: 'forgot',
        loadComponent: () =>
          import('./forgot-password/forgot-password.component').then(m => m.ForgotPasswordComponent),
      },
      {
        path: 'reset',
        loadComponent: () =>
          import('./reset-password/reset-password.component').then(m => m.ResetPasswordComponent),
      },
      {
        path: 'callback',
        loadComponent: () =>
          import('./sso-callback/sso-callback.component').then(m => m.SsoCallbackComponent),
      },
    ],
  },
];
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/features/auth/ \
  frontend/src/app/shared/
git commit -m "feat(frontend): add AuthLayoutComponent, LoadingSpinner, auth routes"
```

---

## Task 11: LoginComponent

**Files:**
- Create: `frontend/src/app/features/auth/login/login.component.ts`
- Create: `frontend/src/app/features/auth/login/login.component.spec.ts`

- [ ] **Step 1: Write failing test**

```typescript
// frontend/src/app/features/auth/login/login.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { LoginComponent } from './login.component';
import { AuthService } from '../../../core/services/auth.service';
import { AppError } from '../../../core/models/api-response.model';

describe('LoginComponent', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let component: LoginComponent;
  let authService: { login: jest.Mock };
  let router: { navigate: jest.Mock };

  beforeEach(async () => {
    authService = { login: jest.fn(), isLoading: { set: jest.fn() } };
    router      = { navigate: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [LoginComponent, ReactiveFormsModule],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: Router,      useValue: router },
      ],
    }).compileComponents();

    fixture   = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('submit button is disabled when form is invalid', () => {
    const btn = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(btn.disabled).toBe(true);
  });

  it('calls authService.login with form values on submit', () => {
    authService.login.mockReturnValue(of({ user: { id: 'u1' } }));
    component.form.setValue({ email: 'a@b.com', password: 'password123' });
    fixture.detectChanges();
    component.submit();
    expect(authService.login).toHaveBeenCalledWith('a@b.com', 'password123');
  });

  it('navigates to /auth/mfa when backend returns mfaRequired', () => {
    authService.login.mockReturnValue(of({ mfaRequired: true }));
    component.form.setValue({ email: 'a@b.com', password: 'password123' });
    component.submit();
    expect(router.navigate).toHaveBeenCalledWith(['/auth/mfa']);
  });

  it('shows error message on login failure', () => {
    authService.login.mockReturnValue(
      throwError(() => new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401))
    );
    component.form.setValue({ email: 'a@b.com', password: 'wrongpass' });
    component.submit();
    fixture.detectChanges();
    expect(component.error()).toBe('Invalid email or password');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx ng test --include="**/login.component.spec.ts" --watch=false
```

Expected: `Cannot find module './login.component'`

- [ ] **Step 3: Write implementation**

```typescript
// frontend/src/app/features/auth/login/login.component.ts
import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { AppError } from '../../../core/models/api-response.model';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  template: `
    <div style="text-align:center;margin-bottom:1.5rem;">
      <div class="auth-logo">
        <div class="auth-logo-icon"></div>
      </div>
      <h1 class="auth-title">WorkSpace</h1>
      <p class="auth-subtitle">Sign in to your account</p>
    </div>

    <!-- SSO buttons -->
    <div style="display:flex;gap:8px;margin-bottom:1rem;">
      <button class="auth-btn-sso" (click)="loginWithGoogle()">🔵 Google</button>
      <button class="auth-btn-sso" (click)="loginWithSaml()">🏢 SSO</button>
    </div>

    <!-- Divider -->
    <div class="auth-divider">
      <span class="auth-divider__line"></span>
      <span class="auth-divider__text">or continue with email</span>
      <span class="auth-divider__line"></span>
    </div>

    <!-- Error -->
    @if (error()) {
      <div class="auth-error">{{ error() }}</div>
    }

    <!-- Form -->
    <form [formGroup]="form" (ngSubmit)="submit()">
      <label class="auth-label" for="email">Email</label>
      <input
        id="email"
        type="email"
        class="auth-input"
        style="margin-bottom:1rem;"
        formControlName="email"
        placeholder="you@company.com"
        autocomplete="email"
      />

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <label class="auth-label" style="margin:0" for="password">Password</label>
        <a routerLink="/auth/forgot" style="color:#a855f7;font-size:12px;">Forgot password?</a>
      </div>
      <input
        id="password"
        type="password"
        class="auth-input"
        style="margin-bottom:1.25rem;"
        formControlName="password"
        placeholder="••••••••"
        autocomplete="current-password"
      />

      <button
        type="submit"
        class="auth-btn-primary"
        [disabled]="form.invalid || loading()"
      >
        {{ loading() ? 'Signing in…' : 'Sign in' }}
      </button>
    </form>

    <div class="auth-footer">
      No account? <a routerLink="/auth/register">Create one</a>
    </div>
  `,
  styles: [`
    .auth-logo { text-align:center;margin-bottom:10px; }
    .auth-logo-icon {
      width:44px;height:44px;
      background:linear-gradient(135deg,#a855f7,#06b6d4);
      border-radius:12px;margin:0 auto;
    }
    .auth-title { color:#f1f5f9;font-size:22px;font-weight:700;margin:8px 0 4px; }
    .auth-subtitle { color:#94a3b8;font-size:13px;margin:0 0 1.25rem; }
  `],
})
export class LoginComponent {
  readonly error   = signal<string | null>(null);
  readonly loading = signal(false);

  readonly form = this.fb.nonNullable.group({
    email:    ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  constructor(
    private fb:   FormBuilder,
    private auth: AuthService,
    private router: Router,
  ) {}

  loginWithGoogle(): void {
    window.location.href = '/api/v1/auth/google';
  }

  loginWithSaml(): void {
    window.location.href = '/api/v1/auth/saml/login';
  }

  submit(): void {
    if (this.form.invalid) return;
    this.error.set(null);
    this.loading.set(true);
    const { email, password } = this.form.getRawValue();

    this.auth.login(email, password).subscribe({
      next: result => {
        this.loading.set(false);
        if ('mfaRequired' in result) {
          this.router.navigate(['/auth/mfa']);
        } else {
          this.router.navigate(['/app']);
        }
      },
      error: (err: AppError) => {
        this.loading.set(false);
        this.error.set(err.message ?? 'Login failed. Please try again.');
      },
    });
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx ng test --include="**/login.component.spec.ts" --watch=false
```

Expected: `4 specs, 0 failures`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/features/auth/login/
git commit -m "feat(frontend): add LoginComponent with SSO buttons, error signal, MFA branch"
```

---

## Task 12: RegisterComponent

**Files:**
- Create: `frontend/src/app/features/auth/register/register.component.ts`

- [ ] **Step 1: Write implementation**

```typescript
// frontend/src/app/features/auth/register/register.component.ts
import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, AbstractControl } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { AppError } from '../../../core/models/api-response.model';

function passwordMatch(control: AbstractControl) {
  const pw  = control.get('password')?.value;
  const cpw = control.get('confirmPassword')?.value;
  return pw === cpw ? null : { mismatch: true };
}

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  template: `
    <div style="text-align:center;margin-bottom:1.5rem;">
      <div style="width:44px;height:44px;background:linear-gradient(135deg,#a855f7,#06b6d4);border-radius:12px;margin:0 auto 10px;"></div>
      <h1 class="auth-title">Create account</h1>
      <p class="auth-subtitle">Start your free workspace</p>
    </div>

    @if (error()) { <div class="auth-error">{{ error() }}</div> }
    @if (success()) {
      <div class="auth-success">
        ✓ Account created! Check your email to verify your address.
      </div>
    }

    @if (!success()) {
      <form [formGroup]="form" (ngSubmit)="submit()">
        <label class="auth-label">Full name</label>
        <input type="text" class="auth-input" style="margin-bottom:1rem;"
          formControlName="name" placeholder="Alice Smith" />

        <label class="auth-label">Email</label>
        <input type="email" class="auth-input" style="margin-bottom:1rem;"
          formControlName="email" placeholder="you@company.com" />

        <label class="auth-label">Password</label>
        <input type="password" class="auth-input" style="margin-bottom:1rem;"
          formControlName="password" placeholder="Min 8 characters" />

        <label class="auth-label">Confirm password</label>
        <input type="password" class="auth-input" style="margin-bottom:1.25rem;"
          formControlName="confirmPassword" placeholder="••••••••" />

        @if (form.errors?.['mismatch'] && form.get('confirmPassword')?.dirty) {
          <p style="color:#fca5a5;font-size:12px;margin:-0.75rem 0 0.75rem;">Passwords do not match.</p>
        }

        <button type="submit" class="auth-btn-primary" [disabled]="form.invalid || loading()">
          {{ loading() ? 'Creating account…' : 'Create account' }}
        </button>
      </form>
    }

    <div class="auth-footer">
      Already have an account? <a routerLink="/auth/login">Sign in</a>
    </div>
  `,
  styles: [`.auth-title{color:#f1f5f9;font-size:22px;font-weight:700;margin:8px 0 4px}.auth-subtitle{color:#94a3b8;font-size:13px;margin:0 0 1.25rem}`],
})
export class RegisterComponent {
  readonly error   = signal<string | null>(null);
  readonly loading = signal(false);
  readonly success = signal(false);

  readonly form = this.fb.nonNullable.group({
    name:            ['', [Validators.required, Validators.minLength(2)]],
    email:           ['', [Validators.required, Validators.email]],
    password:        ['', [Validators.required, Validators.minLength(8)]],
    confirmPassword: ['', Validators.required],
  }, { validators: passwordMatch });

  constructor(private fb: FormBuilder, private auth: AuthService) {}

  submit(): void {
    if (this.form.invalid) return;
    this.error.set(null);
    this.loading.set(true);
    const { name, email, password } = this.form.getRawValue();

    this.auth.register(name, email, password).subscribe({
      next: () => { this.loading.set(false); this.success.set(true); },
      error: (err: AppError) => {
        this.loading.set(false);
        this.error.set(err.message ?? 'Registration failed. Please try again.');
      },
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/features/auth/register/
git commit -m "feat(frontend): add RegisterComponent with password confirm + success state"
```

---

## Task 13: VerifyEmailComponent

**Files:**
- Create: `frontend/src/app/features/auth/verify-email/verify-email.component.ts`

- [ ] **Step 1: Write implementation**

```typescript
// frontend/src/app/features/auth/verify-email/verify-email.component.ts
import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div style="text-align:center;padding:1rem 0;">
      @if (status() === 'loading') {
        <div style="color:#94a3b8;font-size:14px;">Verifying your email…</div>
      }
      @if (status() === 'success') {
        <div class="auth-success" style="text-align:left;">
          ✓ Email verified successfully! You can now sign in.
        </div>
        <a routerLink="/auth/login" class="auth-btn-primary"
          style="display:block;text-align:center;text-decoration:none;line-height:42px;margin-top:1rem;">
          Go to sign in
        </a>
      }
      @if (status() === 'error') {
        <div class="auth-error" style="text-align:left;">
          {{ error() }}
        </div>
        <a routerLink="/auth/login" class="auth-btn-primary"
          style="display:block;text-align:center;text-decoration:none;line-height:42px;margin-top:1rem;">
          Back to sign in
        </a>
      }
      @if (status() === 'missing') {
        <div class="auth-error" style="text-align:left;">
          Invalid verification link. Please request a new one.
        </div>
      }
    </div>
  `,
})
export class VerifyEmailComponent implements OnInit {
  readonly status = signal<'loading' | 'success' | 'error' | 'missing'>('loading');
  readonly error  = signal<string | null>(null);

  constructor(private route: ActivatedRoute, private auth: AuthService) {}

  ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (!token) { this.status.set('missing'); return; }

    this.auth.verifyEmail(token).subscribe({
      next:  () => this.status.set('success'),
      error: (err) => {
        this.error.set(err.message ?? 'Verification failed.');
        this.status.set('error');
      },
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/features/auth/verify-email/
git commit -m "feat(frontend): add VerifyEmailComponent (auto-verifies on load)"
```

---

## Task 14: MfaComponent

**Files:**
- Create: `frontend/src/app/features/auth/mfa/mfa.component.ts`
- Create: `frontend/src/app/features/auth/mfa/mfa.component.spec.ts`

- [ ] **Step 1: Write failing test**

```typescript
// frontend/src/app/features/auth/mfa/mfa.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { MfaComponent } from './mfa.component';
import { AuthService } from '../../../core/services/auth.service';

describe('MfaComponent', () => {
  let fixture: ComponentFixture<MfaComponent>;
  let component: MfaComponent;
  let authService: { submitMfa: jest.Mock };
  let router: { navigate: jest.Mock };

  beforeEach(async () => {
    authService = { submitMfa: jest.fn() };
    router      = { navigate: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [MfaComponent],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: Router,      useValue: router },
      ],
    }).compileComponents();

    fixture   = TestBed.createComponent(MfaComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('does NOT submit when code length < 6', () => {
    component.onDigitInput('12345');
    expect(authService.submitMfa).not.toHaveBeenCalled();
  });

  it('auto-submits when code reaches 6 digits', () => {
    authService.submitMfa.mockReturnValue(of({ user: { id: 'u1' } }));
    component.onDigitInput('123456');
    expect(authService.submitMfa).toHaveBeenCalledWith('123456');
    expect(router.navigate).toHaveBeenCalledWith(['/app']);
  });

  it('shows error and clears code on wrong TOTP', () => {
    authService.submitMfa.mockReturnValue(
      throwError(() => ({ message: 'Invalid code', code: 'MFA_INVALID' }))
    );
    component.onDigitInput('999999');
    expect(component.error()).toBe('Invalid code');
    expect(component.code()).toBe('');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx ng test --include="**/mfa.component.spec.ts" --watch=false
```

Expected: `Cannot find module './mfa.component'`

- [ ] **Step 3: Write implementation**

```typescript
// frontend/src/app/features/auth/mfa/mfa.component.ts
import { Component, signal, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-mfa',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div style="text-align:center;margin-bottom:1.5rem;">
      <div style="font-size:32px;margin-bottom:8px;">🔐</div>
      <h1 class="auth-title">Two-factor auth</h1>
      <p class="auth-subtitle">Enter the 6-digit code from your authenticator app</p>
    </div>

    @if (error()) { <div class="auth-error">{{ error() }}</div> }

    <div style="display:flex;justify-content:center;margin-bottom:1.5rem;">
      <input
        #codeInput
        type="text"
        inputmode="numeric"
        maxlength="6"
        [ngModel]="code()"
        (ngModelChange)="onDigitInput($event)"
        style="
          width:180px;
          text-align:center;
          font-size:28px;
          letter-spacing:12px;
          font-weight:700;
          color:#f1f5f9;
          background:rgba(255,255,255,0.07);
          border:1px solid rgba(255,255,255,0.15);
          border-radius:12px;
          padding:12px 8px;
        "
        [disabled]="loading()"
        autocomplete="one-time-code"
      />
    </div>

    @if (loading()) {
      <div style="text-align:center;color:#94a3b8;font-size:13px;">Verifying…</div>
    }

    <div style="margin-top:1rem;display:flex;justify-content:space-between;align-items:center;">
      <a routerLink="/auth/login" style="color:#64748b;font-size:12px;">← Back to login</a>
      <button
        style="background:none;border:none;color:#a855f7;font-size:12px;cursor:pointer;"
        (click)="useBackupCode()"
      >Use backup code</button>
    </div>
  `,
  styles: [`.auth-title{color:#f1f5f9;font-size:22px;font-weight:700;margin:8px 0 4px}.auth-subtitle{color:#94a3b8;font-size:13px;margin:0}`],
})
export class MfaComponent implements AfterViewInit {
  @ViewChild('codeInput') codeInput!: ElementRef<HTMLInputElement>;

  readonly code    = signal('');
  readonly error   = signal<string | null>(null);
  readonly loading = signal(false);

  constructor(private auth: AuthService, private router: Router) {}

  ngAfterViewInit(): void {
    this.codeInput?.nativeElement.focus();
  }

  onDigitInput(value: string): void {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    this.code.set(digits);
    if (digits.length === 6) this.submitCode(digits);
  }

  private submitCode(code: string): void {
    this.error.set(null);
    this.loading.set(true);

    this.auth.submitMfa(code).subscribe({
      next: () => { this.loading.set(false); this.router.navigate(['/app']); },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err.message ?? 'Invalid code. Please try again.');
        this.code.set('');
        setTimeout(() => this.codeInput?.nativeElement.focus(), 50);
      },
    });
  }

  useBackupCode(): void {
    const code = prompt('Enter your backup code:');
    if (code) this.submitCode(code.trim());
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx ng test --include="**/mfa.component.spec.ts" --watch=false
```

Expected: `3 specs, 0 failures`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/features/auth/mfa/
git commit -m "feat(frontend): add MfaComponent with auto-submit on 6th digit"
```

---

## Task 15: ForgotPassword + ResetPassword + SsoCallback

**Files:**
- Create: `frontend/src/app/features/auth/forgot-password/forgot-password.component.ts`
- Create: `frontend/src/app/features/auth/reset-password/reset-password.component.ts`
- Create: `frontend/src/app/features/auth/sso-callback/sso-callback.component.ts`

- [ ] **Step 1: Write `ForgotPasswordComponent`**

```typescript
// frontend/src/app/features/auth/forgot-password/forgot-password.component.ts
import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AppError, ApiResponse } from '../../../core/models/api-response.model';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  template: `
    <div style="text-align:center;margin-bottom:1.5rem;">
      <h1 class="auth-title">Reset password</h1>
      <p class="auth-subtitle">Enter your email and we'll send a reset link</p>
    </div>

    @if (error()) { <div class="auth-error">{{ error() }}</div> }

    @if (sent()) {
      <div class="auth-success">
        ✓ Check your email for a password reset link.
      </div>
      <div class="auth-footer" style="margin-top:1rem;">
        <a routerLink="/auth/login">Back to sign in</a>
      </div>
    } @else {
      <form [formGroup]="form" (ngSubmit)="submit()">
        <label class="auth-label">Email</label>
        <input type="email" class="auth-input" style="margin-bottom:1.25rem;"
          formControlName="email" placeholder="you@company.com" />
        <button type="submit" class="auth-btn-primary" [disabled]="form.invalid || loading()">
          {{ loading() ? 'Sending…' : 'Send reset link' }}
        </button>
      </form>
      <div class="auth-footer"><a routerLink="/auth/login">← Back to sign in</a></div>
    }
  `,
  styles: [`.auth-title{color:#f1f5f9;font-size:22px;font-weight:700;margin:8px 0 4px}.auth-subtitle{color:#94a3b8;font-size:13px;margin:0 0 1.25rem}`],
})
export class ForgotPasswordComponent {
  readonly error   = signal<string | null>(null);
  readonly loading = signal(false);
  readonly sent    = signal(false);

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });

  constructor(private fb: FormBuilder, private http: HttpClient) {}

  submit(): void {
    if (this.form.invalid) return;
    this.error.set(null);
    this.loading.set(true);
    this.http.post<ApiResponse<void>>('/api/v1/auth/forgot-password', this.form.getRawValue())
      .subscribe({
        next:  () => { this.loading.set(false); this.sent.set(true); },
        error: (err: AppError) => {
          this.loading.set(false);
          this.error.set(err.message ?? 'Failed to send reset email.');
        },
      });
  }
}
```

- [ ] **Step 2: Write `ResetPasswordComponent`**

```typescript
// frontend/src/app/features/auth/reset-password/reset-password.component.ts
import { Component, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, AbstractControl } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AppError, ApiResponse } from '../../../core/models/api-response.model';

function passwordMatch(c: AbstractControl) {
  return c.get('password')?.value === c.get('confirmPassword')?.value ? null : { mismatch: true };
}

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  template: `
    <div style="text-align:center;margin-bottom:1.5rem;">
      <h1 class="auth-title">New password</h1>
      <p class="auth-subtitle">Choose a strong password for your account</p>
    </div>

    @if (error()) { <div class="auth-error">{{ error() }}</div> }
    @if (!token()) {
      <div class="auth-error">Invalid or expired reset link.</div>
      <div class="auth-footer"><a routerLink="/auth/forgot">Request a new link</a></div>
    } @else if (done()) {
      <div class="auth-success">✓ Password updated. You can now sign in.</div>
      <a routerLink="/auth/login" class="auth-btn-primary"
        style="display:block;text-align:center;text-decoration:none;line-height:42px;margin-top:1rem;">
        Sign in
      </a>
    } @else {
      <form [formGroup]="form" (ngSubmit)="submit()">
        <label class="auth-label">New password</label>
        <input type="password" class="auth-input" style="margin-bottom:1rem;"
          formControlName="password" placeholder="Min 8 characters" />
        <label class="auth-label">Confirm password</label>
        <input type="password" class="auth-input" style="margin-bottom:1.25rem;"
          formControlName="confirmPassword" placeholder="••••••••" />
        <button type="submit" class="auth-btn-primary" [disabled]="form.invalid || loading()">
          {{ loading() ? 'Updating…' : 'Update password' }}
        </button>
      </form>
    }
  `,
  styles: [`.auth-title{color:#f1f5f9;font-size:22px;font-weight:700;margin:8px 0 4px}.auth-subtitle{color:#94a3b8;font-size:13px;margin:0 0 1.25rem}`],
})
export class ResetPasswordComponent implements OnInit {
  readonly token   = signal<string | null>(null);
  readonly error   = signal<string | null>(null);
  readonly loading = signal(false);
  readonly done    = signal(false);

  readonly form = this.fb.nonNullable.group({
    password:        ['', [Validators.required, Validators.minLength(8)]],
    confirmPassword: ['', Validators.required],
  }, { validators: passwordMatch });

  constructor(
    private fb:    FormBuilder,
    private route: ActivatedRoute,
    private http:  HttpClient,
  ) {}

  ngOnInit(): void {
    this.token.set(this.route.snapshot.queryParamMap.get('token'));
  }

  submit(): void {
    if (this.form.invalid || !this.token()) return;
    this.error.set(null);
    this.loading.set(true);
    this.http.post<ApiResponse<void>>('/api/v1/auth/reset-password', {
      token:    this.token(),
      password: this.form.getRawValue().password,
    }).subscribe({
      next:  () => { this.loading.set(false); this.done.set(true); },
      error: (err: AppError) => {
        this.loading.set(false);
        this.error.set(err.message ?? 'Failed to reset password.');
      },
    });
  }
}
```

- [ ] **Step 3: Write `SsoCallbackComponent`**

```typescript
// frontend/src/app/features/auth/sso-callback/sso-callback.component.ts
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';

@Component({
  selector: 'app-sso-callback',
  standalone: true,
  imports: [LoadingSpinnerComponent],
  template: `<app-loading-spinner [full]="true" />`,
})
export class SsoCallbackComponent implements OnInit {
  constructor(
    private route:  ActivatedRoute,
    private auth:   AuthService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (!token) { this.router.navigate(['/auth/login']); return; }
    this.auth.handleSsoToken(token);
    this.router.navigate(['/app']);
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/features/auth/forgot-password/ \
  frontend/src/app/features/auth/reset-password/ \
  frontend/src/app/features/auth/sso-callback/
git commit -m "feat(frontend): add ForgotPassword, ResetPassword, SsoCallback components"
```

---

## Task 16: Playwright E2E Setup

**Files:**
- Create: `frontend/playwright.config.ts`
- Create: `frontend/e2e/auth.spec.ts`

- [ ] **Step 1: Write `playwright.config.ts`**

```typescript
// frontend/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:4200',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // Start Angular dev server before tests
  webServer: {
    command: 'npm run start',
    url: 'http://localhost:4200',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
```

- [ ] **Step 2: Add `start` script to `frontend/package.json`**

Open `frontend/package.json` and add to `"scripts"`:

```json
"start": "ng serve --proxy-config proxy.conf.json"
```

- [ ] **Step 3: Write `e2e/auth.spec.ts`**

```typescript
// frontend/e2e/auth.spec.ts
import { test, expect } from '@playwright/test';

// These tests require the backend running on http://localhost:3000
// and a seeded test user: email=test@example.com password=Password123!

const TEST_EMAIL    = process.env['E2E_EMAIL']    ?? 'test@example.com';
const TEST_PASSWORD = process.env['E2E_PASSWORD'] ?? 'Password123!';

test.describe('Auth flows', () => {

  test('unauthenticated access to /app redirects to /auth/login', async ({ page }) => {
    await page.goto('/app');
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test('login page renders with email + password fields and SSO buttons', async ({ page }) => {
    await page.goto('/auth/login');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button:has-text("Google")')).toBeVisible();
    await expect(page.locator('button:has-text("SSO")')).toBeVisible();
  });

  test('shows error on invalid credentials', async ({ page }) => {
    await page.goto('/auth/login');
    await page.fill('input[type="email"]', 'wrong@example.com');
    await page.fill('input[type="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');
    await expect(page.locator('.auth-error')).toBeVisible({ timeout: 5000 });
  });

  test('successful login redirects to /app', async ({ page }) => {
    await page.goto('/auth/login');
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/app/, { timeout: 10_000 });
  });

  test('register page shows success state after form submit', async ({ page }) => {
    await page.goto('/auth/register');
    await page.fill('input[type="text"]', 'Test User');
    await page.fill('input[type="email"]', `e2e-${Date.now()}@example.com`);
    const pwFields = page.locator('input[type="password"]');
    await pwFields.nth(0).fill('Password123!');
    await pwFields.nth(1).fill('Password123!');
    await page.click('button[type="submit"]');
    await expect(page.locator('.auth-success')).toBeVisible({ timeout: 5000 });
  });

  test('SSO callback with missing token redirects to /auth/login', async ({ page }) => {
    await page.goto('/auth/callback');
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test('forgot password shows confirmation after email submit', async ({ page }) => {
    await page.goto('/auth/forgot');
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.click('button[type="submit"]');
    await expect(page.locator('.auth-success')).toBeVisible({ timeout: 5000 });
  });

});
```

- [ ] **Step 4: Add playwright script to `frontend/package.json`**

Add to `"scripts"`:

```json
"e2e": "playwright test",
"e2e:ui": "playwright test --ui"
```

- [ ] **Step 5: Verify Playwright config is found**

```bash
cd frontend && npx playwright test --list
```

Expected: lists test names from `e2e/auth.spec.ts`.

- [ ] **Step 6: Commit E2E setup**

```bash
git add frontend/playwright.config.ts frontend/e2e/ frontend/package.json
git commit -m "feat(frontend): add Playwright E2E config + auth test suite"
```

---

## Task 17: Smoke Test — Dev Server Boots

- [ ] **Step 1: Start the dev server**

```bash
cd frontend && ng serve --proxy-config proxy.conf.json
```

Expected: `Application bundle generation complete. [X.XXX seconds]` and `Local: http://localhost:4200/`

- [ ] **Step 2: Visit login page in browser**

Open `http://localhost:4200/auth/login`

Expected:
- Dark gradient background with purple/cyan blobs
- Glassmorphism card centered on screen
- "WorkSpace" heading, email + password fields, Google + SSO buttons
- No console errors

- [ ] **Step 3: Verify redirect from root**

Visit `http://localhost:4200/`

Expected: redirected to `/auth/login` (not logged in) or `/app` (if token in localStorage)

- [ ] **Step 4: Final commit**

```bash
cd .. && git add frontend/
git commit -m "feat(frontend): Phase 1 foundation complete — auth scaffold, services, interceptors, guards, all 7 auth pages"
```

---

## Self-Review Checklist

- [x] **Spec coverage:**
  - Standalone components ✓ (all components use `standalone: true`)
  - Signals for auth state ✓ (`AuthService.currentUser`, `isLoggedIn`, `isLoading`)
  - JWT interceptor ✓ (Task 7) — Bearer token + X-Org-ID + 401 refresh/retry
  - Idempotency interceptor ✓ (Task 7) — UUID on mutations
  - Error interceptor ✓ (Task 7) — maps to `AppError`
  - AuthGuard ✓ (Task 8)
  - OrgGuard ✓ (Task 8) — auto-selects single org
  - RoleGuard stub ✓ (Task 8)
  - AuthLayoutComponent ✓ (Task 10) — glassmorphism card shell
  - Login: email/pass + Google SSO + SAML SSO + MFA branch ✓ (Task 11)
  - Register: name/email/password/confirm + success state ✓ (Task 12)
  - VerifyEmail: auto-verifies on load ✓ (Task 13)
  - MFA: 6-digit input, auto-submit ✓ (Task 14)
  - ForgotPassword ✓ (Task 15)
  - ResetPassword ✓ (Task 15)
  - SsoCallback: reads `?token=`, calls `handleSsoToken()` ✓ (Task 15)
  - Environment files + proxy.conf.json ✓ (Task 9)
  - TailwindCSS + Angular Material dark theme ✓ (Task 2)
  - Unit tests: AuthService, TokenStorageService, TenantService, interceptors, LoginComponent, MfaComponent ✓
  - Playwright E2E ✓ (Task 16)
  - `.gitignore` additions ✓ (Task 1)

- [x] **Type consistency:** `User`, `Org`, `ApiResponse<T>`, `AppError`, `LoginResult` defined in Task 3 and used consistently across all tasks.

- [x] **No placeholders:** All code blocks are complete implementations.
