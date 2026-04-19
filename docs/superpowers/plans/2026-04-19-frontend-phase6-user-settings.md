# Frontend Phase 6 — User Profile & Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-featured settings area at `/app/settings` — profile editing (name, bio, avatar), account security (password, MFA, active sessions), and app preferences (timezone, locale, theme, date format).

**Architecture:** Flat components + `UserService` pattern consistent with existing codebase. `ThemeService` applies theme to DOM immediately from localStorage, then syncs to backend via debounce. `SettingsComponent` provides a 200px left sidebar nav with child `<router-outlet>`. All tab components are TDD.

**Tech Stack:** Angular 17+ standalone components, Angular Signals, Angular Material (Dialog, FormField, Input, Select, Button), TailwindCSS, Jest (unit), existing `HttpClient` + `AuthService` patterns.

---

## File Map

**New files:**
- `src/app/core/models/user.model.ts` — extend with `bio`, `avatarUrl`, `preferences`, `UserDto`, `toUser()`, `defaultPreferences()`; add `Session`, `MfaStatus` interfaces
- `src/app/core/services/user.service.ts` — profile/password/MFA/sessions/preferences HTTP methods
- `src/app/core/services/user.service.spec.ts`
- `src/app/core/services/theme.service.ts` — DOM theme apply, localStorage, debounced backend sync
- `src/app/core/services/theme.service.spec.ts`
- `src/app/features/settings/settings.component.ts` — left-nav shell with router-outlet
- `src/app/features/settings/settings.routes.ts` — profile/security/preferences/notifications children
- `src/app/features/settings/profile/profile-tab.component.ts`
- `src/app/features/settings/profile/profile-tab.component.spec.ts`
- `src/app/features/settings/security/security-tab.component.ts`
- `src/app/features/settings/security/security-tab.component.spec.ts`
- `src/app/features/settings/preferences/preferences-tab.component.ts`
- `src/app/features/settings/preferences/preferences-tab.component.spec.ts`

**Modified files:**
- `src/app/core/models/user.model.ts` — replace
- `src/app/core/services/auth.service.ts` — add `updateCurrentUser()`, fix `handleSsoToken` defaults
- `src/app/features/shell/shell.component.ts` — inject `ThemeService`, call `applyStored()` in `ngOnInit`
- `src/app/features/shell/components/sidebar/sidebar.component.ts` — add Settings nav link
- `src/app/features/shell/shell.routes.ts` — replace flat `settings/notifications` with lazy `settings` children
- `src/styles.scss` — add `[data-theme="light"]` CSS overrides

---

## Task 1: Extend User model + AuthService patch

**Files:**
- Modify: `src/app/core/models/user.model.ts`
- Modify: `src/app/core/services/auth.service.ts`

- [ ] **Step 1: Replace user.model.ts**

Replace the entire contents of `src/app/core/models/user.model.ts`:

```typescript
// src/app/core/models/user.model.ts

export interface UserPreferences {
  timezone:   string;
  locale:     string;
  theme:      'dark' | 'light' | 'system';
  dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
}

export interface User {
  id:            string;
  email:         string;
  name:          string;
  bio:           string | null;
  avatarUrl:     string | null;
  emailVerified: boolean;
  mfaEnabled:    boolean;
  role:          'member' | 'admin' | 'platform_admin';
  preferences:   UserPreferences;
  createdAt:     string;
}

export interface UserDto {
  id:             string;
  email:          string;
  name:           string;
  bio:            string | null;
  avatar_url:     string | null;
  email_verified: boolean;
  mfa_enabled:    boolean;
  role:           'member' | 'admin' | 'platform_admin';
  preferences:    UserPreferences | null;
  created_at:     string;
}

export interface Session {
  id:         string;
  deviceInfo: string;
  ipAddress:  string;
  lastActive: string;
  isCurrent:  boolean;
}

export interface MfaStatus {
  enabled:              boolean;
  backupCodesRemaining: number;
}

export function defaultPreferences(): UserPreferences {
  return { timezone: 'UTC', locale: 'en-US', theme: 'dark', dateFormat: 'DD/MM/YYYY' };
}

export function toUser(dto: UserDto): User {
  return {
    id:            dto.id,
    email:         dto.email,
    name:          dto.name,
    bio:           dto.bio,
    avatarUrl:     dto.avatar_url,
    emailVerified: dto.email_verified,
    mfaEnabled:    dto.mfa_enabled,
    role:          dto.role,
    preferences:   dto.preferences ?? defaultPreferences(),
    createdAt:     dto.created_at,
  };
}
```

- [ ] **Step 2: Add updateCurrentUser() to AuthService and fix handleSsoToken**

Open `src/app/core/services/auth.service.ts`. Make two changes:

**Change 1** — add `updateCurrentUser()` method at the end of the class (before the closing `}`):

```typescript
  /** Called by UserService after profile/preferences mutations. */
  updateCurrentUser(user: User): void {
    this.currentUserSignal.set(user);
  }
```

**Change 2** — in `handleSsoToken()`, update the object passed to `this.currentUserSignal.set(...)` to include the new fields:

```typescript
  handleSsoToken(token: string): void {
    const payload = JSON.parse(atob(token.split('.')[1]));
    this.storage.setAccessToken(token);
    if (payload.refreshToken) this.storage.setRefreshToken(payload.refreshToken);
    this.currentUserSignal.set({
      id:            payload.sub,
      email:         payload.email,
      name:          payload.name ?? payload.email,
      bio:           null,
      avatarUrl:     null,
      emailVerified: true,
      mfaEnabled:    payload.mfaEnabled ?? false,
      role:          payload.role ?? 'member',
      preferences:   defaultPreferences(),
      createdAt:     payload.iat ? new Date(payload.iat * 1000).toISOString() : '',
    });
  }
```

Add the import at top of auth.service.ts (update existing User import line):

```typescript
import { User, defaultPreferences } from '../models/user.model';
```

- [ ] **Step 3: Run existing auth tests**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="auth.service.spec"
```

Expected: `PASS` — all existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/core/models/user.model.ts src/app/core/services/auth.service.ts
git commit -m "feat(frontend): extend User model with bio/avatar/preferences + AuthService.updateCurrentUser"
```

---

## Task 2: UserService (TDD)

**Files:**
- Create: `src/app/core/services/user.service.spec.ts`
- Create: `src/app/core/services/user.service.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/app/core/services/user.service.spec.ts`:

```typescript
// src/app/core/services/user.service.spec.ts
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { UserService } from './user.service';
import { AuthService } from './auth.service';
import { User, UserDto, MfaStatus, Session, defaultPreferences } from '../models/user.model';

const BASE_USER: User = {
  id: 'u-1', email: 'a@b.com', name: 'Alice', bio: null, avatarUrl: null,
  emailVerified: true, mfaEnabled: false, role: 'member',
  preferences: defaultPreferences(), createdAt: '2024-01-01T00:00:00.000Z',
};

const BASE_DTO: UserDto = {
  id: 'u-1', email: 'a@b.com', name: 'Alice', bio: null, avatar_url: null,
  email_verified: true, mfa_enabled: false, role: 'member',
  preferences: defaultPreferences(), created_at: '2024-01-01T00:00:00.000Z',
};

describe('UserService', () => {
  let service: UserService;
  let ctrl: HttpTestingController;
  let auth: { updateCurrentUser: jest.Mock; currentUser: () => User | null };

  beforeEach(() => {
    auth = { updateCurrentUser: jest.fn(), currentUser: jest.fn().mockReturnValue(BASE_USER) };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: auth },
      ],
    });
    service = TestBed.inject(UserService);
    ctrl    = TestBed.inject(HttpTestingController);
  });

  afterEach(() => ctrl.verify());

  it('updateProfile() PATCHes /api/v1/me and calls updateCurrentUser', fakeAsync(() => {
    service.updateProfile('Bob', 'Hello').subscribe();
    const req = ctrl.expectOne('/api/v1/me');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ name: 'Bob', bio: 'Hello' });
    req.flush({ data: { ...BASE_DTO, name: 'Bob', bio: 'Hello' }, error: null, meta: {} });
    tick();
    expect(auth.updateCurrentUser).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Bob', bio: 'Hello' }),
    );
  }));

  it('uploadAvatar() POSTs FormData to /api/v1/me/avatar', fakeAsync(() => {
    const file = new File(['x'], 'avatar.png', { type: 'image/png' });
    service.uploadAvatar(file).subscribe();
    const req = ctrl.expectOne('/api/v1/me/avatar');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toBeInstanceOf(FormData);
    req.flush({ data: { ...BASE_DTO, avatar_url: 'https://cdn/av.png' }, error: null, meta: {} });
    tick();
    expect(auth.updateCurrentUser).toHaveBeenCalledWith(
      expect.objectContaining({ avatarUrl: 'https://cdn/av.png' }),
    );
  }));

  it('changePassword() PATCHes /api/v1/me/password', fakeAsync(() => {
    let done = false;
    service.changePassword('old', 'new123').subscribe(() => (done = true));
    const req = ctrl.expectOne('/api/v1/me/password');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ currentPassword: 'old', newPassword: 'new123' });
    req.flush({ data: null, error: null, meta: {} });
    tick();
    expect(done).toBe(true);
  }));

  it('getSessions() GETs /api/v1/me/sessions and returns Session[]', fakeAsync(() => {
    const SESSION: Session = { id: 's-1', deviceInfo: 'Chrome', ipAddress: '1.2.3.4', lastActive: '2024-01-01T00:00:00.000Z', isCurrent: true };
    let result: Session[] = [];
    service.getSessions().subscribe(s => (result = s));
    ctrl.expectOne('/api/v1/me/sessions').flush({ data: [SESSION], error: null, meta: {} });
    tick();
    expect(result.length).toBe(1);
    expect(result[0].isCurrent).toBe(true);
  }));

  it('revokeSession() DELETEs /api/v1/me/sessions/:id', fakeAsync(() => {
    let done = false;
    service.revokeSession('s-1').subscribe(() => (done = true));
    const req = ctrl.expectOne('/api/v1/me/sessions/s-1');
    expect(req.request.method).toBe('DELETE');
    req.flush({ data: null, error: null, meta: {} });
    tick();
    expect(done).toBe(true);
  }));

  it('getMfaStatus() GETs /api/v1/me/mfa', fakeAsync(() => {
    const STATUS: MfaStatus = { enabled: false, backupCodesRemaining: 0 };
    let result: MfaStatus | null = null;
    service.getMfaStatus().subscribe(s => (result = s));
    ctrl.expectOne('/api/v1/me/mfa').flush({ data: STATUS, error: null, meta: {} });
    tick();
    expect(result).toEqual(STATUS);
  }));

  it('setupMfa() POSTs /api/v1/me/mfa/setup', fakeAsync(() => {
    let result: { qrCodeUrl: string; secret: string } | null = null;
    service.setupMfa().subscribe(r => (result = r));
    ctrl.expectOne('/api/v1/me/mfa/setup').flush({ data: { qrCodeUrl: 'otpauth://...', secret: 'ABC' }, error: null, meta: {} });
    tick();
    expect(result?.secret).toBe('ABC');
  }));

  it('confirmMfa() POSTs /api/v1/me/mfa/confirm with code', fakeAsync(() => {
    let codes: string[] = [];
    service.confirmMfa('123456').subscribe(r => (codes = r.backupCodes));
    const req = ctrl.expectOne('/api/v1/me/mfa/confirm');
    expect(req.request.body).toEqual({ code: '123456' });
    req.flush({ data: { backupCodes: ['aaa', 'bbb'] }, error: null, meta: {} });
    tick();
    expect(codes).toEqual(['aaa', 'bbb']);
  }));

  it('disableMfa() DELETEs /api/v1/me/mfa with password in body', fakeAsync(() => {
    let done = false;
    service.disableMfa('mypassword').subscribe(() => (done = true));
    const req = ctrl.expectOne('/api/v1/me/mfa');
    expect(req.request.method).toBe('DELETE');
    expect(req.request.body).toEqual({ password: 'mypassword' });
    req.flush({ data: null, error: null, meta: {} });
    tick();
    expect(done).toBe(true);
  }));

  it('regenBackupCodes() POSTs /api/v1/me/mfa/backup-codes', fakeAsync(() => {
    let codes: string[] = [];
    service.regenBackupCodes().subscribe(r => (codes = r.backupCodes));
    ctrl.expectOne('/api/v1/me/mfa/backup-codes')
      .flush({ data: { backupCodes: ['x1', 'x2'] }, error: null, meta: {} });
    tick();
    expect(codes).toEqual(['x1', 'x2']);
  }));

  it('savePreferences() PATCHes /api/v1/me/preferences and updates user signal', fakeAsync(() => {
    service.savePreferences({ theme: 'light' }).subscribe();
    const req = ctrl.expectOne('/api/v1/me/preferences');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ theme: 'light' });
    req.flush({ data: { ...defaultPreferences(), theme: 'light' }, error: null, meta: {} });
    tick();
    expect(auth.updateCurrentUser).toHaveBeenCalledWith(
      expect.objectContaining({ preferences: expect.objectContaining({ theme: 'light' }) }),
    );
  }));
});
```

- [ ] **Step 2: Run tests — expect them to fail**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="user.service.spec"
```

Expected: `FAIL — Cannot find module './user.service'`

- [ ] **Step 3: Implement UserService**

Create `src/app/core/services/user.service.ts`:

```typescript
// src/app/core/services/user.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map, tap } from 'rxjs';
import { User, UserDto, UserPreferences, Session, MfaStatus, toUser } from '../models/user.model';
import { ApiResponse } from '../models/api-response.model';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class UserService {
  constructor(
    private http: HttpClient,
    private auth: AuthService,
  ) {}

  updateProfile(name: string, bio: string | null): Observable<User> {
    return this.http
      .patch<ApiResponse<UserDto>>('/api/v1/me', { name, bio })
      .pipe(map(r => toUser(r.data)), tap(u => this.auth.updateCurrentUser(u)));
  }

  uploadAvatar(file: File): Observable<User> {
    const fd = new FormData();
    fd.append('avatar', file);
    return this.http
      .post<ApiResponse<UserDto>>('/api/v1/me/avatar', fd)
      .pipe(map(r => toUser(r.data)), tap(u => this.auth.updateCurrentUser(u)));
  }

  changePassword(currentPassword: string, newPassword: string): Observable<void> {
    return this.http
      .patch<ApiResponse<null>>('/api/v1/me/password', { currentPassword, newPassword })
      .pipe(map(() => void 0));
  }

  getSessions(): Observable<Session[]> {
    return this.http
      .get<ApiResponse<Session[]>>('/api/v1/me/sessions')
      .pipe(map(r => r.data));
  }

  revokeSession(sessionId: string): Observable<void> {
    return this.http
      .delete<ApiResponse<null>>(`/api/v1/me/sessions/${sessionId}`)
      .pipe(map(() => void 0));
  }

  getMfaStatus(): Observable<MfaStatus> {
    return this.http
      .get<ApiResponse<MfaStatus>>('/api/v1/me/mfa')
      .pipe(map(r => r.data));
  }

  setupMfa(): Observable<{ qrCodeUrl: string; secret: string }> {
    return this.http
      .post<ApiResponse<{ qrCodeUrl: string; secret: string }>>('/api/v1/me/mfa/setup', {})
      .pipe(map(r => r.data));
  }

  confirmMfa(code: string): Observable<{ backupCodes: string[] }> {
    return this.http
      .post<ApiResponse<{ backupCodes: string[] }>>('/api/v1/me/mfa/confirm', { code })
      .pipe(map(r => r.data));
  }

  disableMfa(password: string): Observable<void> {
    return this.http
      .delete<ApiResponse<null>>('/api/v1/me/mfa', { body: { password } })
      .pipe(map(() => void 0));
  }

  regenBackupCodes(): Observable<{ backupCodes: string[] }> {
    return this.http
      .post<ApiResponse<{ backupCodes: string[] }>>('/api/v1/me/mfa/backup-codes', {})
      .pipe(map(r => r.data));
  }

  savePreferences(prefs: Partial<UserPreferences>): Observable<UserPreferences> {
    return this.http
      .patch<ApiResponse<UserPreferences>>('/api/v1/me/preferences', prefs)
      .pipe(
        map(r => r.data),
        tap(updated => {
          const current = this.auth.currentUser();
          if (current) this.auth.updateCurrentUser({ ...current, preferences: updated });
        }),
      );
  }
}
```

- [ ] **Step 4: Run tests — expect them to pass**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="user.service.spec"
```

Expected: `PASS — 11 tests passed`

- [ ] **Step 5: Commit**

```bash
git add src/app/core/services/user.service.ts src/app/core/services/user.service.spec.ts
git commit -m "feat(frontend): UserService — profile/avatar/password/MFA/sessions/preferences (TDD)"
```

---

## Task 3: ThemeService (TDD)

**Files:**
- Create: `src/app/core/services/theme.service.spec.ts`
- Create: `src/app/core/services/theme.service.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/app/core/services/theme.service.spec.ts`:

```typescript
// src/app/core/services/theme.service.spec.ts
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ThemeService } from './theme.service';
import { UserService } from './user.service';

describe('ThemeService', () => {
  let service: ThemeService;
  let userService: { savePreferences: jest.Mock };

  beforeEach(() => {
    userService = { savePreferences: jest.fn().mockReturnValue({ subscribe: jest.fn() }) };
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');

    TestBed.configureTestingModule({
      providers: [{ provide: UserService, useValue: userService }],
    });
    service = TestBed.inject(ThemeService);
  });

  it('theme signal defaults to dark', () => {
    expect(service.theme()).toBe('dark');
  });

  it('applyStored() reads from localStorage', () => {
    localStorage.setItem('theme', 'light');
    service.applyStored();
    expect(service.theme()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('applyStored() defaults to dark when localStorage is empty', () => {
    service.applyStored();
    expect(service.theme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('apply() sets signal, DOM attribute and localStorage', () => {
    service.apply('light');
    expect(service.theme()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('apply("system") resolves to dark or light on DOM based on OS preference', () => {
    service.apply('system');
    expect(service.theme()).toBe('system');
    const attr = document.documentElement.getAttribute('data-theme');
    expect(['dark', 'light']).toContain(attr);
  });

  it('apply() calls userService.savePreferences after 1000ms', fakeAsync(() => {
    service.apply('light');
    expect(userService.savePreferences).not.toHaveBeenCalled();
    tick(1000);
    expect(userService.savePreferences).toHaveBeenCalledWith({ theme: 'light' });
  }));

  it('rapid apply() calls debounce — only last call triggers savePreferences', fakeAsync(() => {
    service.apply('light');
    tick(500);
    service.apply('dark');
    tick(1000);
    expect(userService.savePreferences).toHaveBeenCalledTimes(1);
    expect(userService.savePreferences).toHaveBeenCalledWith({ theme: 'dark' });
  }));
});
```

- [ ] **Step 2: Run tests — expect them to fail**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="theme.service.spec"
```

Expected: `FAIL — Cannot find module './theme.service'`

- [ ] **Step 3: Implement ThemeService**

Create `src/app/core/services/theme.service.ts`:

```typescript
// src/app/core/services/theme.service.ts
import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { UserService } from './user.service';

type Theme = 'dark' | 'light' | 'system';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>('dark');
  private apply$ = new Subject<Theme>();

  constructor(private userService: UserService) {
    this.apply$.pipe(debounceTime(1000)).subscribe(t => {
      this.userService.savePreferences({ theme: t }).subscribe();
    });
  }

  applyStored(): void {
    const stored = (localStorage.getItem('theme') as Theme | null) ?? 'dark';
    this.apply(stored, false);
  }

  apply(theme: Theme, syncBackend = true): void {
    this.theme.set(theme);
    localStorage.setItem('theme', theme);
    const resolved = theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;
    document.documentElement.setAttribute('data-theme', resolved);
    if (syncBackend) this.apply$.next(theme);
  }
}
```

- [ ] **Step 4: Run tests — expect them to pass**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="theme.service.spec"
```

Expected: `PASS — 7 tests passed`

- [ ] **Step 5: Commit**

```bash
git add src/app/core/services/theme.service.ts src/app/core/services/theme.service.spec.ts
git commit -m "feat(frontend): ThemeService — DOM apply, localStorage, debounced backend sync (TDD)"
```

---

## Task 4: Shell integration + light theme CSS

**Files:**
- Modify: `src/app/features/shell/shell.component.ts`
- Modify: `src/app/features/shell/components/sidebar/sidebar.component.ts`
- Modify: `src/app/features/shell/shell.routes.ts`
- Modify: `src/styles.scss`

- [ ] **Step 1: Update ShellComponent to call themeService.applyStored()**

In `src/app/features/shell/shell.component.ts`, add `ThemeService` injection and call in `ngOnInit`:

```typescript
// src/app/features/shell/shell.component.ts
import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SocketService } from '../../core/services/socket.service';
import { WorkspaceService } from '../../core/services/workspace.service';
import { ThemeService } from '../../core/services/theme.service';
import { SidebarComponent } from './components/sidebar/sidebar.component';
import { TopbarComponent } from './components/topbar/topbar.component';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, SidebarComponent, TopbarComponent],
  template: `
    <div class="shell">
      <app-sidebar />
      <app-topbar />
      <main class="main-content">
        <router-outlet />
      </main>
    </div>
  `,
})
export class ShellComponent implements OnInit, OnDestroy {
  private socket = inject(SocketService);
  private ws     = inject(WorkspaceService);
  private theme  = inject(ThemeService);

  ngOnInit(): void {
    this.theme.applyStored();
    this.socket.connect();
    this.ws.load().subscribe();
  }

  ngOnDestroy(): void {
    this.socket.disconnect();
  }
}
```

- [ ] **Step 2: Add Settings nav link to SidebarComponent**

In `src/app/features/shell/components/sidebar/sidebar.component.ts`, add a Settings section after the Workspaces nav section (just before the closing `</nav>` tag):

```html
      <div class="sidebar-section-label" style="margin-top:8px;">Account</div>
      <a class="sidebar-nav-item" routerLink="/app/settings" routerLinkActive="active">
        <span class="nav-icon">⚙</span>
        <span class="nav-label">Settings</span>
      </a>
```

The full updated `<nav>` block in `sidebar.component.ts` should look like:

```html
    <!-- Navigation -->
    <nav class="sidebar-nav">
      <div class="sidebar-section-label">Workspaces</div>

      @for (ws of workspaces(); track ws.id) {
        <a
          class="sidebar-nav-item"
          routerLinkActive="active"
          [routerLink]="['/app/workspaces', ws.id]"
        >
          <span class="nav-icon">◫</span>
          <span class="nav-label">{{ ws.name }}</span>
        </a>
      }

      <a class="sidebar-nav-item" routerLink="/app/workspaces" routerLinkActive="active"
         [routerLinkActiveOptions]="{ exact: true }">
        <span class="nav-icon">⊞</span>
        <span class="nav-label">All workspaces</span>
      </a>

      <div class="sidebar-section-label" style="margin-top:8px;">Account</div>
      <a class="sidebar-nav-item" routerLink="/app/settings" routerLinkActive="active">
        <span class="nav-icon">⚙</span>
        <span class="nav-label">Settings</span>
      </a>
    </nav>
```

- [ ] **Step 3: Update shell.routes.ts — replace flat settings/notifications with nested settings**

Replace the entire contents of `src/app/features/shell/shell.routes.ts`:

```typescript
// src/app/features/shell/shell.routes.ts
import { Routes } from '@angular/router';
import { ShellComponent } from './shell.component';

export const shellRoutes: Routes = [
  {
    path: '',
    component: ShellComponent,
    children: [
      {
        path: '',
        redirectTo: 'workspaces',
        pathMatch: 'full',
      },
      {
        path: 'workspaces',
        loadComponent: () =>
          import('../workspace/workspace-list/workspace-list.component').then(
            m => m.WorkspaceListComponent,
          ),
      },
      {
        path: 'workspaces/:id',
        loadChildren: () =>
          import('./workspace-shell/workspace-shell.routes').then(
            m => m.workspaceShellRoutes,
          ),
      },
      {
        path: 'files',
        loadComponent: () =>
          import('../files/files-page.component').then(m => m.FilesPageComponent),
      },
      {
        path: 'settings',
        loadChildren: () =>
          import('../settings/settings.routes').then(m => m.settingsRoutes),
      },
    ],
  },
];
```

- [ ] **Step 4: Add light theme CSS overrides to styles.scss**

Open `src/styles.scss`. Add the `[data-theme="light"]` block after the `body` rule:

```scss
[data-theme="light"] {
  body { background: #f8fafc; color: #0f172a; }

  .shell { background: #f1f5f9; }

  .sidebar {
    background: #ffffff;
    border-right: 1px solid #e2e8f0;
  }

  .sidebar-brand { &:hover { background: rgba(0,0,0,0.04); } }
  .sidebar-brand-name { color: #0f172a; }
  .sidebar-brand-chevron { color: #94a3b8; }

  .sidebar-section-label { color: #94a3b8; }

  .sidebar-nav-item {
    color: #475569;
    &:hover { background: rgba(0,0,0,0.04); color: #0f172a; }
    &.active { background: rgba(168,85,247,0.1); color: #7c3aed; border-right-color: #7c3aed; }
  }

  .sidebar-footer { border-top-color: #e2e8f0; }
  .sidebar-user-name { color: #0f172a; }
  .sidebar-user-email { color: #94a3b8; }

  .topbar {
    background: rgba(248,250,252,0.9);
    border-bottom-color: #e2e8f0;
  }
  .topbar-title { color: #0f172a; }

  .main-content { background: #f8fafc; }

  .workspace-card {
    background: #ffffff;
    border-color: #e2e8f0;
    &:hover { background: #f8fafc; border-color: rgba(124,58,237,0.4); }
    .workspace-card-name { color: #0f172a; }
    .workspace-card-desc { color: #94a3b8; }
  }
}
```

- [ ] **Step 5: Type-check**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.app.json
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/features/shell/shell.component.ts \
        src/app/features/shell/components/sidebar/sidebar.component.ts \
        src/app/features/shell/shell.routes.ts \
        src/styles.scss
git commit -m "feat(frontend): shell — ThemeService boot, settings nav link, light theme CSS"
```

---

## Task 5: SettingsComponent + settings.routes.ts

**Files:**
- Create: `src/app/features/settings/settings.component.ts`
- Create: `src/app/features/settings/settings.routes.ts`

- [ ] **Step 1: Create settings.routes.ts**

Create `src/app/features/settings/settings.routes.ts`:

```typescript
// src/app/features/settings/settings.routes.ts
import { Routes } from '@angular/router';
import { SettingsComponent } from './settings.component';

export const settingsRoutes: Routes = [
  {
    path: '',
    component: SettingsComponent,
    children: [
      { path: '', redirectTo: 'profile', pathMatch: 'full' },
      {
        path: 'profile',
        loadComponent: () =>
          import('./profile/profile-tab.component').then(m => m.ProfileTabComponent),
      },
      {
        path: 'security',
        loadComponent: () =>
          import('./security/security-tab.component').then(m => m.SecurityTabComponent),
      },
      {
        path: 'preferences',
        loadComponent: () =>
          import('./preferences/preferences-tab.component').then(m => m.PreferencesTabComponent),
      },
      {
        path: 'notifications',
        loadComponent: () =>
          import('../notifications/notification-preferences/notification-preferences.component').then(
            m => m.NotificationPreferencesComponent,
          ),
      },
    ],
  },
];
```

- [ ] **Step 2: Create SettingsComponent**

Create `src/app/features/settings/settings.component.ts`:

```typescript
// src/app/features/settings/settings.component.ts
import { Component } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div style="display:flex;gap:0;height:100%;min-height:calc(100vh - 56px);">
      <!-- Left nav -->
      <nav style="width:200px;flex-shrink:0;border-right:1px solid rgba(255,255,255,0.06);padding:8px 0;">
        <div class="sidebar-section-label">Settings</div>
        <a class="sidebar-nav-item" routerLink="profile"     routerLinkActive="active">
          <span class="nav-icon">👤</span>
          <span class="nav-label">Profile</span>
        </a>
        <a class="sidebar-nav-item" routerLink="security"    routerLinkActive="active">
          <span class="nav-icon">🔒</span>
          <span class="nav-label">Security</span>
        </a>
        <a class="sidebar-nav-item" routerLink="preferences" routerLinkActive="active">
          <span class="nav-icon">🎨</span>
          <span class="nav-label">Preferences</span>
        </a>
        <a class="sidebar-nav-item" routerLink="notifications" routerLinkActive="active">
          <span class="nav-icon">🔔</span>
          <span class="nav-label">Notifications</span>
        </a>
      </nav>

      <!-- Content -->
      <div style="flex:1;padding:2rem;overflow-y:auto;max-width:720px;">
        <router-outlet />
      </div>
    </div>
  `,
})
export class SettingsComponent {}
```

- [ ] **Step 3: Type-check**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.app.json
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/features/settings/settings.component.ts \
        src/app/features/settings/settings.routes.ts
git commit -m "feat(frontend): SettingsComponent shell with left-nav + settings.routes"
```

---

## Task 6: ProfileTabComponent (TDD)

**Files:**
- Create: `src/app/features/settings/profile/profile-tab.component.spec.ts`
- Create: `src/app/features/settings/profile/profile-tab.component.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/app/features/settings/profile/profile-tab.component.spec.ts`:

```typescript
// src/app/features/settings/profile/profile-tab.component.spec.ts
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { ProfileTabComponent } from './profile-tab.component';
import { UserService } from '../../../core/services/user.service';
import { AuthService } from '../../../core/services/auth.service';
import { User, defaultPreferences } from '../../../core/models/user.model';

const USER: User = {
  id: 'u-1', email: 'a@b.com', name: 'Alice', bio: 'Hello', avatarUrl: null,
  emailVerified: true, mfaEnabled: false, role: 'member',
  preferences: defaultPreferences(), createdAt: '2024-01-01T00:00:00.000Z',
};

describe('ProfileTabComponent', () => {
  let fixture: ComponentFixture<ProfileTabComponent>;
  let userService: { updateProfile: jest.Mock; uploadAvatar: jest.Mock };
  let authService: { currentUser: ReturnType<typeof signal<User | null>> };

  beforeEach(async () => {
    userService = {
      updateProfile: jest.fn().mockReturnValue(of(USER)),
      uploadAvatar:  jest.fn().mockReturnValue(of(USER)),
    };
    authService = { currentUser: signal<User | null>(USER) };

    await TestBed.configureTestingModule({
      imports: [ProfileTabComponent],
      providers: [
        { provide: UserService, useValue: userService },
        { provide: AuthService, useValue: authService },
        provideAnimations(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProfileTabComponent);
    fixture.detectChanges();
  });

  it('initialises form with current user name and bio', () => {
    const nameInput: HTMLInputElement = fixture.nativeElement.querySelector('input[formControlName="name"]');
    const bioInput:  HTMLTextAreaElement = fixture.nativeElement.querySelector('textarea[formControlName="bio"]');
    expect(nameInput.value).toBe('Alice');
    expect(bioInput.value).toBe('Hello');
  });

  it('shows initials avatar when avatarUrl is null', () => {
    const avatar = fixture.nativeElement.querySelector('[data-testid="avatar-initials"]');
    expect(avatar).toBeTruthy();
    expect(avatar.textContent.trim()).toBe('A');
  });

  it('shows img when avatarUrl is set', fakeAsync(() => {
    authService.currentUser.set({ ...USER, avatarUrl: 'https://cdn/av.png' });
    fixture.detectChanges();
    const img = fixture.nativeElement.querySelector('img[data-testid="avatar-img"]');
    expect(img).toBeTruthy();
    expect(img.src).toContain('https://cdn/av.png');
  }));

  it('save button is disabled when name is empty', () => {
    const nameInput: HTMLInputElement = fixture.nativeElement.querySelector('input[formControlName="name"]');
    nameInput.value = '';
    nameInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('button[data-testid="save-btn"]');
    expect(btn.disabled).toBe(true);
  });

  it('submit() calls userService.updateProfile with form values', fakeAsync(() => {
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('button[data-testid="save-btn"]');
    btn.click();
    tick();
    expect(userService.updateProfile).toHaveBeenCalledWith('Alice', 'Hello');
  }));

  it('shows success message after save', fakeAsync(() => {
    fixture.nativeElement.querySelector('button[data-testid="save-btn"]').click();
    tick();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Profile updated');
  }));

  it('shows error message when updateProfile fails', fakeAsync(() => {
    userService.updateProfile.mockReturnValue(throwError(() => ({ message: 'Server error' })));
    fixture.nativeElement.querySelector('button[data-testid="save-btn"]').click();
    tick();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Server error');
  }));
});
```

- [ ] **Step 2: Run tests — expect them to fail**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="profile-tab.component.spec"
```

Expected: `FAIL — Cannot find module './profile-tab.component'`

- [ ] **Step 3: Implement ProfileTabComponent**

Create `src/app/features/settings/profile/profile-tab.component.ts`:

```typescript
// src/app/features/settings/profile/profile-tab.component.ts
import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { UserService } from '../../../core/services/user.service';
import { AuthService } from '../../../core/services/auth.service';
import { AppError } from '../../../core/models/api-response.model';

@Component({
  selector: 'app-profile-tab',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <h2 style="color:#f1f5f9;font-size:18px;font-weight:700;margin:0 0 1.5rem;">Profile</h2>

    <!-- Avatar -->
    <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem;">
      @if (user()?.avatarUrl) {
        <img data-testid="avatar-img" [src]="user()!.avatarUrl!" alt="Avatar"
             style="width:64px;height:64px;border-radius:50%;object-fit:cover;cursor:pointer;"
             (click)="fileInput.click()" />
      } @else {
        <div data-testid="avatar-initials"
             style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#a855f7,#06b6d4);display:flex;align-items:center;justify-content:center;color:white;font-size:22px;font-weight:700;cursor:pointer;"
             (click)="fileInput.click()">
          {{ initials() }}
        </div>
      }
      <div>
        <div style="color:#f1f5f9;font-size:13px;font-weight:500;margin-bottom:4px;">Profile photo</div>
        <div style="color:#64748b;font-size:12px;">Click avatar to upload. JPG or PNG, max 5 MB.</div>
        @if (avatarLoading()) {
          <div style="color:#a855f7;font-size:12px;margin-top:4px;">Uploading…</div>
        }
        @if (avatarError()) {
          <div style="color:#f87171;font-size:12px;margin-top:4px;">{{ avatarError() }}</div>
        }
      </div>
      <input #fileInput type="file" accept="image/*" style="display:none" (change)="onFileChange($event)" />
    </div>

    <!-- Form -->
    @if (success()) {
      <div style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);border-radius:8px;padding:10px 14px;color:#86efac;font-size:13px;margin-bottom:1rem;">
        Profile updated
      </div>
    }
    @if (error()) {
      <div style="background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.3);border-radius:8px;padding:10px 14px;color:#fca5a5;font-size:13px;margin-bottom:1rem;">
        {{ error() }}
      </div>
    }

    <form [formGroup]="form" (ngSubmit)="submit()">
      <mat-form-field appearance="outline" style="width:100%;margin-bottom:0.5rem;">
        <mat-label>Display name</mat-label>
        <input matInput formControlName="name" autocomplete="name" />
        @if (form.controls.name.errors?.['required'] && form.controls.name.touched) {
          <mat-error>Name is required</mat-error>
        }
      </mat-form-field>

      <mat-form-field appearance="outline" style="width:100%;margin-bottom:1rem;">
        <mat-label>Bio (optional)</mat-label>
        <textarea matInput formControlName="bio" rows="3" maxlength="500"
                  placeholder="A short bio about yourself"></textarea>
      </mat-form-field>

      <button mat-flat-button color="primary" type="submit"
              data-testid="save-btn"
              [disabled]="form.invalid || saving()">
        {{ saving() ? 'Saving…' : 'Save changes' }}
      </button>
    </form>
  `,
})
export class ProfileTabComponent implements OnInit {
  private userService = inject(UserService);
  private auth        = inject(AuthService);
  private fb          = inject(FormBuilder);

  readonly user    = this.auth.currentUser;
  readonly saving  = signal(false);
  readonly success = signal(false);
  readonly error   = signal<string | null>(null);
  readonly avatarLoading = signal(false);
  readonly avatarError   = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(255)]],
    bio:  [''],
  });

  ngOnInit(): void {
    const u = this.user();
    if (u) this.form.patchValue({ name: u.name, bio: u.bio ?? '' });
  }

  readonly initials = () => {
    const name = this.user()?.name ?? '';
    return name.split(' ').slice(0, 2).map((w: string) => w[0]).join('').toUpperCase() || '?';
  };

  onFileChange(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.avatarLoading.set(true);
    this.avatarError.set(null);
    this.userService.uploadAvatar(file).subscribe({
      next:  () => this.avatarLoading.set(false),
      error: (err: AppError) => { this.avatarLoading.set(false); this.avatarError.set(err.message ?? 'Upload failed'); },
    });
  }

  submit(): void {
    if (this.form.invalid) return;
    const { name, bio } = this.form.getRawValue();
    this.saving.set(true);
    this.success.set(false);
    this.error.set(null);
    this.userService.updateProfile(name, bio || null).subscribe({
      next:  () => { this.saving.set(false); this.success.set(true); },
      error: (err: AppError) => { this.saving.set(false); this.error.set(err.message ?? 'Failed to update profile'); },
    });
  }
}
```

- [ ] **Step 4: Run tests — expect them to pass**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="profile-tab.component.spec"
```

Expected: `PASS — 7 tests passed`

- [ ] **Step 5: Commit**

```bash
git add src/app/features/settings/profile/profile-tab.component.ts \
        src/app/features/settings/profile/profile-tab.component.spec.ts
git commit -m "feat(frontend): ProfileTabComponent — name/bio form + avatar upload (TDD)"
```

---

## Task 7: SecurityTabComponent (TDD)

**Files:**
- Create: `src/app/features/settings/security/security-tab.component.spec.ts`
- Create: `src/app/features/settings/security/security-tab.component.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/app/features/settings/security/security-tab.component.spec.ts`:

```typescript
// src/app/features/settings/security/security-tab.component.spec.ts
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideAnimations } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { SecurityTabComponent } from './security-tab.component';
import { UserService } from '../../../core/services/user.service';
import { Session, MfaStatus } from '../../../core/models/user.model';

const SESSION_A: Session = { id: 's-1', deviceInfo: 'Chrome / macOS', ipAddress: '1.2.3.4', lastActive: '2024-01-01T00:00:00.000Z', isCurrent: true };
const SESSION_B: Session = { id: 's-2', deviceInfo: 'Firefox / Win', ipAddress: '5.6.7.8',  lastActive: '2024-01-02T00:00:00.000Z', isCurrent: false };
const MFA_OFF: MfaStatus = { enabled: false, backupCodesRemaining: 0 };
const MFA_ON:  MfaStatus = { enabled: true,  backupCodesRemaining: 6 };

describe('SecurityTabComponent', () => {
  let fixture: ComponentFixture<SecurityTabComponent>;
  let userService: { [key: string]: jest.Mock };

  beforeEach(async () => {
    userService = {
      changePassword:  jest.fn().mockReturnValue(of(undefined)),
      getSessions:     jest.fn().mockReturnValue(of([SESSION_A, SESSION_B])),
      revokeSession:   jest.fn().mockReturnValue(of(undefined)),
      getMfaStatus:    jest.fn().mockReturnValue(of(MFA_OFF)),
      setupMfa:        jest.fn().mockReturnValue(of({ qrCodeUrl: 'otpauth://...', secret: 'SECRET' })),
      confirmMfa:      jest.fn().mockReturnValue(of({ backupCodes: ['aa', 'bb'] })),
      disableMfa:      jest.fn().mockReturnValue(of(undefined)),
      regenBackupCodes: jest.fn().mockReturnValue(of({ backupCodes: ['cc', 'dd'] })),
    };

    await TestBed.configureTestingModule({
      imports: [SecurityTabComponent],
      providers: [
        { provide: UserService, useValue: userService },
        provideAnimations(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SecurityTabComponent);
    fixture.detectChanges();
  });

  // ── Password ─────────────────────────────────────────────────────────────
  it('shows password mismatch error when passwords do not match', fakeAsync(() => {
    setInput(fixture, '[formControlName="newPassword"]', 'abc123');
    setInput(fixture, '[formControlName="confirmPassword"]', 'different');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Passwords do not match');
  }));

  it('calls changePassword on valid submit', fakeAsync(() => {
    setInput(fixture, '[formControlName="currentPassword"]', 'old123');
    setInput(fixture, '[formControlName="newPassword"]', 'new123!');
    setInput(fixture, '[formControlName="confirmPassword"]', 'new123!');
    fixture.nativeElement.querySelector('button[data-testid="change-password-btn"]').click();
    tick();
    expect(userService.changePassword).toHaveBeenCalledWith('old123', 'new123!');
  }));

  it('shows success after password change', fakeAsync(() => {
    setInput(fixture, '[formControlName="currentPassword"]', 'old');
    setInput(fixture, '[formControlName="newPassword"]', 'new123!');
    setInput(fixture, '[formControlName="confirmPassword"]', 'new123!');
    fixture.nativeElement.querySelector('button[data-testid="change-password-btn"]').click();
    tick();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Password updated');
  }));

  // ── Sessions ─────────────────────────────────────────────────────────────
  it('renders session list on init', fakeAsync(() => {
    tick();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Chrome / macOS');
    expect(fixture.nativeElement.textContent).toContain('Firefox / Win');
  }));

  it('marks current session with "(this device)"', fakeAsync(() => {
    tick();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('(this device)');
  }));

  it('calls revokeSession when Revoke is clicked on non-current session', fakeAsync(() => {
    tick();
    fixture.detectChanges();
    const revokeBtns: NodeListOf<HTMLButtonElement> =
      fixture.nativeElement.querySelectorAll('button[data-testid="revoke-btn"]');
    revokeBtns[0].click();
    tick();
    expect(userService.revokeSession).toHaveBeenCalledWith('s-2');
  }));

  // ── MFA ──────────────────────────────────────────────────────────────────
  it('shows Enable 2FA button when MFA is disabled', fakeAsync(() => {
    tick();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button[data-testid="enable-mfa-btn"]')).toBeTruthy();
  }));

  it('clicking Enable 2FA calls setupMfa and shows QR code', fakeAsync(() => {
    tick();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('button[data-testid="enable-mfa-btn"]').click();
    tick();
    fixture.detectChanges();
    expect(userService.setupMfa).toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('SECRET');
  }));

  it('shows Disable 2FA button when MFA is enabled', fakeAsync(() => {
    userService.getMfaStatus.mockReturnValue(of(MFA_ON));
    fixture = TestBed.createComponent(SecurityTabComponent);
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button[data-testid="disable-mfa-btn"]')).toBeTruthy();
  }));
});

function setInput(fixture: ComponentFixture<unknown>, selector: string, value: string): void {
  const el: HTMLInputElement = fixture.nativeElement.querySelector(selector);
  el.value = value;
  el.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}
```

- [ ] **Step 2: Run tests — expect them to fail**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="security-tab.component.spec"
```

Expected: `FAIL — Cannot find module './security-tab.component'`

- [ ] **Step 3: Implement SecurityTabComponent**

Create `src/app/features/settings/security/security-tab.component.ts`:

```typescript
// src/app/features/settings/security/security-tab.component.ts
import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { UserService } from '../../../core/services/user.service';
import { Session, MfaStatus } from '../../../core/models/user.model';
import { AppError } from '../../../core/models/api-response.model';

function passwordsMatch(control: AbstractControl): ValidationErrors | null {
  const parent = control.parent;
  if (!parent) return null;
  return parent.get('newPassword')?.value === control.value ? null : { mismatch: true };
}

@Component({
  selector: 'app-security-tab',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <h2 style="color:#f1f5f9;font-size:18px;font-weight:700;margin:0 0 1.5rem;">Account Security</h2>

    <!-- ── Change password ───────────────────────────────────────── -->
    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:1.25rem;margin-bottom:1.5rem;">
      <h3 style="color:#f1f5f9;font-size:14px;font-weight:600;margin:0 0 1rem;">Change password</h3>

      @if (pwSuccess()) {
        <div style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);border-radius:8px;padding:8px 12px;color:#86efac;font-size:13px;margin-bottom:1rem;">
          Password updated
        </div>
      }
      @if (pwError()) {
        <div style="background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.3);border-radius:8px;padding:8px 12px;color:#fca5a5;font-size:13px;margin-bottom:1rem;">
          {{ pwError() }}
        </div>
      }

      <form [formGroup]="pwForm" (ngSubmit)="submitPassword()">
        <mat-form-field appearance="outline" style="width:100%;margin-bottom:0.5rem;">
          <mat-label>Current password</mat-label>
          <input matInput type="password" formControlName="currentPassword" autocomplete="current-password" />
        </mat-form-field>
        <mat-form-field appearance="outline" style="width:100%;margin-bottom:0.5rem;">
          <mat-label>New password</mat-label>
          <input matInput type="password" formControlName="newPassword" autocomplete="new-password" />
        </mat-form-field>
        <mat-form-field appearance="outline" style="width:100%;margin-bottom:1rem;">
          <mat-label>Confirm new password</mat-label>
          <input matInput type="password" formControlName="confirmPassword" autocomplete="new-password" />
          @if (pwForm.controls.confirmPassword.errors?.['mismatch'] && pwForm.controls.confirmPassword.touched) {
            <mat-error>Passwords do not match</mat-error>
          }
        </mat-form-field>
        <button mat-flat-button color="primary" type="submit"
                data-testid="change-password-btn"
                [disabled]="pwForm.invalid || pwSaving()">
          {{ pwSaving() ? 'Updating…' : 'Update password' }}
        </button>
      </form>
    </div>

    <!-- ── MFA ───────────────────────────────────────────────────── -->
    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:1.25rem;margin-bottom:1.5rem;">
      <h3 style="color:#f1f5f9;font-size:14px;font-weight:600;margin:0 0 0.75rem;">Two-factor authentication</h3>

      @if (mfaStatus() === null) {
        <div style="color:#64748b;font-size:13px;">Loading…</div>
      } @else if (setupData()) {
        <!-- Setup flow -->
        <p style="color:#94a3b8;font-size:13px;margin:0 0 0.75rem;">Scan this QR code with your authenticator app, then enter the 6-digit code to confirm.</p>
        <img [src]="setupData()!.qrCodeUrl" alt="QR code" style="width:160px;height:160px;border-radius:8px;margin-bottom:0.75rem;display:block;" />
        <p style="color:#64748b;font-size:12px;font-family:monospace;margin:0 0 1rem;">Manual: {{ setupData()!.secret }}</p>
        <form [formGroup]="mfaForm" (ngSubmit)="confirmMfa()">
          <mat-form-field appearance="outline" style="width:200px;margin-bottom:1rem;">
            <mat-label>6-digit code</mat-label>
            <input matInput formControlName="code" maxlength="6" autocomplete="one-time-code" />
          </mat-form-field>
          <div style="display:flex;gap:8px;">
            <button mat-flat-button color="primary" type="submit" [disabled]="mfaForm.invalid">Verify &amp; enable</button>
            <button mat-button type="button" (click)="cancelSetup()">Cancel</button>
          </div>
        </form>
      } @else if (backupCodes()) {
        <!-- Backup codes reveal -->
        <p style="color:#86efac;font-size:13px;margin:0 0 0.75rem;">2FA enabled. Save these backup codes in a safe place — each can be used once.</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-family:monospace;font-size:13px;margin-bottom:1rem;">
          @for (c of backupCodes()!; track c) {
            <span style="color:#f1f5f9;background:rgba(255,255,255,0.06);padding:4px 8px;border-radius:4px;">{{ c }}</span>
          }
        </div>
        <button mat-flat-button color="primary" (click)="backupCodes.set(null)">Done</button>
      } @else if (mfaStatus()!.enabled) {
        <!-- Enabled state -->
        <p style="color:#86efac;font-size:13px;margin:0 0 0.5rem;">2FA is <strong>enabled</strong>. Backup codes remaining: {{ mfaStatus()!.backupCodesRemaining }}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button mat-stroked-button data-testid="disable-mfa-btn" (click)="disableMfaConfirm.set(true)">Disable 2FA</button>
          <button mat-stroked-button (click)="regenCodes()">Regenerate backup codes</button>
        </div>
        @if (disableMfaConfirm()) {
          <form [formGroup]="disableForm" (ngSubmit)="disableMfa()" style="margin-top:1rem;">
            <mat-form-field appearance="outline" style="width:100%;max-width:280px;">
              <mat-label>Confirm with your password</mat-label>
              <input matInput type="password" formControlName="password" />
            </mat-form-field>
            <div style="display:flex;gap:8px;margin-top:0.5rem;">
              <button mat-flat-button color="warn" type="submit" [disabled]="disableForm.invalid">Disable</button>
              <button mat-button type="button" (click)="disableMfaConfirm.set(false)">Cancel</button>
            </div>
          </form>
        }
      } @else {
        <!-- Disabled state -->
        <p style="color:#94a3b8;font-size:13px;margin:0 0 0.75rem;">2FA is not enabled. Add an extra layer of security to your account.</p>
        <button mat-flat-button color="primary" data-testid="enable-mfa-btn" (click)="enableMfa()">Enable 2FA</button>
      }
    </div>

    <!-- ── Active sessions ────────────────────────────────────────── -->
    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:1.25rem;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;">
        <h3 style="color:#f1f5f9;font-size:14px;font-weight:600;margin:0;">Active sessions</h3>
        <button mat-stroked-button style="font-size:12px;" (click)="revokeOthers()">Sign out everywhere else</button>
      </div>
      @for (s of sessions(); track s.id) {
        <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
          <div style="flex:1;">
            <div style="color:#f1f5f9;font-size:13px;font-weight:500;">
              {{ s.deviceInfo }}
              @if (s.isCurrent) { <span style="color:#22c55e;font-size:11px;margin-left:6px;">(this device)</span> }
            </div>
            <div style="color:#64748b;font-size:12px;">{{ s.ipAddress }} · Last active {{ s.lastActive | date:'mediumDate' }}</div>
          </div>
          @if (!s.isCurrent) {
            <button mat-stroked-button data-testid="revoke-btn" (click)="revokeSession(s.id)" style="font-size:12px;">Revoke</button>
          }
        </div>
      }
    </div>
  `,
})
export class SecurityTabComponent implements OnInit {
  private userService = inject(UserService);
  private fb          = inject(FormBuilder);

  readonly sessions         = signal<Session[]>([]);
  readonly mfaStatus        = signal<MfaStatus | null>(null);
  readonly setupData        = signal<{ qrCodeUrl: string; secret: string } | null>(null);
  readonly backupCodes      = signal<string[] | null>(null);
  readonly disableMfaConfirm = signal(false);
  readonly pwSaving         = signal(false);
  readonly pwSuccess        = signal(false);
  readonly pwError          = signal<string | null>(null);

  readonly pwForm = this.fb.nonNullable.group({
    currentPassword:  ['', Validators.required],
    newPassword:      ['', [Validators.required, Validators.minLength(8)]],
    confirmPassword:  ['', [Validators.required, passwordsMatch]],
  });

  readonly mfaForm = this.fb.nonNullable.group({
    code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });

  readonly disableForm = this.fb.nonNullable.group({
    password: ['', Validators.required],
  });

  ngOnInit(): void {
    this.userService.getSessions().subscribe(s => this.sessions.set(s));
    this.userService.getMfaStatus().subscribe(s => this.mfaStatus.set(s));
    // Re-validate confirmPassword when newPassword changes
    this.pwForm.controls.newPassword.valueChanges.subscribe(() => {
      this.pwForm.controls.confirmPassword.updateValueAndValidity();
    });
  }

  submitPassword(): void {
    if (this.pwForm.invalid) return;
    const { currentPassword, newPassword } = this.pwForm.getRawValue();
    this.pwSaving.set(true);
    this.pwError.set(null);
    this.userService.changePassword(currentPassword, newPassword).subscribe({
      next: () => { this.pwSaving.set(false); this.pwSuccess.set(true); this.pwForm.reset(); },
      error: (err: AppError) => { this.pwSaving.set(false); this.pwError.set(err.message ?? 'Failed'); },
    });
  }

  enableMfa(): void {
    this.userService.setupMfa().subscribe(data => this.setupData.set(data));
  }

  cancelSetup(): void {
    this.setupData.set(null);
    this.mfaForm.reset();
  }

  confirmMfa(): void {
    const { code } = this.mfaForm.getRawValue();
    this.userService.confirmMfa(code).subscribe(r => {
      this.setupData.set(null);
      this.backupCodes.set(r.backupCodes);
      this.mfaStatus.set({ enabled: true, backupCodesRemaining: r.backupCodes.length });
    });
  }

  disableMfa(): void {
    const { password } = this.disableForm.getRawValue();
    this.userService.disableMfa(password).subscribe(() => {
      this.mfaStatus.set({ enabled: false, backupCodesRemaining: 0 });
      this.disableMfaConfirm.set(false);
      this.disableForm.reset();
    });
  }

  regenCodes(): void {
    this.userService.regenBackupCodes().subscribe(r => this.backupCodes.set(r.backupCodes));
  }

  revokeSession(id: string): void {
    this.userService.revokeSession(id).subscribe(() =>
      this.sessions.update(s => s.filter(x => x.id !== id)),
    );
  }

  revokeOthers(): void {
    this.sessions()
      .filter(s => !s.isCurrent)
      .forEach(s => this.revokeSession(s.id));
  }
}
```

- [ ] **Step 4: Run tests — expect them to pass**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="security-tab.component.spec"
```

Expected: `PASS — 9 tests passed`

- [ ] **Step 5: Commit**

```bash
git add src/app/features/settings/security/security-tab.component.ts \
        src/app/features/settings/security/security-tab.component.spec.ts
git commit -m "feat(frontend): SecurityTabComponent — password/MFA/sessions (TDD)"
```

---

## Task 8: PreferencesTabComponent (TDD)

**Files:**
- Create: `src/app/features/settings/preferences/preferences-tab.component.spec.ts`
- Create: `src/app/features/settings/preferences/preferences-tab.component.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/app/features/settings/preferences/preferences-tab.component.spec.ts`:

```typescript
// src/app/features/settings/preferences/preferences-tab.component.spec.ts
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { PreferencesTabComponent } from './preferences-tab.component';
import { UserService } from '../../../core/services/user.service';
import { ThemeService } from '../../../core/services/theme.service';
import { AuthService } from '../../../core/services/auth.service';
import { User, defaultPreferences } from '../../../core/models/user.model';

const USER: User = {
  id: 'u-1', email: 'a@b.com', name: 'Alice', bio: null, avatarUrl: null,
  emailVerified: true, mfaEnabled: false, role: 'member',
  preferences: { timezone: 'UTC', locale: 'en-US', theme: 'dark', dateFormat: 'DD/MM/YYYY' },
  createdAt: '2024-01-01T00:00:00.000Z',
};

describe('PreferencesTabComponent', () => {
  let fixture: ComponentFixture<PreferencesTabComponent>;
  let userService: { savePreferences: jest.Mock };
  let themeService: { apply: jest.Mock; theme: ReturnType<typeof signal<'dark' | 'light' | 'system'>> };
  let authService: { currentUser: ReturnType<typeof signal<User | null>> };

  beforeEach(async () => {
    userService  = { savePreferences: jest.fn().mockReturnValue(of(defaultPreferences())) };
    themeService = { apply: jest.fn(), theme: signal<'dark' | 'light' | 'system'>('dark') };
    authService  = { currentUser: signal<User | null>(USER) };

    await TestBed.configureTestingModule({
      imports: [PreferencesTabComponent],
      providers: [
        { provide: UserService,  useValue: userService },
        { provide: ThemeService, useValue: themeService },
        { provide: AuthService,  useValue: authService },
        provideAnimations(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PreferencesTabComponent);
    fixture.detectChanges();
  });

  it('initialises form from current user preferences', () => {
    expect(fixture.componentInstance.form.value.timezone).toBe('UTC');
    expect(fixture.componentInstance.form.value.locale).toBe('en-US');
    expect(fixture.componentInstance.form.value.theme).toBe('dark');
    expect(fixture.componentInstance.form.value.dateFormat).toBe('DD/MM/YYYY');
  });

  it('calls userService.savePreferences after 1000ms debounce on change', fakeAsync(() => {
    fixture.componentInstance.form.patchValue({ locale: 'en-GB' });
    tick(999);
    expect(userService.savePreferences).not.toHaveBeenCalled();
    tick(1);
    expect(userService.savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ locale: 'en-GB' }),
    );
  }));

  it('calls themeService.apply() immediately when theme changes', fakeAsync(() => {
    fixture.componentInstance.form.patchValue({ theme: 'light' });
    tick(0);
    expect(themeService.apply).toHaveBeenCalledWith('light');
  }));

  it('does not call themeService.apply() for non-theme changes', fakeAsync(() => {
    fixture.componentInstance.form.patchValue({ locale: 'en-GB' });
    tick(0);
    expect(themeService.apply).not.toHaveBeenCalled();
  }));
});
```

- [ ] **Step 2: Run tests — expect them to fail**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="preferences-tab.component.spec"
```

Expected: `FAIL — Cannot find module './preferences-tab.component'`

- [ ] **Step 3: Implement PreferencesTabComponent**

Create `src/app/features/settings/preferences/preferences-tab.component.ts`:

```typescript
// src/app/features/settings/preferences/preferences-tab.component.ts
import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { Subject, distinctUntilChanged } from 'rxjs';
import { debounceTime, takeUntil } from 'rxjs/operators';
import { UserService } from '../../../core/services/user.service';
import { ThemeService } from '../../../core/services/theme.service';
import { AuthService } from '../../../core/services/auth.service';

const TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow',
  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Tokyo',
  'Asia/Shanghai', 'Australia/Sydney', 'Pacific/Auckland',
];

const LOCALES = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'en-IN', label: 'English (India)' },
  { value: 'fr-FR', label: 'Français' },
  { value: 'de-DE', label: 'Deutsch' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'zh-CN', label: '中文 (简体)' },
];

@Component({
  selector: 'app-preferences-tab',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatFormFieldModule, MatSelectModule],
  template: `
    <h2 style="color:#f1f5f9;font-size:18px;font-weight:700;margin:0 0 0.5rem;">Preferences</h2>
    <p style="color:#64748b;font-size:13px;margin:0 0 1.5rem;">Changes save automatically.</p>

    <div style="display:flex;flex-direction:column;gap:1rem;max-width:400px;" [formGroup]="form">

      <mat-form-field appearance="outline">
        <mat-label>Timezone</mat-label>
        <mat-select formControlName="timezone">
          @for (tz of timezones; track tz) {
            <mat-option [value]="tz">{{ tz }}</mat-option>
          }
        </mat-select>
      </mat-form-field>

      <mat-form-field appearance="outline">
        <mat-label>Language / Locale</mat-label>
        <mat-select formControlName="locale">
          @for (l of locales; track l.value) {
            <mat-option [value]="l.value">{{ l.label }}</mat-option>
          }
        </mat-select>
      </mat-form-field>

      <mat-form-field appearance="outline">
        <mat-label>Theme</mat-label>
        <mat-select formControlName="theme">
          <mat-option value="dark">Dark</mat-option>
          <mat-option value="light">Light</mat-option>
          <mat-option value="system">System</mat-option>
        </mat-select>
      </mat-form-field>

      <mat-form-field appearance="outline">
        <mat-label>Date format</mat-label>
        <mat-select formControlName="dateFormat">
          <mat-option value="DD/MM/YYYY">DD/MM/YYYY</mat-option>
          <mat-option value="MM/DD/YYYY">MM/DD/YYYY</mat-option>
          <mat-option value="YYYY-MM-DD">YYYY-MM-DD</mat-option>
        </mat-select>
      </mat-form-field>

    </div>
  `,
})
export class PreferencesTabComponent implements OnInit, OnDestroy {
  private userService  = inject(UserService);
  private themeService = inject(ThemeService);
  private auth         = inject(AuthService);
  private fb           = inject(FormBuilder);
  private destroy$     = new Subject<void>();

  readonly timezones = TIMEZONES;
  readonly locales   = LOCALES;

  readonly form = this.fb.nonNullable.group({
    timezone:   ['UTC'],
    locale:     ['en-US'],
    theme:      ['dark' as 'dark' | 'light' | 'system'],
    dateFormat: ['DD/MM/YYYY' as 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD'],
  });

  ngOnInit(): void {
    const prefs = this.auth.currentUser()?.preferences;
    if (prefs) this.form.patchValue(prefs, { emitEvent: false });

    // Apply theme immediately on change (no debounce)
    this.form.controls.theme.valueChanges.pipe(
      distinctUntilChanged(),
      takeUntil(this.destroy$),
    ).subscribe(t => this.themeService.apply(t));

    // Debounce save for all fields
    this.form.valueChanges.pipe(
      debounceTime(1000),
      takeUntil(this.destroy$),
    ).subscribe(v => this.userService.savePreferences(v).subscribe());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
```

- [ ] **Step 4: Run tests — expect them to pass**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="preferences-tab.component.spec"
```

Expected: `PASS — 4 tests passed`

- [ ] **Step 5: Commit**

```bash
git add src/app/features/settings/preferences/preferences-tab.component.ts \
        src/app/features/settings/preferences/preferences-tab.component.spec.ts
git commit -m "feat(frontend): PreferencesTabComponent — timezone/locale/theme/dateFormat auto-save (TDD)"
```

---

## Task 9: Final smoke test

- [ ] **Step 1: Run all frontend tests**

```bash
cd frontend && npx ng test --watch=false
```

Expected output (all passing):
```
PASS src/app/core/services/user.service.spec.ts
PASS src/app/core/services/theme.service.spec.ts
PASS src/app/core/guards/org.guard.spec.ts
PASS src/app/core/services/tenant.service.spec.ts
PASS src/app/core/services/auth.service.spec.ts
PASS src/app/core/services/workspace.service.spec.ts
PASS src/app/core/services/socket.service.spec.ts
PASS src/app/core/interceptors/jwt.interceptor.spec.ts
PASS src/app/core/interceptors/idempotency.interceptor.spec.ts
PASS src/app/core/interceptors/error.interceptor.spec.ts
PASS src/app/core/guards/auth.guard.spec.ts
PASS src/app/features/settings/profile/profile-tab.component.spec.ts
PASS src/app/features/settings/security/security-tab.component.spec.ts
PASS src/app/features/settings/preferences/preferences-tab.component.spec.ts
PASS src/app/features/auth/login/login.component.spec.ts
PASS src/app/features/auth/mfa/mfa.component.spec.ts
... (all 33+ suites)

Test Suites: 37 passed, 37 total
Tests:       ~170 passed, ~170 total
```

If any suite fails, fix it before continuing.

- [ ] **Step 2: Full TypeScript compile check**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.app.json
```

Expected: zero errors.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: Angular Phase 6 — user profile, security (password/MFA/sessions), preferences (theme/locale/TZ)"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Profile editing (name, bio) — Task 6
- ✅ Avatar upload with initials fallback — Task 6
- ✅ Change password — Task 7
- ✅ MFA enable/disable/backup codes — Task 7
- ✅ Active sessions list + revoke — Task 7
- ✅ Timezone preference — Task 8
- ✅ Locale preference — Task 8
- ✅ Theme toggle (dark/light/system) with instant preview — Task 8
- ✅ Date format preference — Task 8
- ✅ Preferences auto-save (debounced) — Task 8
- ✅ ThemeService with localStorage + DOM + debounced backend sync — Task 3
- ✅ UserService covering all 11 endpoints — Task 2
- ✅ Left sidebar nav layout — Task 5
- ✅ Settings link in app sidebar — Task 4
- ✅ Light theme CSS — Task 4
- ✅ Notifications tab preserved at /app/settings/notifications — Task 5
- ✅ AuthService.updateCurrentUser() — Task 1
- ✅ User model extended (bio, avatarUrl, preferences) — Task 1
