# Notifications — Phase 4 Design Spec

**Date:** 2026-04-18  
**Branch:** feature/phase4-notifications  
**Scope:** Full notifications — in-app bell, real-time Socket.IO, email + push preferences, browser Push API  

---

## Decisions

| Question | Decision |
|---|---|
| Bell placement | Top bar, right side (alongside user avatar) |
| Dropdown style | Tabbed panel — All / Unread / Mentions |
| Real-time delivery | Socket.IO `notification:new` event on user personal room |
| Preference center | Full route at `/app/settings/notifications` |
| State management | Signal-based services (consistent with Phase 3) |
| Push notifications | Included — service worker + VAPID + `web-push` |

---

## Architecture Overview

### New frontend files

```
core/
  services/
    notification.service.ts
    notification.service.spec.ts
    push-notification.service.ts
    push-notification.service.spec.ts
  models/
    notification.model.ts

features/notifications/
  top-bar/
    top-bar.component.ts
    top-bar.component.spec.ts
  notification-panel/
    notification-panel.component.ts
    notification-panel.component.spec.ts
  notification-item/
    notification-item.component.ts
  notification-preferences/
    notification-preferences.component.ts
    notification-preferences.component.spec.ts
```

### New backend files

```
src/modules/notification/
  push.service.ts
  push.router.ts
migrations/
  018_push_subscriptions.js
```

### Shell changes

- `ShellComponent` imports and renders `<app-top-bar>` above `<router-outlet>`
- `shell.routes.ts` adds `/app/settings/notifications` → `NotificationPreferencesComponent` (lazy)

---

## Backend Changes

### Migration 018 — push_subscriptions

```sql
CREATE TABLE push_subscriptions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id     UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  endpoint   TEXT        NOT NULL,
  p256dh     TEXT        NOT NULL,
  auth       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, endpoint)
);
```

### push.service.ts

- `saveSubscription(userId, orgId, subscription)` — upsert into `push_subscriptions`
- `removeSubscription(userId, endpoint)` — delete row
- `sendPush(userId, payload)` — query all user subscriptions, call `webpush.sendNotification()`; auto-delete expired subscriptions (410 Gone) silently
- VAPID keys read from `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` env vars

### push.router.ts

Both routes behind `jwtMiddleware` + `orgContextMiddleware`:

- `POST /api/v1/push/subscribe` — saves browser PushSubscription object
- `DELETE /api/v1/push/subscribe` — removes subscription by endpoint

### Socket.IO emit

In `NotificationService.create()` (backend), after DB insert:

```typescript
io.to(`org:${orgId}:user:${userId}`).emit('notification:new', notificationDto);
```

### Push delivery

After inserting notification row, `NotificationService.create()` calls `pushService.sendPush()` if the user's preference for that event type has `channel_push = true`.

---

## Frontend Components

### notification.model.ts

```typescript
export interface Notification {
  id: string;
  orgId: string;
  userId: string;
  type: string;
  entityType: string;
  entityId: string;
  actorId: string;
  payload: Record<string, unknown>;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPreference {
  eventType: string;
  channelInapp: boolean;
  channelEmail: boolean;
  channelPush: boolean;
  digestMode: 'realtime' | 'daily_digest';
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
}
```

### NotificationService (signal-based)

```typescript
readonly notifications = signal<Notification[]>([]);
readonly unreadCount   = signal(0);
readonly loading       = signal(false);

load(limit = 20): Observable<void>       // GET /notifications?limit=N
markRead(id: string): Observable<void>   // optimistic update, revert on error
markAllRead(): Observable<void>          // optimistic, revert on error
subscribeRealtime(): Subscription        // socket 'notification:new' → prepend + increment count
```

On socket reconnect (`SocketService.fromEvent('connect')`): re-call `load()` to sync missed notifications.

### PushNotificationService

```typescript
isSupported(): boolean                   // 'serviceWorker' in navigator && 'PushManager' in window
requestPermission(): Observable<void>    // ask browser, register /sw.js, POST /push/subscribe
unsubscribe(): Observable<void>          // DELETE /push/subscribe, unregister SW
readonly permissionDenied = signal(false)
```

VAPID public key from `environment.vapidPublicKey`.

### TopBarComponent

- Standalone, imported into `ShellComponent`
- Left: workspace/org name
- Right: bell icon + unread badge (hidden when `unreadCount() === 0`) + user avatar
- Bell click toggles `NotificationPanelComponent` via local boolean signal
- Calls `notificationService.load()` on init; `notificationService.subscribeRealtime()` subscribed with `takeUntilDestroyed()`

### NotificationPanelComponent

- Tabbed: **All** / **Unread** (badge) / **Mentions** — all filter `notifications()` signal locally, no extra API calls
- Each row: `NotificationItemComponent` — click marks read + navigates to entity URL
- Footer: "Mark all read" button + "⚙ Preferences" `routerLink` → `/app/settings/notifications`
- Panel closes on outside click (CDK `Overlay` or click-outside directive)

### NotificationItemComponent

- Unread dot indicator (blue)
- Actor + action text derived from `notification.type` + `payload`
- Relative timestamp
- Click: `notificationService.markRead(id)` then `router.navigate()` to entity URL derived from `entityType` + `entityId` (e.g. `task` → `/app/workspaces/:workspaceId/tasks`, `channel` → `/app/workspaces/:workspaceId/chat/:channelId`); `workspaceId` sourced from `notification.payload`

### NotificationPreferencesComponent (route: `/app/settings/notifications`)

- Loads `GET /notification-preferences` on init
- Grid: event type rows × channel columns (In-app / Email / Push)
- Each toggle: `PATCH /notification-preferences/:eventType` immediately (no Save button)
- Digest mode `<select>` + quiet hours time inputs
- Push row includes "Enable browser notifications" button → `pushService.requestPermission()`
- If `pushService.permissionDenied()`: shows "Notifications blocked in your browser" message instead

---

## Data Flow — Real-time

```
Backend worker creates notification
  → INSERT into notifications
  → io.emit('notification:new', dto) to user personal room
  → pushService.sendPush() if channel_push enabled for event type

Frontend SocketService receives 'notification:new'
  → NotificationService.subscribeRealtime() prepends to notifications signal
  → unreadCount signal increments
  → TopBar badge updates reactively (Angular signals)
  → Browser Push API shows OS notification if SW registered
```

---

## Error Handling

| Scenario | Handling |
|---|---|
| `markRead()` / `markAllRead()` fails | Optimistic update reverted; signal restored to previous state |
| Push permission denied by browser | `permissionDenied` signal set; prefs page shows blocked message |
| Push subscription expired (410) | Backend auto-deletes from `push_subscriptions`; never throws |
| Socket disconnect | On reconnect, `NotificationService.load()` re-fetches to sync missed items |
| Push delivery failure | Silent — in-app delivery is the source of truth |

---

## Testing Plan

### Frontend (TDD — spec first)

| Spec file | Key tests |
|---|---|
| `notification.service.spec.ts` | `load()` populates signal; `markRead()` optimistic update + revert; `markAllRead()` clears unread; `subscribeRealtime()` prepends item + increments count |
| `push-notification.service.spec.ts` | `isSupported()` false when APIs absent; `requestPermission()` calls subscribe endpoint; `unsubscribe()` calls delete endpoint |
| `top-bar.component.spec.ts` | Badge shown when `unreadCount > 0`; hidden when 0; panel toggles on bell click |
| `notification-panel.component.spec.ts` | All/Unread/Mentions tabs filter correctly; item click calls `markRead()`; "Mark all read" button calls `markAllRead()` |
| `notification-preferences.component.spec.ts` | Loads preferences on init; toggling channel calls PATCH immediately; push button calls `requestPermission()`; blocked message shown when `permissionDenied` |

### Backend (unit)

| Spec file | Key tests |
|---|---|
| `push.service.spec.ts` | `saveSubscription()` upserts; `removeSubscription()` deletes; `sendPush()` calls webpush per subscription; 410 auto-deletes subscription |

---

## Environment Variables Added

```bash
VAPID_PUBLIC_KEY=<generated>
VAPID_PRIVATE_KEY=<generated>
VAPID_CONTACT=mailto:admin@example.com
```

Frontend: `environment.vapidPublicKey` (public key only).

---

## Out of Scope

- Notification grouping / threading
- Per-workspace notification preferences (org-level only)
- Mobile push (FCM/APNs) — browser Push API only
- Notification read receipts / analytics
