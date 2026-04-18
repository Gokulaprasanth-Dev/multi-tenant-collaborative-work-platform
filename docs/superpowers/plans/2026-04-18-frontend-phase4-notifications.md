# Notifications — Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full notifications feature — in-app bell with tabbed dropdown (All/Unread/Mentions), Socket.IO real-time delivery, browser Push API with service worker, and a `/app/settings/notifications` preference page.

**Architecture:** Signal-based `NotificationService` consistent with Phase 3; `NotificationBellComponent` imported into the existing `TopbarComponent`; backend adds Redis publish after notification INSERT and a `notification-broadcaster.ts` that emits `notification:new` to Socket.IO user rooms; `push.service.ts` wraps `web-push` for browser Push API with VAPID keys.

**Tech Stack:** Angular 17 (standalone components, signals), Angular Material, Socket.IO, ioredis (psubscribe), `web-push` npm package, Browser Push API + Service Worker

---

## File Map

### Backend — New
| File | Responsibility |
|---|---|
| `migrations/018_push_subscriptions.js` | push_subscriptions table |
| `src/modules/notification/push.service.ts` | VAPID send, subscription CRUD |
| `src/modules/notification/push.router.ts` | POST/DELETE /push/subscribe |
| `src/shared/realtime/notification-broadcaster.ts` | Redis psubscribe → Socket.IO emit |

### Backend — Modified
| File | Change |
|---|---|
| `src/modules/notification/notification.repository.ts` | publish to Redis after INSERT |
| `src/app.ts` | wire `startNotificationBroadcaster`, mount push router |

### Frontend — New
| File | Responsibility |
|---|---|
| `frontend/src/app/core/models/notification.model.ts` | Notification + NotificationPreference interfaces + mapper |
| `frontend/src/app/core/services/notification.service.ts` | signals: notifications[], unreadCount, loading; load/markRead/markAllRead/subscribeRealtime |
| `frontend/src/app/core/services/notification.service.spec.ts` | TDD |
| `frontend/src/app/core/services/push-notification.service.ts` | SW registration, VAPID subscribe/unsubscribe |
| `frontend/src/app/core/services/push-notification.service.spec.ts` | TDD |
| `frontend/src/app/features/notifications/notification-bell/notification-bell.component.ts` | bell icon + badge + panel toggle |
| `frontend/src/app/features/notifications/notification-bell/notification-bell.component.spec.ts` | TDD |
| `frontend/src/app/features/notifications/notification-panel/notification-panel.component.ts` | tabbed dropdown (All/Unread/Mentions) |
| `frontend/src/app/features/notifications/notification-panel/notification-panel.component.spec.ts` | TDD |
| `frontend/src/app/features/notifications/notification-item/notification-item.component.ts` | single notification row |
| `frontend/src/app/features/notifications/notification-preferences/notification-preferences.component.ts` | /app/settings/notifications page |
| `frontend/src/app/features/notifications/notification-preferences/notification-preferences.component.spec.ts` | TDD |
| `frontend/src/sw.js` | service worker for browser push |

### Frontend — Modified
| File | Change |
|---|---|
| `frontend/src/environments/environment.ts` | add vapidPublicKey |
| `frontend/src/environments/environment.prod.ts` | add vapidPublicKey |
| `frontend/src/app/features/shell/components/topbar/topbar.component.ts` | import NotificationBellComponent |
| `frontend/src/app/features/shell/shell.routes.ts` | add settings/notifications lazy route |
| `frontend/angular.json` | add sw.js to assets |

---

## Task 1: Migration 018 — push_subscriptions

**Files:**
- Create: `migrations/018_push_subscriptions.js`

- [ ] **Step 1: Create migration file**

```javascript
// migrations/018_push_subscriptions.js
'use strict';

exports.up = async (sql) => {
  await sql`
    CREATE TABLE push_subscriptions (
      id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      org_id     UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      endpoint   TEXT        NOT NULL,
      p256dh     TEXT        NOT NULL,
      auth       TEXT        NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, endpoint)
    )
  `;
};

exports.down = async (sql) => {
  await sql`DROP TABLE IF EXISTS push_subscriptions`;
};
```

- [ ] **Step 2: Apply migration**

```bash
npm run migrate:up
```

Expected: migration 018 applied with no errors.

- [ ] **Step 3: Commit**

```bash
git add migrations/018_push_subscriptions.js
git commit -m "task 1: migration 018 — push_subscriptions table"
```

---

## Task 2: Backend — push.service.ts (TDD)

**Files:**
- Create: `src/modules/notification/push.service.ts`
- Create: `tests/unit/notification/push.service.test.ts`

- [ ] **Step 1: Install web-push**

```bash
npm install web-push
npm install --save-dev @types/web-push
```

- [ ] **Step 2: Write the failing tests**

Create `tests/unit/notification/push.service.test.ts`:

```typescript
// tests/unit/notification/push.service.test.ts
jest.mock('src/shared/database/pool', () => ({
  queryPrimary: jest.fn(),
  queryReplica:  jest.fn(),
}));
jest.mock('src/shared/config', () => ({
  config: { logLevel: 'silent', nodeEnv: 'test', vapidPublicKey: 'pub', vapidPrivateKey: 'priv', vapidContact: 'mailto:test@test.com' },
}));
jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

import { queryPrimary } from 'src/shared/database/pool';
import webpush from 'web-push';
import { saveSubscription, removeSubscription, sendPush } from 'src/modules/notification/push.service';

const mockQuery = queryPrimary as jest.Mock;
const mockSend  = webpush.sendNotification as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('saveSubscription', () => {
  it('upserts subscription row', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await saveSubscription('user-1', 'org-1', { endpoint: 'https://ep', keys: { p256dh: 'p', auth: 'a' } });
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO push_subscriptions'),
      ['user-1', 'org-1', 'https://ep', 'p', 'a'],
    );
  });
});

describe('removeSubscription', () => {
  it('deletes subscription by endpoint', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await removeSubscription('user-1', 'https://ep');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM push_subscriptions'),
      ['user-1', 'https://ep'],
    );
  });
});

describe('sendPush', () => {
  it('sends push to each subscription', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [
      { endpoint: 'https://ep', p256dh: 'p', auth: 'a' },
    ]});
    mockSend.mockResolvedValueOnce({});
    await sendPush('user-1', { title: 'New notification', body: 'Test' });
    expect(mockSend).toHaveBeenCalledWith(
      { endpoint: 'https://ep', keys: { p256dh: 'p', auth: 'a' } },
      JSON.stringify({ title: 'New notification', body: 'Test' }),
    );
  });

  it('silently deletes expired subscription on 410', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ endpoint: 'https://gone', p256dh: 'p', auth: 'a' }] })
      .mockResolvedValueOnce({ rows: [] }); // DELETE call
    const err = Object.assign(new Error('Gone'), { statusCode: 410 });
    mockSend.mockRejectedValueOnce(err);
    await expect(sendPush('user-1', { title: 'Test', body: '' })).resolves.not.toThrow();
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM push_subscriptions'),
      expect.arrayContaining(['https://gone']),
    );
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL**

```bash
npm run test:unit -- --testPathPattern="push.service"
```

Expected: `FAIL — Cannot find module 'src/modules/notification/push.service'`

- [ ] **Step 4: Implement push.service.ts**

Create `src/modules/notification/push.service.ts`:

```typescript
// src/modules/notification/push.service.ts
import webpush from 'web-push';
import { queryPrimary } from '../../shared/database/pool';
import { config } from '../../shared/config';

webpush.setVapidDetails(
  config.vapidContact,
  config.vapidPublicKey,
  config.vapidPrivateKey,
);

export interface PushSubscriptionData {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function saveSubscription(
  userId: string,
  orgId: string,
  sub: PushSubscriptionData,
): Promise<void> {
  await queryPrimary(
    `INSERT INTO push_subscriptions (user_id, org_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, endpoint) DO UPDATE
       SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [userId, orgId, sub.endpoint, sub.keys.p256dh, sub.keys.auth],
  );
}

export async function removeSubscription(userId: string, endpoint: string): Promise<void> {
  await queryPrimary(
    `DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2`,
    [userId, endpoint],
  );
}

export async function sendPush(userId: string, payload: object): Promise<void> {
  const { rows } = await queryPrimary<{ endpoint: string; p256dh: string; auth: string }>(
    `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`,
    [userId],
  );
  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          JSON.stringify(payload),
        );
      } catch (err: unknown) {
        if ((err as { statusCode?: number }).statusCode === 410) {
          await queryPrimary(
            `DELETE FROM push_subscriptions WHERE endpoint = $1`,
            [row.endpoint],
          );
        }
      }
    }),
  );
}
```

- [ ] **Step 5: Add VAPID config fields to `src/shared/config.ts`**

Open `src/shared/config.ts` and add three fields to the Zod schema:

```typescript
vapidPublicKey:  z.string().default(''),
vapidPrivateKey: z.string().default(''),
vapidContact:    z.string().default('mailto:admin@example.com'),
```

Add to the `.env.example`:
```
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_CONTACT=mailto:admin@example.com
```

- [ ] **Step 6: Run tests — expect PASS**

```bash
npm run test:unit -- --testPathPattern="push.service"
```

Expected: `PASS — 4 tests passed`

- [ ] **Step 7: Commit**

```bash
git add src/modules/notification/push.service.ts tests/unit/notification/push.service.test.ts src/shared/config.ts .env.example
git commit -m "task 2: push.service.ts — VAPID send, subscription CRUD (TDD)"
```

---

## Task 3: Backend — push.router.ts

**Files:**
- Create: `src/modules/notification/push.router.ts`

- [ ] **Step 1: Create push.router.ts**

```typescript
// src/modules/notification/push.router.ts
import { Router } from 'express';
import { jwtMiddleware } from '../../shared/auth-middleware/jwt.middleware';
import { orgContextMiddleware } from '../../shared/org-context/org-context.middleware';
import { saveSubscription, removeSubscription, PushSubscriptionData } from './push.service';
import { idempotencyMiddleware } from '../../shared/idempotency/idempotency.middleware';

export const pushRouter = Router();

pushRouter.post(
  '/push/subscribe',
  jwtMiddleware,
  orgContextMiddleware,
  idempotencyMiddleware,
  async (req, res, next) => {
    try {
      const { endpoint, keys } = req.body as PushSubscriptionData;
      await saveSubscription(req.user.userId, req.user.orgId, { endpoint, keys });
      res.created({ subscribed: true });
    } catch (err) { next(err); }
  },
);

pushRouter.delete(
  '/push/subscribe',
  jwtMiddleware,
  orgContextMiddleware,
  async (req, res, next) => {
    try {
      const { endpoint } = req.body as { endpoint: string };
      await removeSubscription(req.user.userId, endpoint);
      res.success({ unsubscribed: true });
    } catch (err) { next(err); }
  },
);
```

- [ ] **Step 2: Mount push router in app.ts**

Open `src/app.ts`. Find where other routers are mounted (e.g. `app.use('/api/v1', notificationRouter)`). Add:

```typescript
import { pushRouter } from './modules/notification/push.router';
// ...
app.use('/api/v1', pushRouter);
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/notification/push.router.ts src/app.ts
git commit -m "task 3: push.router.ts — POST/DELETE /push/subscribe"
```

---

## Task 4: Backend — Redis publish after notification INSERT

**Files:**
- Modify: `src/modules/notification/notification.repository.ts`

- [ ] **Step 1: Add Redis publish to notification.repository.ts**

Open `src/modules/notification/notification.repository.ts`. Find the `create()` method that executes the INSERT INTO notifications query. Add the Redis publish after the INSERT:

```typescript
// Add this import at the top of the file (alongside existing redis imports):
import { redisClient } from '../../shared/redis/clients';

// Inside the create() method, after the INSERT RETURNING * query:
// Replace the existing return with:
const row = rows[0];
await redisClient.publish(
  `notification:${row.org_id}:user:${row.user_id}`,
  JSON.stringify(row),
);
return row;
```

The full modified `create()` method should look like:

```typescript
async create(data: {
  orgId: string; userId: string; type: string;
  entityType: string; entityId: string; actorId: string;
  payload: Record<string, unknown>;
}): Promise<NotificationRow> {
  const { rows } = await queryPrimary<NotificationRow>(
    `INSERT INTO notifications (org_id, user_id, type, entity_type, entity_id, actor_id, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     RETURNING *`,
    [data.orgId, data.userId, data.type, data.entityType, data.entityId, data.actorId, JSON.stringify(data.payload)],
  );
  const row = rows[0];
  await redisClient.publish(
    `notification:${row.org_id}:user:${row.user_id}`,
    JSON.stringify(row),
  );
  return row;
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/notification/notification.repository.ts
git commit -m "task 4: notification.repository — publish to Redis after INSERT"
```

---

## Task 5: Backend — notification-broadcaster.ts

**Files:**
- Create: `src/shared/realtime/notification-broadcaster.ts`
- Modify: `src/app.ts`

- [ ] **Step 1: Create notification-broadcaster.ts**

```typescript
// src/shared/realtime/notification-broadcaster.ts
import { Server } from 'socket.io';
import { redisPubSubClient } from '../redis/clients';

export async function startNotificationBroadcaster(io: Server): Promise<void> {
  redisPubSubClient.on('pmessage', (_pattern: string, channel: string, message: string) => {
    // channel format: notification:{orgId}:user:{userId}
    const parts  = channel.split(':');
    const orgId  = parts[1];
    const userId = parts[3];
    try {
      const row = JSON.parse(message) as Record<string, unknown>;
      io.to(`org:${orgId}:user:${userId}`).emit('notification:new', row);
    } catch {
      // malformed message — ignore
    }
  });
  await redisPubSubClient.psubscribe('notification:*');
}
```

- [ ] **Step 2: Wire into app.ts**

Open `src/app.ts`. Find where `startChatBroadcaster` or `startTaskBroadcaster` is called (in the `io.on('connection', ...)` block or server start). Add:

```typescript
import { startNotificationBroadcaster } from './shared/realtime/notification-broadcaster';
// ...
// alongside the other broadcaster starts:
await startNotificationBroadcaster(io);
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/shared/realtime/notification-broadcaster.ts src/app.ts
git commit -m "task 5: notification-broadcaster — Redis psubscribe → Socket.IO notification:new"
```

---

## Task 6: Frontend — notification.model.ts

**Files:**
- Create: `frontend/src/app/core/models/notification.model.ts`

- [ ] **Step 1: Create notification.model.ts**

```typescript
// frontend/src/app/core/models/notification.model.ts

export interface NotificationDto {
  id: string;
  org_id: string;
  user_id: string;
  type: string;
  entity_type: string;
  entity_id: string;
  actor_id: string;
  payload: Record<string, unknown>;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

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

export function toNotification(dto: NotificationDto): Notification {
  return {
    id:         dto.id,
    orgId:      dto.org_id,
    userId:     dto.user_id,
    type:       dto.type,
    entityType: dto.entity_type,
    entityId:   dto.entity_id,
    actorId:    dto.actor_id,
    payload:    dto.payload,
    isRead:     dto.is_read,
    readAt:     dto.read_at,
    createdAt:  dto.created_at,
  };
}

export interface NotificationPreferenceDto {
  event_type: string;
  channel_inapp: boolean;
  channel_email: boolean;
  channel_push: boolean;
  digest_mode: 'realtime' | 'daily_digest';
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
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

export function toNotificationPreference(dto: NotificationPreferenceDto): NotificationPreference {
  return {
    eventType:       dto.event_type,
    channelInapp:    dto.channel_inapp,
    channelEmail:    dto.channel_email,
    channelPush:     dto.channel_push,
    digestMode:      dto.digest_mode,
    quietHoursStart: dto.quiet_hours_start,
    quietHoursEnd:   dto.quiet_hours_end,
  };
}
```

- [ ] **Step 2: Update environment files**

Edit `frontend/src/environments/environment.ts` — add `vapidPublicKey`:

```typescript
export const environment = {
  production:    false,
  apiUrl:        '',
  wsUrl:         'http://localhost:3000',
  razorpayKeyId: '',
  vapidPublicKey: '',
};
```

If `frontend/src/environments/environment.prod.ts` exists, add the same field:

```typescript
vapidPublicKey: process.env['VAPID_PUBLIC_KEY'] ?? '',
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/core/models/notification.model.ts frontend/src/environments/
git commit -m "task 6: notification.model.ts — Notification + NotificationPreference interfaces and mappers"
```

---

## Task 7: Frontend — NotificationService (TDD)

**Files:**
- Create: `frontend/src/app/core/services/notification.service.spec.ts`
- Create: `frontend/src/app/core/services/notification.service.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/app/core/services/notification.service.spec.ts`:

```typescript
// frontend/src/app/core/services/notification.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { of, Subscription } from 'rxjs';
import { NotificationService } from './notification.service';
import { TenantService } from './tenant.service';
import { SocketService } from './socket.service';
import { NotificationDto } from '../models/notification.model';

const DTO: NotificationDto = {
  id: 'n-1', org_id: 'org-1', user_id: 'u-1',
  type: 'task.assigned', entity_type: 'task', entity_id: 't-1',
  actor_id: 'u-2', payload: {}, is_read: false,
  read_at: null, created_at: '2024-01-01T10:00:00Z',
};

describe('NotificationService', () => {
  let svc: NotificationService;
  let http: HttpTestingController;
  let tenant: { activeOrgId: jest.Mock };
  let socket: { fromEvent: jest.Mock };

  beforeEach(() => {
    tenant = { activeOrgId: jest.fn().mockReturnValue('org-1') };
    socket = { fromEvent: jest.fn().mockReturnValue(of()) };

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        NotificationService,
        { provide: TenantService,  useValue: tenant },
        { provide: SocketService,   useValue: socket },
      ],
    });
    svc  = TestBed.inject(NotificationService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('load() populates notifications signal', () => {
    svc.load().subscribe();
    http.expectOne('/api/v1/orgs/org-1/notifications?limit=20')
      .flush({ data: [DTO], error: null, meta: {} });
    expect(svc.notifications().length).toBe(1);
    expect(svc.notifications()[0].id).toBe('n-1');
  });

  it('load() sets unreadCount from response', () => {
    svc.load().subscribe();
    http.expectOne('/api/v1/orgs/org-1/notifications?limit=20')
      .flush({ data: [DTO], error: null, meta: {} });
    expect(svc.unreadCount()).toBe(1);
  });

  it('markRead() optimistically updates isRead and sends PATCH', () => {
    svc.notifications.set([{ ...DTO, id: 'n-1', isRead: false } as never]);
    svc.markRead('n-1').subscribe();
    expect(svc.notifications()[0].isRead).toBe(true);
    http.expectOne('/api/v1/orgs/org-1/notifications/n-1/read').flush({ data: {}, error: null, meta: {} });
  });

  it('markRead() reverts on error', () => {
    svc.notifications.set([{ id: 'n-1', isRead: false, orgId: 'org-1' } as never]);
    svc.markRead('n-1').subscribe({ error: () => {} });
    http.expectOne('/api/v1/orgs/org-1/notifications/n-1/read').flush('err', { status: 500, statusText: 'Error' });
    expect(svc.notifications()[0].isRead).toBe(false);
  });

  it('markAllRead() clears unreadCount optimistically', () => {
    svc.notifications.set([{ id: 'n-1', isRead: false } as never]);
    svc.markAllRead().subscribe();
    expect(svc.unreadCount()).toBe(0);
    http.expectOne('/api/v1/orgs/org-1/notifications/read-all').flush({ data: {}, error: null, meta: {} });
  });

  it('subscribeRealtime() prepends incoming notification and increments count', () => {
    const subject$ = of(DTO);
    socket.fromEvent.mockReturnValue(subject$);
    const sub: Subscription = svc.subscribeRealtime();
    expect(svc.notifications().length).toBe(1);
    expect(svc.unreadCount()).toBe(1);
    sub.unsubscribe();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="notification.service.spec"
```

Expected: `FAIL — Cannot find module './notification.service'`

- [ ] **Step 3: Implement NotificationService**

Create `frontend/src/app/core/services/notification.service.ts`:

```typescript
// frontend/src/app/core/services/notification.service.ts
import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, EMPTY, throwError, Subscription } from 'rxjs';
import { map, tap, catchError } from 'rxjs/operators';
import { TenantService } from './tenant.service';
import { SocketService } from './socket.service';
import { ApiResponse } from '../models/api-response.model';
import { Notification, NotificationDto, toNotification } from '../models/notification.model';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private http   = inject(HttpClient);
  private tenant = inject(TenantService);
  private socket = inject(SocketService);

  readonly notifications = signal<Notification[]>([]);
  readonly unreadCount   = signal(0);
  readonly loading       = signal(false);

  load(limit = 20): Observable<Notification[]> {
    const orgId = this.tenant.activeOrgId();
    if (!orgId) return EMPTY;
    this.loading.set(true);
    return this.http
      .get<ApiResponse<NotificationDto[]>>(`/api/v1/orgs/${orgId}/notifications?limit=${limit}`)
      .pipe(
        map(res => res.data.map(toNotification)),
        tap(items => {
          this.notifications.set(items);
          this.unreadCount.set(items.filter(n => !n.isRead).length);
          this.loading.set(false);
        }),
        catchError(err => { this.loading.set(false); return throwError(() => err); }),
      );
  }

  markRead(id: string): Observable<void> {
    const orgId    = this.tenant.activeOrgId()!;
    const snapshot = this.notifications();
    this.notifications.update(ns => ns.map(n => n.id === id ? { ...n, isRead: true } : n));
    this.unreadCount.set(this.notifications().filter(n => !n.isRead).length);
    return this.http
      .patch<ApiResponse<unknown>>(`/api/v1/orgs/${orgId}/notifications/${id}/read`, {})
      .pipe(
        map(() => undefined),
        catchError(err => {
          this.notifications.set(snapshot);
          this.unreadCount.set(snapshot.filter(n => !n.isRead).length);
          return throwError(() => err);
        }),
      );
  }

  markAllRead(): Observable<void> {
    const orgId    = this.tenant.activeOrgId()!;
    const snapshot = this.notifications();
    this.notifications.update(ns => ns.map(n => ({ ...n, isRead: true })));
    this.unreadCount.set(0);
    return this.http
      .post<ApiResponse<unknown>>(`/api/v1/orgs/${orgId}/notifications/read-all`, {})
      .pipe(
        map(() => undefined),
        catchError(err => {
          this.notifications.set(snapshot);
          this.unreadCount.set(snapshot.filter(n => !n.isRead).length);
          return throwError(() => err);
        }),
      );
  }

  subscribeRealtime(): Subscription {
    return this.socket.fromEvent<NotificationDto>('notification:new').subscribe(dto => {
      const n = toNotification(dto);
      this.notifications.update(ns => [n, ...ns]);
      this.unreadCount.update(c => c + 1);
    });
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="notification.service.spec"
```

Expected: `PASS — 6 tests passed`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/core/services/notification.service.ts \
        frontend/src/app/core/services/notification.service.spec.ts
git commit -m "task 7: NotificationService — load, markRead, markAllRead, subscribeRealtime (TDD)"
```

---

## Task 8: Frontend — PushNotificationService (TDD)

**Files:**
- Create: `frontend/src/app/core/services/push-notification.service.spec.ts`
- Create: `frontend/src/app/core/services/push-notification.service.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/app/core/services/push-notification.service.spec.ts`:

```typescript
// frontend/src/app/core/services/push-notification.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { PushNotificationService } from './push-notification.service';

const MOCK_SUB = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/test',
  getKey: (name: string) => name === 'p256dh'
    ? new Uint8Array([1, 2, 3]).buffer
    : new Uint8Array([4, 5, 6]).buffer,
};

describe('PushNotificationService', () => {
  let svc: PushNotificationService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [PushNotificationService],
    });
    svc  = TestBed.inject(PushNotificationService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('isSupported() returns false when serviceWorker API absent', () => {
    const orig = (navigator as { serviceWorker?: unknown }).serviceWorker;
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    expect(svc.isSupported()).toBe(false);
    (navigator as { serviceWorker?: unknown }).serviceWorker = orig;
  });

  it('permissionDenied signal starts false', () => {
    expect(svc.permissionDenied()).toBe(false);
  });

  it('requestPermission() posts to /push/subscribe with subscription keys', async () => {
    const mockReg = {
      pushManager: {
        getSubscription: jest.fn().mockResolvedValue(null),
        subscribe: jest.fn().mockResolvedValue(MOCK_SUB),
      },
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register: jest.fn().mockResolvedValue(mockReg) },
      configurable: true,
    });
    const p = svc.requestPermission().toPromise();
    await Promise.resolve();
    http.expectOne('/api/v1/push/subscribe').flush({ data: { subscribed: true }, error: null, meta: {} });
    await p;
    expect(mockReg.pushManager.subscribe).toHaveBeenCalled();
  });

  it('unsubscribe() calls DELETE /push/subscribe', () => {
    const mockReg = {
      pushManager: {
        getSubscription: jest.fn().mockResolvedValue({ ...MOCK_SUB, unsubscribe: jest.fn().mockResolvedValue(true) }),
      },
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register: jest.fn().mockResolvedValue(mockReg), ready: Promise.resolve(mockReg) },
      configurable: true,
    });
    svc.unsubscribe().subscribe();
    http.expectOne(req => req.method === 'DELETE' && req.url === '/api/v1/push/subscribe')
      .flush({ data: { unsubscribed: true }, error: null, meta: {} });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="push-notification.service.spec"
```

Expected: `FAIL — Cannot find module './push-notification.service'`

- [ ] **Step 3: Implement PushNotificationService**

Create `frontend/src/app/core/services/push-notification.service.ts`:

```typescript
// frontend/src/app/core/services/push-notification.service.ts
import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, from, switchMap, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/api-response.model';

@Injectable({ providedIn: 'root' })
export class PushNotificationService {
  private http = inject(HttpClient);

  readonly permissionDenied = signal(false);

  isSupported(): boolean {
    return 'serviceWorker' in navigator && 'PushManager' in window;
  }

  requestPermission(): Observable<void> {
    return from(
      navigator.serviceWorker.register('/sw.js').then(async reg => {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          this.permissionDenied.set(true);
          throw new Error('Push permission denied');
        }
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: this.urlBase64ToUint8Array(environment.vapidPublicKey),
          });
        }
        return sub;
      }),
    ).pipe(
      switchMap(sub => {
        const p256dh = this.arrayBufferToBase64(sub.getKey('p256dh')!);
        const auth   = this.arrayBufferToBase64(sub.getKey('auth')!);
        return this.http.post<ApiResponse<unknown>>('/api/v1/push/subscribe', {
          endpoint: sub.endpoint,
          keys: { p256dh, auth },
        });
      }),
      map(() => undefined),
    );
  }

  unsubscribe(): Observable<void> {
    return from(
      navigator.serviceWorker.ready.then(reg => reg.pushManager.getSubscription()),
    ).pipe(
      switchMap(sub => {
        const endpoint = sub?.endpoint ?? '';
        sub?.unsubscribe();
        return this.http.delete<ApiResponse<unknown>>('/api/v1/push/subscribe', { body: { endpoint } });
      }),
      map(() => undefined),
    );
  }

  private urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw     = atob(base64);
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="push-notification.service.spec"
```

Expected: `PASS — 4 tests passed`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/core/services/push-notification.service.ts \
        frontend/src/app/core/services/push-notification.service.spec.ts
git commit -m "task 8: PushNotificationService — SW registration, VAPID subscribe/unsubscribe (TDD)"
```

---

## Task 9: Frontend — NotificationBellComponent (TDD)

**Files:**
- Create: `frontend/src/app/features/notifications/notification-bell/notification-bell.component.spec.ts`
- Create: `frontend/src/app/features/notifications/notification-bell/notification-bell.component.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/app/features/notifications/notification-bell/notification-bell.component.spec.ts`:

```typescript
// frontend/src/app/features/notifications/notification-bell/notification-bell.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { NotificationBellComponent } from './notification-bell.component';
import { NotificationService } from '../../../core/services/notification.service';

describe('NotificationBellComponent', () => {
  let fixture: ComponentFixture<NotificationBellComponent>;
  let notifSvc: { unreadCount: ReturnType<typeof signal<number>>; load: jest.Mock; subscribeRealtime: jest.Mock };

  beforeEach(async () => {
    notifSvc = {
      unreadCount:       signal(0),
      load:              jest.fn().mockReturnValue({ subscribe: jest.fn() }),
      subscribeRealtime: jest.fn().mockReturnValue({ unsubscribe: jest.fn() }),
    };

    await TestBed.configureTestingModule({
      imports: [NotificationBellComponent],
      providers: [
        { provide: NotificationService, useValue: notifSvc },
        provideRouter([]),
        provideAnimations(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NotificationBellComponent);
    fixture.detectChanges();
  });

  it('hides badge when unreadCount is 0', () => {
    notifSvc.unreadCount.set(0);
    fixture.detectChanges();
    const badge = fixture.nativeElement.querySelector('.notif-badge');
    expect(badge).toBeFalsy();
  });

  it('shows badge with count when unreadCount > 0', () => {
    notifSvc.unreadCount.set(3);
    fixture.detectChanges();
    const badge = fixture.nativeElement.querySelector('.notif-badge');
    expect(badge).toBeTruthy();
    expect(badge.textContent.trim()).toBe('3');
  });

  it('toggles panel open on bell button click', () => {
    const btn = fixture.nativeElement.querySelector('.notif-bell-btn');
    btn.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-notification-panel')).toBeTruthy();
  });

  it('closes panel on second click', () => {
    const btn = fixture.nativeElement.querySelector('.notif-bell-btn');
    btn.click(); fixture.detectChanges();
    btn.click(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-notification-panel')).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="notification-bell.component.spec"
```

Expected: `FAIL — Cannot find module './notification-bell.component'`

- [ ] **Step 3: Implement NotificationBellComponent**

Create `frontend/src/app/features/notifications/notification-bell/notification-bell.component.ts`:

```typescript
// frontend/src/app/features/notifications/notification-bell/notification-bell.component.ts
import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { NotificationService } from '../../../core/services/notification.service';
import { NotificationPanelComponent } from '../notification-panel/notification-panel.component';

@Component({
  selector: 'app-notification-bell',
  standalone: true,
  imports: [CommonModule, NotificationPanelComponent],
  template: `
    <div class="notif-bell-wrapper">
      <button class="notif-bell-btn" (click)="togglePanel()" aria-label="Notifications">
        🔔
        @if (unreadCount() > 0) {
          <span class="notif-badge">{{ unreadCount() }}</span>
        }
      </button>

      @if (panelOpen()) {
        <app-notification-panel (close)="panelOpen.set(false)" />
      }
    </div>
  `,
})
export class NotificationBellComponent implements OnInit, OnDestroy {
  private notifSvc = inject(NotificationService);

  readonly unreadCount = this.notifSvc.unreadCount;
  readonly panelOpen   = signal(false);

  private realtimeSub?: Subscription;

  ngOnInit(): void {
    this.notifSvc.load().subscribe();
    this.realtimeSub = this.notifSvc.subscribeRealtime();
  }

  ngOnDestroy(): void {
    this.realtimeSub?.unsubscribe();
  }

  togglePanel(): void {
    this.panelOpen.update(v => !v);
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="notification-bell.component.spec"
```

Expected: `PASS — 4 tests passed`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/features/notifications/notification-bell/
git commit -m "task 9: NotificationBellComponent — bell icon, unread badge, panel toggle (TDD)"
```

---

## Task 10: Frontend — NotificationPanelComponent (TDD)

**Files:**
- Create: `frontend/src/app/features/notifications/notification-panel/notification-panel.component.spec.ts`
- Create: `frontend/src/app/features/notifications/notification-panel/notification-panel.component.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/app/features/notifications/notification-panel/notification-panel.component.spec.ts`:

```typescript
// frontend/src/app/features/notifications/notification-panel/notification-panel.component.spec.ts
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { NotificationPanelComponent } from './notification-panel.component';
import { NotificationService } from '../../../core/services/notification.service';
import { Notification } from '../../../core/models/notification.model';

const N: Notification = {
  id: 'n-1', orgId: 'org-1', userId: 'u-1',
  type: 'task.assigned', entityType: 'task', entityId: 't-1',
  actorId: 'u-2', payload: { workspaceId: 'ws-1' },
  isRead: false, readAt: null, createdAt: '2024-01-01T10:00:00Z',
};

describe('NotificationPanelComponent', () => {
  let fixture: ComponentFixture<NotificationPanelComponent>;
  let notifSvc: {
    notifications: ReturnType<typeof signal<Notification[]>>;
    loading: ReturnType<typeof signal<boolean>>;
    markRead: jest.Mock;
    markAllRead: jest.Mock;
  };

  beforeEach(async () => {
    notifSvc = {
      notifications: signal<Notification[]>([]),
      loading:       signal(false),
      markRead:      jest.fn().mockReturnValue(of(undefined)),
      markAllRead:   jest.fn().mockReturnValue(of(undefined)),
    };

    await TestBed.configureTestingModule({
      imports: [NotificationPanelComponent],
      providers: [
        { provide: NotificationService, useValue: notifSvc },
        provideRouter([]),
        provideAnimations(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NotificationPanelComponent);
    fixture.detectChanges();
  });

  it('renders All tab by default', () => {
    expect(fixture.nativeElement.querySelector('.notif-tab--active').textContent).toContain('All');
  });

  it('Unread tab filters to unread notifications only', fakeAsync(() => {
    notifSvc.notifications.set([N, { ...N, id: 'n-2', isRead: true }]);
    fixture.detectChanges();
    const tabs = fixture.nativeElement.querySelectorAll('.notif-tab');
    tabs[1].click(); // Unread tab
    fixture.detectChanges();
    tick();
    const rows = fixture.nativeElement.querySelectorAll('app-notification-item');
    expect(rows.length).toBe(1);
  }));

  it('Mentions tab filters to mention type notifications', fakeAsync(() => {
    notifSvc.notifications.set([N, { ...N, id: 'n-3', type: 'chat.mention', isRead: false }]);
    fixture.detectChanges();
    const tabs = fixture.nativeElement.querySelectorAll('.notif-tab');
    tabs[2].click(); // Mentions tab
    fixture.detectChanges();
    tick();
    const rows = fixture.nativeElement.querySelectorAll('app-notification-item');
    expect(rows.length).toBe(1);
  }));

  it('Mark all read button calls markAllRead()', fakeAsync(() => {
    notifSvc.notifications.set([N]);
    fixture.detectChanges();
    fixture.nativeElement.querySelector('.notif-mark-all-btn').click();
    tick();
    expect(notifSvc.markAllRead).toHaveBeenCalled();
  }));
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="notification-panel.component.spec"
```

Expected: `FAIL — Cannot find module './notification-panel.component'`

- [ ] **Step 3: Implement NotificationPanelComponent**

Create `frontend/src/app/features/notifications/notification-panel/notification-panel.component.ts`:

```typescript
// frontend/src/app/features/notifications/notification-panel/notification-panel.component.ts
import { Component, computed, inject, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { NotificationService } from '../../../core/services/notification.service';
import { Notification } from '../../../core/models/notification.model';
import { NotificationItemComponent } from '../notification-item/notification-item.component';

type Tab = 'all' | 'unread' | 'mentions';

const MENTION_TYPES = ['task.mentioned', 'chat.mention', 'comment.mentioned'];

@Component({
  selector: 'app-notification-panel',
  standalone: true,
  imports: [CommonModule, RouterLink, NotificationItemComponent],
  template: `
    <div class="notif-panel">
      <div class="notif-panel-header">
        <span class="notif-panel-title">Notifications</span>
        <button class="notif-mark-all-btn" (click)="markAllRead()">Mark all read</button>
      </div>

      <div class="notif-tabs">
        <button
          class="notif-tab"
          [class.notif-tab--active]="activeTab() === 'all'"
          (click)="activeTab.set('all')"
        >All</button>
        <button
          class="notif-tab"
          [class.notif-tab--active]="activeTab() === 'unread'"
          (click)="activeTab.set('unread')"
        >Unread <span class="notif-tab-badge">{{ unreadCount() }}</span></button>
        <button
          class="notif-tab"
          [class.notif-tab--active]="activeTab() === 'mentions'"
          (click)="activeTab.set('mentions')"
        >Mentions</button>
      </div>

      <div class="notif-list">
        @for (n of filtered(); track n.id) {
          <app-notification-item [notification]="n" (read)="markRead(n.id)" />
        }
        @if (filtered().length === 0) {
          <div class="notif-empty">No notifications</div>
        }
      </div>

      <div class="notif-panel-footer">
        <a routerLink="/app/settings/notifications" (click)="closed.emit()">⚙ Preferences</a>
      </div>
    </div>
  `,
})
export class NotificationPanelComponent {
  private notifSvc = inject(NotificationService);

  readonly closed = output<void>();
  readonly activeTab = signal<Tab>('all');

  private notifications = this.notifSvc.notifications;
  readonly unreadCount  = computed(() => this.notifications().filter(n => !n.isRead).length);

  readonly filtered = computed<Notification[]>(() => {
    const tab = this.activeTab();
    const all = this.notifications();
    if (tab === 'unread')   return all.filter(n => !n.isRead);
    if (tab === 'mentions') return all.filter(n => MENTION_TYPES.includes(n.type));
    return all;
  });

  markRead(id: string): void {
    this.notifSvc.markRead(id).subscribe();
  }

  markAllRead(): void {
    this.notifSvc.markAllRead().subscribe();
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="notification-panel.component.spec"
```

Expected: `PASS — 4 tests passed`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/features/notifications/notification-panel/
git commit -m "task 10: NotificationPanelComponent — All/Unread/Mentions tabs, mark all read (TDD)"
```

---

## Task 11: Frontend — NotificationItemComponent

**Files:**
- Create: `frontend/src/app/features/notifications/notification-item/notification-item.component.ts`

- [ ] **Step 1: Create NotificationItemComponent**

```typescript
// frontend/src/app/features/notifications/notification-item/notification-item.component.ts
import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { inject } from '@angular/core';
import { Notification } from '../../../core/models/notification.model';

const TYPE_LABELS: Record<string, string> = {
  'task.assigned':   'assigned you to',
  'task.mentioned':  'mentioned you in task',
  'task.completed':  'completed task',
  'chat.mention':    'mentioned you in',
  'comment.created': 'commented on',
};

@Component({
  selector: 'app-notification-item',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="notif-item"
      [class.notif-item--unread]="!notification().isRead"
      (click)="onClick()"
    >
      @if (!notification().isRead) {
        <span class="notif-dot"></span>
      }
      <div class="notif-item-body">
        <span class="notif-text">
          {{ label() }}
        </span>
        <span class="notif-time">{{ notification().createdAt | date:'shortTime' }}</span>
      </div>
    </div>
  `,
})
export class NotificationItemComponent {
  private router = inject(Router);

  readonly notification = input.required<Notification>();
  readonly read         = output<void>();

  label(): string {
    const n      = this.notification();
    const action = TYPE_LABELS[n.type] ?? n.type;
    const entity = (n.payload['entityTitle'] as string | undefined) ?? n.entityId;
    return `${action} ${entity}`;
  }

  onClick(): void {
    this.read.emit();
    const n           = this.notification();
    const workspaceId = n.payload['workspaceId'] as string | undefined;
    if (n.entityType === 'task' && workspaceId) {
      this.router.navigate(['/app/workspaces', workspaceId, 'tasks']);
    } else if (n.entityType === 'channel' && workspaceId) {
      this.router.navigate(['/app/workspaces', workspaceId, 'chat', n.entityId]);
    }
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.app.json
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/features/notifications/notification-item/
git commit -m "task 11: NotificationItemComponent — unread dot, label, click-to-navigate"
```

---

## Task 12: Frontend — NotificationPreferencesComponent (TDD)

**Files:**
- Create: `frontend/src/app/features/notifications/notification-preferences/notification-preferences.component.spec.ts`
- Create: `frontend/src/app/features/notifications/notification-preferences/notification-preferences.component.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/app/features/notifications/notification-preferences/notification-preferences.component.spec.ts`:

```typescript
// frontend/src/app/features/notifications/notification-preferences/notification-preferences.component.spec.ts
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { NotificationPreferencesComponent } from './notification-preferences.component';
import { TenantService } from '../../../core/services/tenant.service';
import { PushNotificationService } from '../../../core/services/push-notification.service';
import { NotificationPreferenceDto } from '../../../core/models/notification.model';

const PREF: NotificationPreferenceDto = {
  event_type: 'task.assigned', channel_inapp: true, channel_email: false,
  channel_push: false, digest_mode: 'realtime',
  quiet_hours_start: null, quiet_hours_end: null,
};

describe('NotificationPreferencesComponent', () => {
  let fixture: ComponentFixture<NotificationPreferencesComponent>;
  let http: HttpTestingController;
  let tenant: { activeOrgId: jest.Mock };
  let pushSvc: { isSupported: jest.Mock; permissionDenied: ReturnType<typeof signal<boolean>>; requestPermission: jest.Mock };

  beforeEach(async () => {
    tenant  = { activeOrgId: jest.fn().mockReturnValue('org-1') };
    pushSvc = {
      isSupported:       jest.fn().mockReturnValue(true),
      permissionDenied:  signal(false),
      requestPermission: jest.fn().mockReturnValue(of(undefined)),
    };

    await TestBed.configureTestingModule({
      imports: [NotificationPreferencesComponent, HttpClientTestingModule],
      providers: [
        { provide: TenantService,            useValue: tenant },
        { provide: PushNotificationService,  useValue: pushSvc },
        provideRouter([]),
        provideAnimations(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NotificationPreferencesComponent);
    fixture.detectChanges();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads preferences on init', fakeAsync(() => {
    http.expectOne('/api/v1/orgs/org-1/notification-preferences')
      .flush({ data: [PREF], error: null, meta: {} });
    tick();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('task.assigned');
  }));

  it('toggling a channel calls PATCH immediately', fakeAsync(() => {
    http.expectOne('/api/v1/orgs/org-1/notification-preferences')
      .flush({ data: [PREF], error: null, meta: {} });
    tick(); fixture.detectChanges();
    const toggle = fixture.nativeElement.querySelector('.pref-toggle-email');
    toggle.click();
    fixture.detectChanges();
    const req = http.expectOne('/api/v1/orgs/org-1/notification-preferences/task.assigned');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body.channel_email).toBe(true);
    req.flush({ data: {}, error: null, meta: {} });
  }));

  it('shows enable push button when supported and not denied', fakeAsync(() => {
    http.expectOne('/api/v1/orgs/org-1/notification-preferences')
      .flush({ data: [PREF], error: null, meta: {} });
    tick(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.push-enable-btn')).toBeTruthy();
  }));

  it('calls requestPermission() when push enable button clicked', fakeAsync(() => {
    http.expectOne('/api/v1/orgs/org-1/notification-preferences')
      .flush({ data: [PREF], error: null, meta: {} });
    tick(); fixture.detectChanges();
    fixture.nativeElement.querySelector('.push-enable-btn').click();
    expect(pushSvc.requestPermission).toHaveBeenCalled();
  }));

  it('shows blocked message when permissionDenied is true', fakeAsync(() => {
    pushSvc.permissionDenied.set(true);
    http.expectOne('/api/v1/orgs/org-1/notification-preferences')
      .flush({ data: [PREF], error: null, meta: {} });
    tick(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('blocked');
  }));
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="notification-preferences.component.spec"
```

Expected: `FAIL — Cannot find module './notification-preferences.component'`

- [ ] **Step 3: Implement NotificationPreferencesComponent**

Create `frontend/src/app/features/notifications/notification-preferences/notification-preferences.component.ts`:

```typescript
// frontend/src/app/features/notifications/notification-preferences/notification-preferences.component.ts
import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { TenantService } from '../../../core/services/tenant.service';
import { PushNotificationService } from '../../../core/services/push-notification.service';
import { ApiResponse } from '../../../core/models/api-response.model';
import {
  NotificationPreference,
  NotificationPreferenceDto,
  toNotificationPreference,
} from '../../../core/models/notification.model';

@Component({
  selector: 'app-notification-preferences',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="prefs-page">
      <h1 style="color:#f1f5f9;font-size:20px;font-weight:700;margin:0 0 1.5rem;">
        Notification preferences
      </h1>

      <!-- Push permission banner -->
      @if (pushSvc.isSupported()) {
        @if (pushSvc.permissionDenied()) {
          <div class="prefs-push-blocked">
            Browser notifications are blocked in your browser settings.
          </div>
        } @else {
          <button class="push-enable-btn" (click)="enablePush()">
            Enable browser notifications
          </button>
        }
      }

      <!-- Preferences grid -->
      <div class="prefs-grid">
        <div class="prefs-grid-header">
          <span>Event</span>
          <span>In-app</span>
          <span>Email</span>
          <span>Push</span>
        </div>

        @for (pref of preferences(); track pref.eventType) {
          <div class="prefs-row">
            <span class="pref-event-type">{{ pref.eventType }}</span>

            <button
              class="pref-toggle pref-toggle-inapp"
              [class.pref-toggle--on]="pref.channelInapp"
              (click)="toggle(pref, 'channelInapp')"
            >{{ pref.channelInapp ? 'On' : 'Off' }}</button>

            <button
              class="pref-toggle pref-toggle-email"
              [class.pref-toggle--on]="pref.channelEmail"
              (click)="toggle(pref, 'channelEmail')"
            >{{ pref.channelEmail ? 'On' : 'Off' }}</button>

            <button
              class="pref-toggle pref-toggle-push"
              [class.pref-toggle--on]="pref.channelPush"
              (click)="toggle(pref, 'channelPush')"
            >{{ pref.channelPush ? 'On' : 'Off' }}</button>
          </div>
        }
      </div>
    </div>
  `,
})
export class NotificationPreferencesComponent implements OnInit {
  private http   = inject(HttpClient);
  private tenant = inject(TenantService);
  readonly pushSvc = inject(PushNotificationService);

  readonly preferences = signal<NotificationPreference[]>([]);

  ngOnInit(): void {
    const orgId = this.tenant.activeOrgId()!;
    this.http
      .get<ApiResponse<NotificationPreferenceDto[]>>(`/api/v1/orgs/${orgId}/notification-preferences`)
      .subscribe(res => this.preferences.set(res.data.map(toNotificationPreference)));
  }

  toggle(pref: NotificationPreference, channel: 'channelInapp' | 'channelEmail' | 'channelPush'): void {
    const orgId   = this.tenant.activeOrgId()!;
    const updated = { ...pref, [channel]: !pref[channel] };
    this.preferences.update(ps => ps.map(p => p.eventType === pref.eventType ? updated : p));
    const body: Record<string, boolean> = {
      channel_inapp: updated.channelInapp,
      channel_email: updated.channelEmail,
      channel_push:  updated.channelPush,
    };
    this.http
      .patch<ApiResponse<unknown>>(
        `/api/v1/orgs/${orgId}/notification-preferences/${pref.eventType}`,
        body,
      )
      .subscribe();
  }

  enablePush(): void {
    this.pushSvc.requestPermission().subscribe();
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="notification-preferences.component.spec"
```

Expected: `PASS — 5 tests passed`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/features/notifications/notification-preferences/
git commit -m "task 12: NotificationPreferencesComponent — per-event toggles, push enable, blocked state (TDD)"
```

---

## Task 13: Frontend — Wire NotificationBellComponent into TopbarComponent

**Files:**
- Modify: `frontend/src/app/features/shell/components/topbar/topbar.component.ts`

- [ ] **Step 1: Update TopbarComponent**

Replace the content of `frontend/src/app/features/shell/components/topbar/topbar.component.ts`:

```typescript
// frontend/src/app/features/shell/components/topbar/topbar.component.ts
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TenantService } from '../../../../core/services/tenant.service';
import { SocketService } from '../../../../core/services/socket.service';
import { NotificationBellComponent } from '../../../notifications/notification-bell/notification-bell.component';

@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [CommonModule, NotificationBellComponent],
  template: `
    <span class="topbar-title">{{ org()?.name ?? 'WorkSpace' }}</span>

    <div class="topbar-right">
      <div
        class="topbar-status-dot"
        [class.connected]="connected()"
        [title]="connected() ? 'Real-time connected' : 'Connecting…'"
      ></div>
      <app-notification-bell />
    </div>
  `,
})
export class TopbarComponent {
  private tenant  = inject(TenantService);
  private socket  = inject(SocketService);

  readonly org       = this.tenant.activeOrg;
  readonly connected = this.socket.connected;
}
```

- [ ] **Step 2: Typecheck**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.app.json
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/features/shell/components/topbar/topbar.component.ts
git commit -m "task 13: TopbarComponent — add NotificationBellComponent to right side"
```

---

## Task 14: Frontend — shell.routes.ts update

**Files:**
- Modify: `frontend/src/app/features/shell/shell.routes.ts`

- [ ] **Step 1: Add settings/notifications route**

Edit `frontend/src/app/features/shell/shell.routes.ts` — add the notifications preferences route to the children array:

```typescript
{
  path: 'settings/notifications',
  loadComponent: () =>
    import('../notifications/notification-preferences/notification-preferences.component').then(
      m => m.NotificationPreferencesComponent,
    ),
},
```

The full updated file:

```typescript
// frontend/src/app/features/shell/shell.routes.ts
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
        path: 'settings/notifications',
        loadComponent: () =>
          import('../notifications/notification-preferences/notification-preferences.component').then(
            m => m.NotificationPreferencesComponent,
          ),
      },
    ],
  },
];
```

- [ ] **Step 2: Typecheck**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.app.json
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/features/shell/shell.routes.ts
git commit -m "task 14: shell.routes.ts — add settings/notifications lazy route"
```

---

## Task 15: Frontend — Service Worker (sw.js)

**Files:**
- Create: `frontend/src/sw.js`
- Modify: `frontend/angular.json`

- [ ] **Step 1: Create service worker**

Create `frontend/src/sw.js`:

```javascript
// frontend/src/sw.js
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'New notification', {
      body: data.body ?? '',
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      data: data,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      if (clients.length > 0) {
        clients[0].focus();
      } else {
        self.clients.openWindow('/');
      }
    }),
  );
});
```

- [ ] **Step 2: Add sw.js to angular.json assets**

Open `frontend/angular.json`. Find the `"assets"` array under `projects > frontend > architect > build > options`. Add `"src/sw.js"` to the array:

```json
"assets": [
  "src/favicon.ico",
  "src/assets",
  "src/sw.js"
],
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/sw.js frontend/angular.json
git commit -m "task 15: sw.js — push event handler and notificationclick for browser push"
```

---

## Task 16: Smoke Test — Full suite green

- [ ] **Step 1: Run all frontend unit tests**

```bash
cd frontend && npx ng test --watch=false
```

Expected — all suites pass. Count should be ≥ 27 suites, ≥ 100 tests.

- [ ] **Step 2: Run backend unit tests**

```bash
npm run test:unit
```

Expected: all suites pass including `push.service.test.ts`.

- [ ] **Step 3: Typecheck both**

```bash
npm run typecheck && cd frontend && npx tsc --noEmit -p tsconfig.app.json
```

Expected: zero errors in both.

- [ ] **Step 4: Commit final SESSION.md update**

Update `SESSION.md` — mark Phase 4 complete, record new test counts.

```bash
git add SESSION.md
git commit -m "chore: SESSION.md — Phase 4 notifications complete"
```

---

## Self-Review Checklist

| Spec requirement | Covered by |
|---|---|
| Bell in top bar, right side | Task 13 (TopbarComponent update) |
| Tabbed dropdown — All/Unread/Mentions | Task 10 (NotificationPanelComponent) |
| Socket.IO `notification:new` real-time | Task 4 (repository publish) + Task 5 (broadcaster) + Task 7 (subscribeRealtime) |
| `/app/settings/notifications` preference page | Task 12 + Task 14 |
| Push subscriptions table | Task 1 |
| push.service.ts — VAPID, save, remove, send | Task 2 |
| push.router.ts — POST/DELETE /push/subscribe | Task 3 |
| PushNotificationService — SW + subscribe | Task 8 |
| Service worker sw.js | Task 15 |
| Optimistic markRead + revert | Task 7 |
| Push permission denied state | Task 8 + Task 12 |
| Expired subscription auto-delete (410) | Task 2 |
| Navigate to entity on notification click | Task 11 |
| TDD throughout frontend | Tasks 7–10, 12 |
