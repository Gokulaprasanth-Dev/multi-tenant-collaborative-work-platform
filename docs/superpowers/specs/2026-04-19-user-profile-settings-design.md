# Frontend Phase 6 — User Profile & Settings Design

**Date:** 2026-04-19
**Scope:** Angular frontend — user profile editing, account security (password, MFA, sessions), and app preferences (timezone, locale, theme, date format).

---

## Goals

- Let users view and edit their profile (name, bio, avatar)
- Let users manage account security (change password, enable/disable MFA, revoke sessions)
- Let users set app preferences (timezone, locale, theme, date format) that persist across devices
- Unblock downstream features that need user attribution (task detail assignee display, search result attribution)

---

## Architecture

### Approach

Flat components + `UserService` pattern — consistent with existing `WorkspaceService`, `TenantService`, etc. No new state management patterns. Preferences persisted to DB (syncs across devices), with immediate localStorage apply for zero-flash theme switching.

---

## Section 1: Data Model + UserService

### user.model.ts (extend)

```typescript
export interface UserPreferences {
  timezone:   string;   // IANA, e.g. 'Asia/Kolkata'
  locale:     string;   // BCP 47, e.g. 'en-IN'
  theme:      'dark' | 'light' | 'system';
  dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
}

export interface User {
  id:             string;
  email:          string;
  name:           string;
  bio:            string | null;
  avatarUrl:      string | null;
  emailVerified:  boolean;
  mfaEnabled:     boolean;
  role:           'member' | 'admin' | 'platform_admin';
  preferences:    UserPreferences;
  createdAt:      string;
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
  preferences:    UserPreferences;  // backend returns camelCase JSON blob
  created_at:     string;
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

export function defaultPreferences(): UserPreferences {
  return { timezone: 'UTC', locale: 'en-US', theme: 'dark', dateFormat: 'DD/MM/YYYY' };
}
```

### UserService (new — src/app/core/services/user.service.ts)

```typescript
// Public API
updateProfile(name: string, bio: string | null): Observable<User>
uploadAvatar(file: File): Observable<User>
changePassword(currentPassword: string, newPassword: string): Observable<void>
getSessions(): Observable<Session[]>
revokeSession(sessionId: string): Observable<void>
getMfaStatus(): Observable<MfaStatus>
setupMfa(): Observable<{ qrCodeUrl: string; secret: string }>
confirmMfa(code: string): Observable<{ backupCodes: string[] }>
disableMfa(password: string): Observable<void>
regenBackupCodes(): Observable<{ backupCodes: string[] }>
savePreferences(prefs: Partial<UserPreferences>): Observable<UserPreferences>
```

After any mutation that changes the user object, `UserService` calls `authService.updateCurrentUser(updatedUser)` — a new method added to `AuthService` to push changes to the `currentUser` signal.

### Backend API surface (assumed — separate backend repo)

| Method | Path | Body / Params |
|--------|------|---------------|
| PATCH  | `/api/v1/me` | `{ name?, bio? }` |
| POST   | `/api/v1/me/avatar` | `FormData` (file field: `avatar`) |
| PATCH  | `/api/v1/me/password` | `{ currentPassword, newPassword }` |
| GET    | `/api/v1/me/sessions` | — |
| DELETE | `/api/v1/me/sessions/:id` | — |
| GET    | `/api/v1/me/mfa` | — |
| POST   | `/api/v1/me/mfa/setup` | — |
| POST   | `/api/v1/me/mfa/confirm` | `{ code }` |
| DELETE | `/api/v1/me/mfa` | `{ password }` |
| POST   | `/api/v1/me/mfa/backup-codes` | — |
| PATCH  | `/api/v1/me/preferences` | `Partial<UserPreferences>` |

---

## Section 2: ThemeService

**File:** `src/app/core/services/theme.service.ts`

```typescript
// Public API
readonly theme: Signal<'dark' | 'light' | 'system'>
apply(theme: 'dark' | 'light' | 'system'): void   // sets signal + DOM + localStorage
applyStored(): void                                 // called once on ShellComponent.ngOnInit()
resolvedTheme(): 'dark' | 'light'                  // system → OS preference
```

- `apply()` writes `data-theme="dark|light"` to `document.documentElement` instantly
- Persists to `localStorage` for zero-flash boot
- Syncs to backend via `UserService.savePreferences({ theme })` debounced 1s (fire-and-forget)
- `applyStored()` reads localStorage first; falls back to `'dark'`

**CSS:** `[data-theme="light"]` overrides added to `src/styles/styles.scss` — no new file.

**Shell integration:** `ShellComponent.ngOnInit()` calls `themeService.applyStored()`. `SidebarComponent` gets a settings link:

```html
<a class="sidebar-nav-item" routerLink="/app/settings" routerLinkActive="active">
  <span class="nav-icon">⚙</span>
  <span class="nav-label">Settings</span>
</a>
```

---

## Section 3: Routing + SettingsComponent Shell

### shell.routes.ts (extend)

```typescript
{
  path: 'settings',
  loadChildren: () =>
    import('../settings/settings.routes').then(m => m.settingsRoutes),
},
```

### settings.routes.ts (new)

```typescript
export const settingsRoutes: Routes = [
  { path: '', redirectTo: 'profile', pathMatch: 'full' },
  { path: 'profile',     loadComponent: () => import('./profile/profile-tab.component').then(m => m.ProfileTabComponent) },
  { path: 'security',    loadComponent: () => import('./security/security-tab.component').then(m => m.SecurityTabComponent) },
  { path: 'preferences', loadComponent: () => import('./preferences/preferences-tab.component').then(m => m.PreferencesTabComponent) },
];
```

### SettingsComponent (new)

Layout: 200px left nav + `<router-outlet>`. Reuses `.sidebar-nav-item` and `.sidebar-section-label` CSS. No new stylesheet — uses existing shell classes.

**Files:**
- `src/app/features/settings/settings.component.ts`
- `src/app/features/settings/settings.routes.ts`

---

## Section 4: Tab Components

### ProfileTabComponent

**File:** `src/app/features/settings/profile/profile-tab.component.ts`

- Reactive form: `name` (required, max 255), `bio` (optional, max 500)
- Avatar display: shows `<img>` if `avatarUrl` set, else initials div (matches sidebar style)
- Hidden `<input type="file" accept="image/*">` triggered by clicking avatar
- On file select: calls `UserService.uploadAvatar()`, shows inline loading spinner + error text (not `FileChipComponent` — that's for multi-file upload flows)
- Save button: calls `UserService.updateProfile()`, shows inline success/error

**Test file:** `profile-tab.component.spec.ts`

### SecurityTabComponent

**File:** `src/app/features/settings/security/security-tab.component.ts`

Three card sections:

1. **Change password** — `currentPassword`, `newPassword`, `confirmPassword` fields. Validates match client-side. Calls `UserService.changePassword()`.

2. **Two-factor authentication** — reads `MfaStatus` from `UserService.getMfaStatus()` on init.
   - *Disabled state:* "Enable 2FA" button → calls `setupMfa()` → shows QR code + secret → verify code input → on success shows backup codes modal
   - *Enabled state:* "Disable 2FA" button (requires password confirm) + "Regenerate backup codes" button
   - No stepper component dependency — plain conditional template with `@if`

3. **Active sessions** — table/list: device info, IP, last active, Revoke button. The `Session` model includes `isCurrent: boolean` (returned by backend) to identify the calling session. "Sign out everywhere else" button calls `revokeSession()` for all sessions where `isCurrent === false`.

**Test file:** `security-tab.component.spec.ts`

### PreferencesTabComponent

**File:** `src/app/features/settings/preferences/preferences-tab.component.ts`

Four `<select>` / `<mat-select>` fields:
- **Timezone** — IANA list (subset: ~50 common zones)
- **Locale** — `en-US`, `en-GB`, `en-IN`, `fr-FR`, `de-DE`, `ja-JP`, `zh-CN`
- **Theme** — Dark, Light, System
- **Date format** — `DD/MM/YYYY`, `MM/DD/YYYY`, `YYYY-MM-DD`

Auto-saves via `debounceTime(1000)` on `valueChanges` — no Save button. Theme change calls `ThemeService.apply()` immediately for instant preview; backend sync follows via debounce.

**Test file:** `preferences-tab.component.spec.ts`

---

## Testing Strategy

All service and component tests follow existing TDD pattern (spec first, implementation second):

| File | Tests |
|------|-------|
| `user.service.spec.ts` | HTTP mocks for all 11 methods; signal update after mutation |
| `theme.service.spec.ts` | localStorage read/write, DOM attribute, debounced backend sync |
| `profile-tab.component.spec.ts` | form validation, avatar upload trigger, success/error state |
| `security-tab.component.spec.ts` | password mismatch validation, MFA enable/disable flow, session list + revoke |
| `preferences-tab.component.spec.ts` | auto-save debounce, theme preview, form init from user signal |

---

## File Map

**New files:**
- `src/app/core/models/user.model.ts` — extend (add bio, avatarUrl, preferences, UserDto, toUser, defaultPreferences)
- `src/app/core/services/user.service.ts` + `.spec.ts`
- `src/app/core/services/theme.service.ts` + `.spec.ts`
- `src/app/features/settings/settings.component.ts`
- `src/app/features/settings/settings.routes.ts`
- `src/app/features/settings/profile/profile-tab.component.ts` + `.spec.ts`
- `src/app/features/settings/security/security-tab.component.ts` + `.spec.ts`
- `src/app/features/settings/preferences/preferences-tab.component.ts` + `.spec.ts`

**Modified files:**
- `src/app/core/services/auth.service.ts` — add `updateCurrentUser()` method
- `src/app/features/shell/shell.component.ts` — call `themeService.applyStored()` in `ngOnInit`
- `src/app/features/shell/components/sidebar/sidebar.component.ts` — add settings nav link
- `src/app/features/shell/shell.routes.ts` — add settings lazy-loaded child
- `src/styles/styles.scss` — add `[data-theme="light"]` CSS overrides

---

## Out of Scope

- Notification preferences (done in Phase 4)
- Org-level settings (separate admin concern)
- Account deletion / GDPR export (separate Phase)
- Payment / billing settings (separate Phase)
