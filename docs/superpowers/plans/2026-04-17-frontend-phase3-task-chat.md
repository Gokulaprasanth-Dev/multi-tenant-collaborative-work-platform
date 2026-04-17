# Frontend Phase 3A — Task Management + Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add workspace-scoped task management (list grouped by status, create, status-update) and real-time channel chat to the Angular frontend, backed by a workspace_id migration on the channels table.

**Architecture:** A `WorkspaceShellComponent` renders inside the outer shell's `<router-outlet>`, using its own 160px CSS Grid sidebar with back-arrow, Tasks link, and channel list. Three new signal-based services (`TaskService`, `ChannelService`, `MessageService`) follow the exact pattern of `WorkspaceService`. Backend gets one migration + two small chat.router.ts additions.

**Tech Stack:** Angular 17+ standalone components, Angular Signals, Angular Material (Dialog, Button, FormField, Input), TailwindCSS, existing `SocketService` for real-time chat, Jest (unit tests), node-pg-migrate (migrations).

---

## File Map

**Backend — new / modified:**
- Create: `migrations/017_channel_workspace_id.js`
- Modify: `src/modules/chat/channel.repository.ts` — `ChannelRow` + `findByOrg(workspaceId?)` + `create(..., workspaceId?)`
- Modify: `src/modules/chat/channel.service.ts` — `listChannels(orgId, workspaceId?)` + add `createWorkspaceChannel()`
- Modify: `src/modules/chat/chat.router.ts` — filter GET by workspace_id + add `POST /channels/workspace`

**Frontend — new models:**
- Create: `frontend/src/app/core/models/task.model.ts`
- Create: `frontend/src/app/core/models/channel.model.ts`
- Create: `frontend/src/app/core/models/message.model.ts`

**Frontend — modified service:**
- Modify: `frontend/src/app/core/services/workspace.service.ts` — add `activeWorkspace` signal + `loadOne(id)`

**Frontend — new services:**
- Create: `frontend/src/app/core/services/task.service.ts`
- Create: `frontend/src/app/core/services/task.service.spec.ts`
- Create: `frontend/src/app/core/services/channel.service.ts`
- Create: `frontend/src/app/core/services/channel.service.spec.ts`
- Create: `frontend/src/app/core/services/message.service.ts`
- Create: `frontend/src/app/core/services/message.service.spec.ts`

**Frontend — styles:**
- Modify: `frontend/src/styles/_shell.scss` — add workspace shell, task, channel/message CSS classes

**Frontend — workspace shell:**
- Create: `frontend/src/app/features/shell/workspace-shell/workspace-shell.component.ts`
- Create: `frontend/src/app/features/shell/workspace-shell/workspace-shell.component.spec.ts`
- Create: `frontend/src/app/features/shell/workspace-shell/workspace-sidebar/workspace-sidebar.component.ts`
- Create: `frontend/src/app/features/shell/workspace-shell/workspace-sidebar/workspace-sidebar.component.spec.ts`
- Create: `frontend/src/app/features/shell/workspace-shell/workspace-shell.routes.ts`
- Modify: `frontend/src/app/features/shell/shell.routes.ts` — add `/workspaces/:id` lazy child

**Frontend — task feature:**
- Create: `frontend/src/app/features/task/create-task-dialog/create-task-dialog.component.ts`
- Create: `frontend/src/app/features/task/task-list/task-list.component.ts`
- Create: `frontend/src/app/features/task/task-list/task-list.component.spec.ts`

**Frontend — chat feature:**
- Create: `frontend/src/app/features/chat/create-channel-dialog/create-channel-dialog.component.ts`
- Create: `frontend/src/app/features/chat/channel-view/channel-view.component.ts`
- Create: `frontend/src/app/features/chat/channel-view/channel-view.component.spec.ts`

---

## Task 1: Backend — Migration 017: Add workspace_id to channels

**Files:**
- Create: `migrations/017_channel_workspace_id.js`

- [ ] **Step 1: Create the migration file**

Create `migrations/017_channel_workspace_id.js`:

```javascript
exports.up = async (pgm) => {
  await pgm.db.query(`
    ALTER TABLE channels
    ADD COLUMN IF NOT EXISTS workspace_id UUID
      REFERENCES workspaces(id) ON DELETE SET NULL
  `);
  await pgm.db.query(`
    CREATE INDEX IF NOT EXISTS idx_channels_workspace_id
    ON channels(workspace_id)
    WHERE workspace_id IS NOT NULL
  `);
};

exports.down = async (pgm) => {
  await pgm.db.query(`DROP INDEX IF EXISTS idx_channels_workspace_id`);
  await pgm.db.query(`ALTER TABLE channels DROP COLUMN IF EXISTS workspace_id`);
};
```

- [ ] **Step 2: Apply the migration**

```bash
npm run migrate:up
```

Expected: `Migrating up: 017_channel_workspace_id.js` with no errors.

- [ ] **Step 3: Verify column exists**

```bash
npm run migrate:up
```

Expected: `No migrations to run.` (idempotent check confirms 017 already applied).

- [ ] **Step 4: Commit**

```bash
git add migrations/017_channel_workspace_id.js
git commit -m "feat(db): add workspace_id to channels table (migration 017)"
```

---

## Task 2: Backend — Update channel.repository.ts

**Files:**
- Modify: `src/modules/chat/channel.repository.ts`

- [ ] **Step 1: Add workspace_id to ChannelRow interface**

Open `src/modules/chat/channel.repository.ts`. Find the `ChannelRow` interface (lines ~3–13) and add `workspace_id`:

```typescript
export interface ChannelRow {
  id: string;
  org_id: string;
  type: 'direct' | 'group';
  name: string | null;
  created_by: string;
  workspace_id: string | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
```

- [ ] **Step 2: Update findByOrg to accept optional workspaceId**

Replace the existing `findByOrg` method (~lines 42–49) with:

```typescript
async findByOrg(orgId: string, workspaceId?: string): Promise<ChannelRow[]> {
  if (workspaceId) {
    const result = await queryReplica(
      `SELECT * FROM channels
       WHERE org_id = $1 AND workspace_id = $2 AND deleted_at IS NULL
       ORDER BY created_at ASC`,
      [orgId, workspaceId]
    );
    return result.rows as unknown as ChannelRow[];
  }
  const result = await queryReplica(
    `SELECT * FROM channels WHERE org_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC`,
    [orgId]
  );
  return result.rows as unknown as ChannelRow[];
}
```

- [ ] **Step 3: Update create to accept optional workspaceId**

Replace the existing `create` method (~lines 50–60) with:

```typescript
async create(
  orgId: string,
  type: 'direct' | 'group',
  createdBy: string,
  name: string | null,
  client: PoolClient,
  workspaceId?: string | null,
): Promise<ChannelRow> {
  const result = await client.query(
    `INSERT INTO channels (org_id, type, name, created_by, workspace_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [orgId, type, name, createdBy, workspaceId ?? null]
  );
  return result.rows[0] as unknown as ChannelRow;
}
```

- [ ] **Step 4: TypeScript-check the backend**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/chat/channel.repository.ts
git commit -m "feat(chat): add workspace_id to ChannelRow, findByOrg filter, create param"
```

---

## Task 3: Backend — Update channel.service.ts + chat.router.ts

**Files:**
- Modify: `src/modules/chat/channel.service.ts`
- Modify: `src/modules/chat/chat.router.ts`

- [ ] **Step 1: Update listChannels signature in channel.service.ts**

Find `listChannels` (~line 140) and replace it:

```typescript
export async function listChannels(orgId: string, workspaceId?: string): Promise<ChannelRow[]> {
  return channelRepo.findByOrg(orgId, workspaceId);
}
```

- [ ] **Step 2: Add createWorkspaceChannel to channel.service.ts**

Add this function immediately after `listChannels`:

```typescript
export async function createWorkspaceChannel(
  orgId: string,
  creatorId: string,
  name: string,
  workspaceId: string,
): Promise<ChannelRow> {
  const m = await memberRepo.findMembership(orgId, creatorId);
  if (!m) throw new AppError(403, 'NOT_ORG_MEMBER', 'Creator is not an org member');

  const channel = await withTransaction(async (client) => {
    const ch = await channelRepo.create(orgId, 'group', creatorId, name, client, workspaceId);
    await channelRepo.addMember(ch.id, creatorId, orgId, client);
    await client.query(`SELECT create_channel_sequence($1)`, [ch.id]);
    return ch;
  });

  await writeOutboxEvent('channel.created', orgId, channel.id, creatorId, {
    channelId: channel.id, orgId, type: 'group', name, workspaceId,
  });

  return channel;
}
```

- [ ] **Step 3: Update GET /channels in chat.router.ts to pass workspaceId**

Find the `router.get('/orgs/:orgId/channels'` block (around line 64) and replace its handler:

```typescript
router.get(
  '/orgs/:orgId/channels',
  ...orgMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.query['workspace_id'] as string | undefined;
      const channels = await ChannelService.listChannels(req.orgContext!.orgId, workspaceId);
      res.success(channels);
    } catch (err) { next(err); }
  }
);
```

- [ ] **Step 4: Add POST /channels/workspace endpoint in chat.router.ts**

Add this block **before** `router.get('/orgs/:orgId/channels/:channelId'` (so it doesn't conflict with the `:channelId` param route):

```typescript
// POST /api/v1/orgs/:orgId/channels/workspace — create workspace-scoped channel
router.post(
  '/orgs/:orgId/channels/workspace',
  ...orgMiddlewareWithIdempotency,
  validate(z.object({
    name:         z.string().min(1).max(255),
    workspace_id: z.string().uuid(),
  })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, workspace_id } = req.body as { name: string; workspace_id: string };
      const channel = await ChannelService.createWorkspaceChannel(
        req.orgContext!.orgId,
        req.user!.userId,
        name,
        workspace_id,
      );
      res.created(channel);
    } catch (err) { next(err); }
  }
);
```

- [ ] **Step 5: TypeScript-check the backend**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/chat/channel.service.ts src/modules/chat/chat.router.ts
git commit -m "feat(chat): workspace channel creation + workspace_id filter on GET /channels"
```

---

## Task 4: Frontend — Task model

**Files:**
- Create: `frontend/src/app/core/models/task.model.ts`

- [ ] **Step 1: Create task.model.ts**

Create `frontend/src/app/core/models/task.model.ts`:

```typescript
// frontend/src/app/core/models/task.model.ts

export type TaskStatus   = 'todo' | 'in_progress' | 'in_review' | 'done' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Task {
  id: string;
  orgId: string;
  workspaceId: string;
  title: string;
  description: Record<string, unknown> | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeIds: string[];
  dueDate: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDto {
  id: string;
  org_id: string;
  workspace_id: string;
  title: string;
  description: Record<string, unknown> | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_ids: string[];
  due_date: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export function toTask(dto: TaskDto): Task {
  return {
    id:          dto.id,
    orgId:       dto.org_id,
    workspaceId: dto.workspace_id,
    title:       dto.title,
    description: dto.description,
    status:      dto.status,
    priority:    dto.priority,
    assigneeIds: dto.assignee_ids ?? [],
    dueDate:     dto.due_date,
    version:     dto.version,
    createdAt:   dto.created_at,
    updatedAt:   dto.updated_at,
  };
}
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.app.json
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/core/models/task.model.ts
git commit -m "feat(frontend): Task model with Dto and toTask mapper"
```

---

## Task 5: Frontend — Channel and Message models

**Files:**
- Create: `frontend/src/app/core/models/channel.model.ts`
- Create: `frontend/src/app/core/models/message.model.ts`

- [ ] **Step 1: Create channel.model.ts**

Create `frontend/src/app/core/models/channel.model.ts`:

```typescript
// frontend/src/app/core/models/channel.model.ts

export interface Channel {
  id: string;
  orgId: string;
  workspaceId: string | null;
  type: 'direct' | 'group';
  name: string | null;
  createdAt: string;
}

export interface ChannelDto {
  id: string;
  org_id: string;
  workspace_id: string | null;
  type: 'direct' | 'group';
  name: string | null;
  created_at: string;
}

export function toChannel(dto: ChannelDto): Channel {
  return {
    id:          dto.id,
    orgId:       dto.org_id,
    workspaceId: dto.workspace_id,
    type:        dto.type,
    name:        dto.name,
    createdAt:   dto.created_at,
  };
}
```

- [ ] **Step 2: Create message.model.ts**

Create `frontend/src/app/core/models/message.model.ts`:

```typescript
// frontend/src/app/core/models/message.model.ts

export interface Message {
  id: string;
  channelId: string;
  senderUserId: string;
  body: string;
  clientMessageId: string;
  createdAt: string;
}

export interface MessageDto {
  id: string;
  channel_id: string;
  sender_user_id: string;
  body: string;
  client_message_id: string;
  created_at: string;
}

export function toMessage(dto: MessageDto): Message {
  return {
    id:              dto.id,
    channelId:       dto.channel_id,
    senderUserId:    dto.sender_user_id,
    body:            dto.body,
    clientMessageId: dto.client_message_id,
    createdAt:       dto.created_at,
  };
}
```

- [ ] **Step 3: Type-check**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.app.json
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/core/models/channel.model.ts frontend/src/app/core/models/message.model.ts
git commit -m "feat(frontend): Channel and Message models with Dto mappers"
```

---

## Task 6: Frontend — WorkspaceService: add loadOne() and activeWorkspace signal

**Files:**
- Modify: `frontend/src/app/core/services/workspace.service.ts`

- [ ] **Step 1: Add activeWorkspace signal and loadOne() method**

Replace the full contents of `frontend/src/app/core/services/workspace.service.ts`:

```typescript
// frontend/src/app/core/services/workspace.service.ts
import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, EMPTY, of, throwError } from 'rxjs';
import { map, tap, catchError } from 'rxjs';
import { Workspace, WorkspaceDto, toWorkspace } from '../models/workspace.model';
import { ApiResponse } from '../models/api-response.model';
import { TenantService } from './tenant.service';

@Injectable({ providedIn: 'root' })
export class WorkspaceService {
  readonly workspaces      = signal<Workspace[]>([]);
  readonly loading         = signal(false);
  readonly activeWorkspace = signal<Workspace | null>(null);

  constructor(
    private http:   HttpClient,
    private tenant: TenantService,
  ) {}

  load(): Observable<Workspace[]> {
    const orgId = this.tenant.activeOrgId();
    if (!orgId) return EMPTY;
    this.loading.set(true);
    return this.http
      .get<ApiResponse<WorkspaceDto[]>>(`/api/v1/orgs/${orgId}/workspaces`)
      .pipe(
        map((res: ApiResponse<WorkspaceDto[]>) => res.data.map(toWorkspace)),
        tap((ws: Workspace[]) => { this.workspaces.set(ws); this.loading.set(false); }),
        catchError((err: unknown) => { this.loading.set(false); return throwError(() => err); }),
      );
  }

  /** Returns workspace from cache if available; falls back to loading the full list. */
  loadOne(id: string): Observable<Workspace> {
    const cached = this.workspaces().find(w => w.id === id);
    if (cached) {
      this.activeWorkspace.set(cached);
      return of(cached);
    }
    return this.load().pipe(
      map(() => {
        const ws = this.workspaces().find(w => w.id === id);
        if (!ws) throw new Error(`Workspace ${id} not found`);
        this.activeWorkspace.set(ws);
        return ws;
      }),
    );
  }

  create(name: string, description?: string): Observable<Workspace> {
    const orgId = this.tenant.activeOrgId()!;
    return this.http
      .post<ApiResponse<WorkspaceDto>>(`/api/v1/orgs/${orgId}/workspaces`, { name, description })
      .pipe(
        map((res: ApiResponse<WorkspaceDto>) => toWorkspace(res.data)),
        tap((ws: Workspace) => this.workspaces.update((prev: Workspace[]) => [...prev, ws])),
      );
  }
}
```

- [ ] **Step 2: Run existing workspace service tests to confirm no regression**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="workspace.service.spec"
```

Expected: `PASS — 3 tests passed`.

- [ ] **Step 3: Type-check**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.app.json
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/core/services/workspace.service.ts
git commit -m "feat(frontend): WorkspaceService — activeWorkspace signal + loadOne()"
```

---

## Task 7: Frontend — TaskService (TDD)

**Files:**
- Create: `frontend/src/app/core/services/task.service.spec.ts`
- Create: `frontend/src/app/core/services/task.service.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/app/core/services/task.service.spec.ts`:

```typescript
// frontend/src/app/core/services/task.service.spec.ts
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TaskService } from './task.service';
import { TenantService } from './tenant.service';
import { TaskDto } from '../models/task.model';

const TASK_DTO: TaskDto = {
  id: 'task-1', org_id: 'org-1', workspace_id: 'ws-1',
  title: 'Fix bug', description: null,
  status: 'todo', priority: 'medium',
  assignee_ids: [], due_date: null,
  version: 1, created_at: '2024-01-01T00:00:00.000Z', updated_at: '2024-01-01T00:00:00.000Z',
};

describe('TaskService', () => {
  let service: TaskService;
  let ctrl: HttpTestingController;
  let tenant: TenantService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(TaskService);
    ctrl    = TestBed.inject(HttpTestingController);
    tenant  = TestBed.inject(TenantService);
  });

  afterEach(() => ctrl.verify());

  it('load() does nothing when no org is active', fakeAsync(() => {
    service.load('ws-1').subscribe();
    tick();
    ctrl.expectNone('/api/v1/orgs/org-1/tasks');
    expect(service.tasks()).toEqual([]);
  }));

  it('load() fetches tasks filtered by workspaceId and updates signal', fakeAsync(() => {
    tenant.setOrg({ id: 'org-1', name: 'Acme', slug: 'acme', status: 'active', plan: 'free' });
    service.load('ws-1').subscribe();
    ctrl.expectOne('/api/v1/orgs/org-1/tasks?workspace_id=ws-1')
      .flush({ data: [TASK_DTO], error: null, meta: {} });
    tick();
    expect(service.tasks().length).toBe(1);
    expect(service.tasks()[0].title).toBe('Fix bug');
    expect(service.tasks()[0].workspaceId).toBe('ws-1');
  }));

  it('create() POSTs and appends new task to signal', fakeAsync(() => {
    tenant.setOrg({ id: 'org-1', name: 'Acme', slug: 'acme', status: 'active', plan: 'free' });
    service.create('ws-1', 'New task').subscribe();
    const req = ctrl.expectOne('/api/v1/orgs/org-1/tasks');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toMatchObject({ workspace_id: 'ws-1', title: 'New task' });
    req.flush({ data: { ...TASK_DTO, id: 'task-2', title: 'New task' }, error: null, meta: {} });
    tick();
    expect(service.tasks().length).toBe(1);
    expect(service.tasks()[0].title).toBe('New task');
  }));

  it('updateStatus() optimistically updates signal then confirms on success', fakeAsync(() => {
    tenant.setOrg({ id: 'org-1', name: 'Acme', slug: 'acme', status: 'active', plan: 'free' });
    service.tasks.set([{ ...TASK_DTO, id: 'task-1', assigneeIds: [], dueDate: null, orgId: 'org-1', workspaceId: 'ws-1', createdAt: '', updatedAt: '' }]);
    service.updateStatus('task-1', 'done', 1).subscribe();
    // Optimistic: signal updated before HTTP response
    expect(service.tasks()[0].status).toBe('done');
    ctrl.expectOne('/api/v1/orgs/org-1/tasks/task-1')
      .flush({ data: { ...TASK_DTO, status: 'done', version: 2 }, error: null, meta: {} });
    tick();
    expect(service.tasks()[0].status).toBe('done');
    expect(service.tasks()[0].version).toBe(2);
  }));

  it('updateStatus() reverts signal on HTTP error', fakeAsync(() => {
    tenant.setOrg({ id: 'org-1', name: 'Acme', slug: 'acme', status: 'active', plan: 'free' });
    service.tasks.set([{ ...TASK_DTO, id: 'task-1', assigneeIds: [], dueDate: null, orgId: 'org-1', workspaceId: 'ws-1', createdAt: '', updatedAt: '' }]);
    service.updateStatus('task-1', 'done', 1).subscribe({ error: () => {} });
    expect(service.tasks()[0].status).toBe('done'); // optimistic
    ctrl.expectOne('/api/v1/orgs/org-1/tasks/task-1').error(new ErrorEvent('Network error'));
    tick();
    expect(service.tasks()[0].status).toBe('todo'); // reverted
  }));
});
```

- [ ] **Step 2: Run tests — expect them to fail**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="task.service.spec"
```

Expected: `FAIL — Cannot find module './task.service'`.

- [ ] **Step 3: Implement TaskService**

Create `frontend/src/app/core/services/task.service.ts`:

```typescript
// frontend/src/app/core/services/task.service.ts
import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, EMPTY, throwError } from 'rxjs';
import { map, tap, catchError } from 'rxjs';
import { Task, TaskDto, TaskStatus, TaskPriority, toTask } from '../models/task.model';
import { ApiResponse } from '../models/api-response.model';
import { TenantService } from './tenant.service';

@Injectable({ providedIn: 'root' })
export class TaskService {
  readonly tasks   = signal<Task[]>([]);
  readonly loading = signal(false);

  constructor(
    private http:   HttpClient,
    private tenant: TenantService,
  ) {}

  load(workspaceId: string): Observable<Task[]> {
    const orgId = this.tenant.activeOrgId();
    if (!orgId) return EMPTY;
    this.loading.set(true);
    return this.http
      .get<ApiResponse<TaskDto[]>>(`/api/v1/orgs/${orgId}/tasks?workspace_id=${workspaceId}`)
      .pipe(
        map((res: ApiResponse<TaskDto[]>) => res.data.map(toTask)),
        tap((tasks: Task[]) => { this.tasks.set(tasks); this.loading.set(false); }),
        catchError((err: unknown) => { this.loading.set(false); return throwError(() => err); }),
      );
  }

  create(
    workspaceId: string,
    title: string,
    opts: { priority?: TaskPriority; dueDate?: string } = {},
  ): Observable<Task> {
    const orgId = this.tenant.activeOrgId()!;
    return this.http
      .post<ApiResponse<TaskDto>>(`/api/v1/orgs/${orgId}/tasks`, {
        workspace_id: workspaceId,
        title,
        priority:    opts.priority ?? 'medium',
        due_date:    opts.dueDate  ?? null,
        assignee_ids: [],
      })
      .pipe(
        map((res: ApiResponse<TaskDto>) => toTask(res.data)),
        tap((task: Task) => this.tasks.update((prev: Task[]) => [...prev, task])),
      );
  }

  updateStatus(taskId: string, status: TaskStatus, version: number): Observable<Task> {
    const orgId = this.tenant.activeOrgId()!;
    const snapshot = this.tasks();
    // Optimistic update
    this.tasks.update((tasks: Task[]) =>
      tasks.map(t => t.id === taskId ? { ...t, status } : t)
    );
    return this.http
      .patch<ApiResponse<TaskDto>>(`/api/v1/orgs/${orgId}/tasks/${taskId}`, { status, version })
      .pipe(
        map((res: ApiResponse<TaskDto>) => toTask(res.data)),
        tap((updated: Task) =>
          this.tasks.update((tasks: Task[]) => tasks.map(t => t.id === taskId ? updated : t))
        ),
        catchError((err: unknown) => {
          this.tasks.set(snapshot); // revert
          return throwError(() => err);
        }),
      );
  }
}
```

- [ ] **Step 4: Run tests — expect them to pass**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="task.service.spec"
```

Expected: `PASS — 5 tests passed`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/core/services/task.service.ts \
        frontend/src/app/core/services/task.service.spec.ts
git commit -m "feat(frontend): TaskService with load/create/updateStatus + optimistic revert (TDD)"
```

---

## Task 8: Frontend — ChannelService (TDD)

**Files:**
- Create: `frontend/src/app/core/services/channel.service.spec.ts`
- Create: `frontend/src/app/core/services/channel.service.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/app/core/services/channel.service.spec.ts`:

```typescript
// frontend/src/app/core/services/channel.service.spec.ts
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ChannelService } from './channel.service';
import { TenantService } from './tenant.service';
import { ChannelDto } from '../models/channel.model';

const CH_DTO: ChannelDto = {
  id: 'ch-1', org_id: 'org-1', workspace_id: 'ws-1',
  type: 'group', name: 'general',
  created_at: '2024-01-01T00:00:00.000Z',
};

describe('ChannelService', () => {
  let service: ChannelService;
  let ctrl: HttpTestingController;
  let tenant: TenantService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ChannelService);
    ctrl    = TestBed.inject(HttpTestingController);
    tenant  = TestBed.inject(TenantService);
  });

  afterEach(() => ctrl.verify());

  it('load() does nothing when no org is active', fakeAsync(() => {
    service.load('ws-1').subscribe();
    tick();
    ctrl.expectNone('/api/v1/orgs/org-1/channels');
    expect(service.channels()).toEqual([]);
  }));

  it('load() fetches channels with workspace_id filter', fakeAsync(() => {
    tenant.setOrg({ id: 'org-1', name: 'Acme', slug: 'acme', status: 'active', plan: 'free' });
    service.load('ws-1').subscribe();
    ctrl.expectOne('/api/v1/orgs/org-1/channels?workspace_id=ws-1')
      .flush({ data: [CH_DTO], error: null, meta: {} });
    tick();
    expect(service.channels().length).toBe(1);
    expect(service.channels()[0].name).toBe('general');
    expect(service.channels()[0].workspaceId).toBe('ws-1');
  }));

  it('create() POSTs to /channels/workspace and appends to signal', fakeAsync(() => {
    tenant.setOrg({ id: 'org-1', name: 'Acme', slug: 'acme', status: 'active', plan: 'free' });
    service.create('announcements', 'ws-1').subscribe();
    const req = ctrl.expectOne('/api/v1/orgs/org-1/channels/workspace');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'announcements', workspace_id: 'ws-1' });
    req.flush({ data: { ...CH_DTO, id: 'ch-2', name: 'announcements' }, error: null, meta: {} });
    tick();
    expect(service.channels().length).toBe(1);
    expect(service.channels()[0].name).toBe('announcements');
  }));
});
```

- [ ] **Step 2: Run tests — expect them to fail**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="channel.service.spec"
```

Expected: `FAIL — Cannot find module './channel.service'`.

- [ ] **Step 3: Implement ChannelService**

Create `frontend/src/app/core/services/channel.service.ts`:

```typescript
// frontend/src/app/core/services/channel.service.ts
import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, EMPTY, throwError } from 'rxjs';
import { map, tap, catchError } from 'rxjs';
import { Channel, ChannelDto, toChannel } from '../models/channel.model';
import { ApiResponse } from '../models/api-response.model';
import { TenantService } from './tenant.service';

@Injectable({ providedIn: 'root' })
export class ChannelService {
  readonly channels = signal<Channel[]>([]);
  readonly loading  = signal(false);

  constructor(
    private http:   HttpClient,
    private tenant: TenantService,
  ) {}

  load(workspaceId: string): Observable<Channel[]> {
    const orgId = this.tenant.activeOrgId();
    if (!orgId) return EMPTY;
    this.loading.set(true);
    return this.http
      .get<ApiResponse<ChannelDto[]>>(`/api/v1/orgs/${orgId}/channels?workspace_id=${workspaceId}`)
      .pipe(
        map((res: ApiResponse<ChannelDto[]>) => res.data.map(toChannel)),
        tap((ch: Channel[]) => { this.channels.set(ch); this.loading.set(false); }),
        catchError((err: unknown) => { this.loading.set(false); return throwError(() => err); }),
      );
  }

  create(name: string, workspaceId: string): Observable<Channel> {
    const orgId = this.tenant.activeOrgId()!;
    return this.http
      .post<ApiResponse<ChannelDto>>(`/api/v1/orgs/${orgId}/channels/workspace`, {
        name,
        workspace_id: workspaceId,
      })
      .pipe(
        map((res: ApiResponse<ChannelDto>) => toChannel(res.data)),
        tap((ch: Channel) => this.channels.update((prev: Channel[]) => [...prev, ch])),
      );
  }
}
```

- [ ] **Step 4: Run tests — expect them to pass**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="channel.service.spec"
```

Expected: `PASS — 3 tests passed`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/core/services/channel.service.ts \
        frontend/src/app/core/services/channel.service.spec.ts
git commit -m "feat(frontend): ChannelService with workspace filter and create (TDD)"
```

---

## Task 9: Frontend — MessageService (TDD)

**Files:**
- Create: `frontend/src/app/core/services/message.service.spec.ts`
- Create: `frontend/src/app/core/services/message.service.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/app/core/services/message.service.spec.ts`:

```typescript
// frontend/src/app/core/services/message.service.spec.ts
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MessageService } from './message.service';
import { TenantService } from './tenant.service';
import { SocketService } from './socket.service';
import { MessageDto } from '../models/message.model';
import { Subject } from 'rxjs';

const MSG_DTO: MessageDto = {
  id: 'msg-1', channel_id: 'ch-1', sender_user_id: 'u-1',
  body: 'Hello!', client_message_id: 'cid-1',
  created_at: '2024-01-01T00:00:00.000Z',
};

describe('MessageService', () => {
  let service: MessageService;
  let ctrl: HttpTestingController;
  let tenant: TenantService;
  let socketSubject: Subject<MessageDto>;
  let socketService: { fromEvent: jest.Mock; connected: jest.Mock };

  beforeEach(() => {
    socketSubject = new Subject<MessageDto>();
    socketService = {
      fromEvent: jest.fn().mockReturnValue(socketSubject.asObservable()),
      connected:  jest.fn().mockReturnValue(false),
    };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SocketService, useValue: socketService },
      ],
    });
    service = TestBed.inject(MessageService);
    ctrl    = TestBed.inject(HttpTestingController);
    tenant  = TestBed.inject(TenantService);
  });

  afterEach(() => ctrl.verify());

  it('load() fetches messages and updates signal', fakeAsync(() => {
    tenant.setOrg({ id: 'org-1', name: 'Acme', slug: 'acme', status: 'active', plan: 'free' });
    service.load('ch-1').subscribe();
    ctrl.expectOne('/api/v1/orgs/org-1/channels/ch-1/messages?limit=50')
      .flush({ data: [MSG_DTO], error: null, meta: {} });
    tick();
    expect(service.messages().length).toBe(1);
    expect(service.messages()[0].body).toBe('Hello!');
  }));

  it('send() POSTs with body and client_message_id, sets sending flag', fakeAsync(() => {
    tenant.setOrg({ id: 'org-1', name: 'Acme', slug: 'acme', status: 'active', plan: 'free' });
    service.send('ch-1', 'Hi there').subscribe();
    expect(service.sending()).toBe(true);
    const req = ctrl.expectOne('/api/v1/orgs/org-1/channels/ch-1/messages');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toMatchObject({ body: 'Hi there' });
    expect(typeof req.request.body['client_message_id']).toBe('string');
    req.flush({ data: { ...MSG_DTO, body: 'Hi there' }, error: null, meta: {} });
    tick();
    expect(service.sending()).toBe(false);
  }));

  it('subscribeRealtime() appends incoming socket events for matching channelId', fakeAsync(() => {
    const sub = service.subscribeRealtime('ch-1');
    socketSubject.next(MSG_DTO);
    tick();
    expect(service.messages().length).toBe(1);
    expect(service.messages()[0].id).toBe('msg-1');
    sub.unsubscribe();
  }));

  it('subscribeRealtime() ignores events for other channels', fakeAsync(() => {
    const sub = service.subscribeRealtime('ch-1');
    socketSubject.next({ ...MSG_DTO, channel_id: 'ch-99' });
    tick();
    expect(service.messages().length).toBe(0);
    sub.unsubscribe();
  }));

  it('subscribeRealtime() dedupes messages with same id', fakeAsync(() => {
    const sub = service.subscribeRealtime('ch-1');
    socketSubject.next(MSG_DTO);
    socketSubject.next(MSG_DTO); // duplicate
    tick();
    expect(service.messages().length).toBe(1);
    sub.unsubscribe();
  }));
});
```

- [ ] **Step 2: Run tests — expect them to fail**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="message.service.spec"
```

Expected: `FAIL — Cannot find module './message.service'`.

- [ ] **Step 3: Implement MessageService**

Create `frontend/src/app/core/services/message.service.ts`:

```typescript
// frontend/src/app/core/services/message.service.ts
import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subscription, EMPTY, throwError } from 'rxjs';
import { map, tap, catchError } from 'rxjs';
import { Message, MessageDto, toMessage } from '../models/message.model';
import { ApiResponse } from '../models/api-response.model';
import { TenantService } from './tenant.service';
import { SocketService } from './socket.service';

@Injectable({ providedIn: 'root' })
export class MessageService {
  readonly messages = signal<Message[]>([]);
  readonly sending  = signal(false);

  constructor(
    private http:   HttpClient,
    private tenant: TenantService,
    private socket: SocketService,
  ) {}

  load(channelId: string): Observable<Message[]> {
    const orgId = this.tenant.activeOrgId();
    if (!orgId) return EMPTY;
    return this.http
      .get<ApiResponse<MessageDto[]>>(
        `/api/v1/orgs/${orgId}/channels/${channelId}/messages?limit=50`
      )
      .pipe(
        map((res: ApiResponse<MessageDto[]>) => res.data.map(toMessage)),
        tap((msgs: Message[]) => this.messages.set(msgs)),
      );
  }

  send(channelId: string, body: string): Observable<Message> {
    const orgId = this.tenant.activeOrgId()!;
    this.sending.set(true);
    return this.http
      .post<ApiResponse<MessageDto>>(
        `/api/v1/orgs/${orgId}/channels/${channelId}/messages`,
        { body, client_message_id: crypto.randomUUID() }
      )
      .pipe(
        map((res: ApiResponse<MessageDto>) => toMessage(res.data)),
        tap(() => this.sending.set(false)),
        catchError((err: unknown) => { this.sending.set(false); return throwError(() => err); }),
      );
  }

  subscribeRealtime(channelId: string): Subscription {
    return this.socket.fromEvent<MessageDto>('chat:message').subscribe((dto: MessageDto) => {
      if (dto.channel_id !== channelId) return;
      const incoming = toMessage(dto);
      this.messages.update((msgs: Message[]) =>
        msgs.some(m => m.id === incoming.id) ? msgs : [...msgs, incoming]
      );
    });
  }
}
```

- [ ] **Step 4: Run tests — expect them to pass**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="message.service.spec"
```

Expected: `PASS — 5 tests passed`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/core/services/message.service.ts \
        frontend/src/app/core/services/message.service.spec.ts
git commit -m "feat(frontend): MessageService with load/send/subscribeRealtime + dedupe (TDD)"
```

---

## Task 10: Frontend — Shell styles update

**Files:**
- Modify: `frontend/src/styles/_shell.scss`

- [ ] **Step 1: Append workspace shell, task, and chat styles**

Open `frontend/src/styles/_shell.scss` and append the following at the end of the file:

```scss
// ── Workspace shell (inner grid inside .main-content) ────────────────────────
.workspace-shell {
  display: grid;
  grid-template-columns: 160px 1fr;
  height: 100%;
  overflow: hidden;
}

.workspace-sidebar {
  background: rgba(255, 255, 255, 0.02);
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 0;

  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
}

.workspace-sidebar-back {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  color: #64748b;
  font-size: 12px;
  cursor: pointer;
  text-decoration: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  transition: color 0.15s;

  &:hover { color: #94a3b8; }
}

.workspace-sidebar-name {
  padding: 10px 12px 6px;
  color: #f1f5f9;
  font-size: 13px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-sidebar-section {
  padding: 6px 12px 2px;
  color: #475569;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.workspace-sidebar-add-btn {
  background: none;
  border: none;
  color: #64748b;
  cursor: pointer;
  font-size: 16px;
  padding: 0 2px;
  line-height: 1;

  &:hover { color: #c084fc; }
}

.workspace-sidebar-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  color: #94a3b8;
  font-size: 13px;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;

  &:hover { background: rgba(255,255,255,0.04); color: #e2e8f0; }

  &.active {
    background: rgba(168, 85, 247, 0.1);
    color: #c084fc;
    border-right: 2px solid #a855f7;
  }
}

.workspace-main {
  overflow-y: auto;
  padding: 1.5rem;
}

// ── Task list ─────────────────────────────────────────────────────────────────
.task-group {
  margin-bottom: 1.5rem;
}

.task-group-label {
  color: #475569;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding-bottom: 6px;
  margin-bottom: 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.task-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 6px;
  margin-bottom: 4px;

  &:hover { background: rgba(255, 255, 255, 0.06); }
}

.task-title {
  flex: 1;
  color: #e2e8f0;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-status-select {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  color: #94a3b8;
  font-size: 11px;
  padding: 2px 6px;
  cursor: pointer;

  &:focus { outline: none; border-color: #a855f7; }
}

.task-priority {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 3px;
  text-transform: uppercase;

  &--low    { background: rgba(100,116,139,.2); color: #94a3b8; }
  &--medium { background: rgba(245,158,11,.15); color: #fbbf24; }
  &--high   { background: rgba(239,68,68,.15);  color: #f87171; }
  &--urgent { background: rgba(239,68,68,.3);   color: #fca5a5; }
}

.task-due {
  color: #64748b;
  font-size: 11px;
  white-space: nowrap;
}

.task-empty {
  color: #475569;
  font-size: 13px;
  padding: 8px 10px;
  font-style: italic;
}

// ── Channel view ──────────────────────────────────────────────────────────────
.channel-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.channel-header {
  color: #f1f5f9;
  font-size: 15px;
  font-weight: 600;
  padding-bottom: 0.75rem;
  margin-bottom: 0.75rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

.message-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-bottom: 0.5rem;

  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
}

.message-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: baseline;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;

  &:hover { background: rgba(255, 255, 255, 0.03); }
}

.message-sender {
  color: #a855f7;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.message-body {
  color: #e2e8f0;
  font-size: 13px;
  word-break: break-word;
}

.message-time {
  color: #475569;
  font-size: 10px;
  white-space: nowrap;
}

.message-empty {
  color: #475569;
  font-size: 13px;
  text-align: center;
  padding: 2rem 0;
  font-style: italic;
}

.message-input-row {
  display: flex;
  gap: 8px;
  padding-top: 0.75rem;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

.message-input {
  flex: 1;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #f1f5f9;
  font-size: 13px;
  padding: 8px 12px;

  &::placeholder { color: #475569; }
  &:focus { outline: none; border-color: #a855f7; }
}

.message-send-btn {
  background: #a855f7;
  border: none;
  border-radius: 8px;
  color: white;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  padding: 8px 16px;
  transition: background 0.15s;

  &:hover:not(:disabled) { background: #9333ea; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}
```

- [ ] **Step 2: Type-check (SCSS compiles via Angular build)**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.app.json
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/styles/_shell.scss
git commit -m "feat(frontend): add workspace shell, task, and chat CSS classes to _shell.scss"
```

---

## Task 11: Frontend — WorkspaceSidebarComponent (TDD)

**Files:**
- Create: `frontend/src/app/features/shell/workspace-shell/workspace-sidebar/workspace-sidebar.component.ts`
- Create: `frontend/src/app/features/shell/workspace-shell/workspace-sidebar/workspace-sidebar.component.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/app/features/shell/workspace-shell/workspace-sidebar/workspace-sidebar.component.spec.ts`:

```typescript
// frontend/src/app/features/shell/workspace-shell/workspace-sidebar/workspace-sidebar.component.spec.ts
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { WorkspaceSidebarComponent } from './workspace-sidebar.component';
import { WorkspaceService } from '../../../../core/services/workspace.service';
import { ChannelService } from '../../../../core/services/channel.service';
import { Workspace } from '../../../../core/models/workspace.model';
import { Channel } from '../../../../core/models/channel.model';

const WS: Workspace = {
  id: 'ws-1', orgId: 'org-1', name: 'Engineering', description: null,
  status: 'active', ownerUserId: 'u-1', version: 1,
  createdAt: '', updatedAt: '',
};

const CH: Channel = {
  id: 'ch-1', orgId: 'org-1', workspaceId: 'ws-1',
  type: 'group', name: 'general', createdAt: '',
};

describe('WorkspaceSidebarComponent', () => {
  let fixture: ComponentFixture<WorkspaceSidebarComponent>;
  let wsSvc: { activeWorkspace: ReturnType<typeof signal<Workspace | null>>; loadOne: jest.Mock };
  let chSvc: { channels: ReturnType<typeof signal<Channel[]>>; load: jest.Mock; create: jest.Mock };

  beforeEach(async () => {
    wsSvc = {
      activeWorkspace: signal<Workspace | null>(null),
      loadOne:         jest.fn().mockReturnValue(of(WS)),
    };
    chSvc = {
      channels: signal<Channel[]>([]),
      load:     jest.fn().mockReturnValue(of([])),
      create:   jest.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [WorkspaceSidebarComponent],
      providers: [
        { provide: WorkspaceService, useValue: wsSvc },
        { provide: ChannelService,   useValue: chSvc },
        provideRouter([]),
        provideAnimations(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WorkspaceSidebarComponent);
    fixture.componentRef.setInput('workspaceId', 'ws-1');
    fixture.detectChanges();
  });

  it('renders the back link pointing to /app/workspaces', () => {
    const back = fixture.nativeElement.querySelector('.workspace-sidebar-back');
    expect(back).toBeTruthy();
    expect(back.getAttribute('href')).toBe('/app/workspaces');
  });

  it('renders workspace name when activeWorkspace is set', fakeAsync(() => {
    wsSvc.activeWorkspace.set(WS);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Engineering');
  }));

  it('renders a link for each channel in the signal', fakeAsync(() => {
    chSvc.channels.set([CH]);
    fixture.detectChanges();
    const items = fixture.nativeElement.querySelectorAll('a.workspace-sidebar-item');
    const texts = Array.from(items).map((el: Element) => el.textContent);
    expect(texts.some((t: string) => t?.includes('general'))).toBe(true);
  }));

  it('has a Tasks link pointing to /app/workspaces/ws-1/tasks', () => {
    const links = fixture.nativeElement.querySelectorAll('a.workspace-sidebar-item');
    const hrefs = Array.from(links).map((el: Element) => el.getAttribute('href'));
    expect(hrefs.some((h: string | null) => h?.includes('/app/workspaces/ws-1/tasks'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — expect them to fail**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="workspace-sidebar.component.spec"
```

Expected: `FAIL — Cannot find module './workspace-sidebar.component'`.

- [ ] **Step 3: Implement WorkspaceSidebarComponent**

Create `frontend/src/app/features/shell/workspace-shell/workspace-sidebar/workspace-sidebar.component.ts`:

```typescript
// frontend/src/app/features/shell/workspace-shell/workspace-sidebar/workspace-sidebar.component.ts
import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { WorkspaceService } from '../../../../core/services/workspace.service';
import { ChannelService } from '../../../../core/services/channel.service';
import { CreateChannelDialogComponent } from '../../../chat/create-channel-dialog/create-channel-dialog.component';

@Component({
  selector: 'app-workspace-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  template: `
    <!-- Back to workspace list -->
    <a class="workspace-sidebar-back" routerLink="/app/workspaces">← All workspaces</a>

    <!-- Workspace name -->
    <div class="workspace-sidebar-name">{{ workspace()?.name ?? '…' }}</div>

    <!-- Tasks link -->
    <nav>
      <a
        class="workspace-sidebar-item"
        routerLinkActive="active"
        [routerLink]="['/app/workspaces', workspaceId, 'tasks']"
      >
        ☑ Tasks
      </a>
    </nav>

    <!-- Channel list -->
    <div class="workspace-sidebar-section">
      <span>Channels</span>
      <button class="workspace-sidebar-add-btn" title="New channel" (click)="openCreateChannel()">+</button>
    </div>

    @for (ch of channels(); track ch.id) {
      <a
        class="workspace-sidebar-item"
        routerLinkActive="active"
        [routerLink]="['/app/workspaces', workspaceId, 'chat', ch.id]"
      >
        # {{ ch.name }}
      </a>
    }

    @if (channels().length === 0) {
      <div style="padding:6px 12px;color:#475569;font-size:12px;">No channels yet</div>
    }
  `,
})
export class WorkspaceSidebarComponent {
  @Input({ required: true }) workspaceId!: string;

  private wsSvc  = inject(WorkspaceService);
  private chSvc  = inject(ChannelService);
  private dialog = inject(MatDialog);

  readonly workspace = this.wsSvc.activeWorkspace;
  readonly channels  = this.chSvc.channels;

  openCreateChannel(): void {
    this.dialog.open(CreateChannelDialogComponent, {
      data:        { workspaceId: this.workspaceId },
      panelClass:  'dark-dialog',
    });
  }
}
```

- [ ] **Step 4: Run tests — expect them to pass**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="workspace-sidebar.component.spec"
```

Expected: `PASS — 4 tests passed`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/features/shell/workspace-shell/workspace-sidebar/
git commit -m "feat(frontend): WorkspaceSidebarComponent with back, tasks, channel list (TDD)"
```

---

## Task 12: Frontend — WorkspaceShellComponent (TDD)

**Files:**
- Create: `frontend/src/app/features/shell/workspace-shell/workspace-shell.component.ts`
- Create: `frontend/src/app/features/shell/workspace-shell/workspace-shell.component.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/app/features/shell/workspace-shell/workspace-shell.component.spec.ts`:

```typescript
// frontend/src/app/features/shell/workspace-shell/workspace-shell.component.spec.ts
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { WorkspaceShellComponent } from './workspace-shell.component';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { ChannelService } from '../../../core/services/channel.service';

describe('WorkspaceShellComponent', () => {
  let fixture: ComponentFixture<WorkspaceShellComponent>;
  let wsSvc: { loadOne: jest.Mock; activeWorkspace: jest.Mock };
  let chSvc: { load: jest.Mock; channels: jest.Mock };

  beforeEach(async () => {
    wsSvc = {
      loadOne:         jest.fn().mockReturnValue(of({})),
      activeWorkspace: jest.fn().mockReturnValue(null),
    };
    chSvc = {
      load:     jest.fn().mockReturnValue(of([])),
      channels: jest.fn().mockReturnValue([]),
    };

    await TestBed.configureTestingModule({
      imports: [WorkspaceShellComponent],
      providers: [
        { provide: WorkspaceService, useValue: wsSvc },
        { provide: ChannelService,   useValue: chSvc },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 'ws-1' } } },
        },
        provideRouter([]),
        provideAnimations(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WorkspaceShellComponent);
    fixture.detectChanges();
  });

  it('calls loadOne() and ChannelService.load() with the route :id on init', fakeAsync(() => {
    tick();
    expect(wsSvc.loadOne).toHaveBeenCalledWith('ws-1');
    expect(chSvc.load).toHaveBeenCalledWith('ws-1');
  }));

  it('renders the workspace-shell container', () => {
    expect(fixture.nativeElement.querySelector('.workspace-shell')).toBeTruthy();
  });

  it('renders the workspace sidebar', () => {
    expect(fixture.nativeElement.querySelector('app-workspace-sidebar')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests — expect them to fail**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="workspace-shell.component.spec"
```

Expected: `FAIL — Cannot find module './workspace-shell.component'`.

- [ ] **Step 3: Implement WorkspaceShellComponent**

Create `frontend/src/app/features/shell/workspace-shell/workspace-shell.component.ts`:

```typescript
// frontend/src/app/features/shell/workspace-shell/workspace-shell.component.ts
import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { ChannelService } from '../../../core/services/channel.service';
import { WorkspaceSidebarComponent } from './workspace-sidebar/workspace-sidebar.component';

@Component({
  selector: 'app-workspace-shell',
  standalone: true,
  imports: [RouterOutlet, WorkspaceSidebarComponent],
  template: `
    <div class="workspace-shell">
      <app-workspace-sidebar [workspaceId]="workspaceId" />
      <main class="workspace-main">
        <router-outlet />
      </main>
    </div>
  `,
})
export class WorkspaceShellComponent implements OnInit {
  private route  = inject(ActivatedRoute);
  private wsSvc  = inject(WorkspaceService);
  private chSvc  = inject(ChannelService);

  workspaceId = '';

  ngOnInit(): void {
    this.workspaceId = this.route.snapshot.paramMap.get('id')!;
    this.wsSvc.loadOne(this.workspaceId).subscribe();
    this.chSvc.load(this.workspaceId).subscribe();
  }
}
```

- [ ] **Step 4: Run tests — expect them to pass**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="workspace-shell.component.spec"
```

Expected: `PASS — 3 tests passed`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/features/shell/workspace-shell/workspace-shell.component.ts \
        frontend/src/app/features/shell/workspace-shell/workspace-shell.component.spec.ts
git commit -m "feat(frontend): WorkspaceShellComponent — inner shell with sidebar + outlet (TDD)"
```

---

## Task 13: Frontend — workspace-shell.routes.ts + shell.routes.ts update

**Files:**
- Create: `frontend/src/app/features/shell/workspace-shell/workspace-shell.routes.ts`
- Modify: `frontend/src/app/features/shell/shell.routes.ts`

- [ ] **Step 1: Create workspace-shell.routes.ts**

Create `frontend/src/app/features/shell/workspace-shell/workspace-shell.routes.ts`:

```typescript
// frontend/src/app/features/shell/workspace-shell/workspace-shell.routes.ts
import { Routes } from '@angular/router';
import { WorkspaceShellComponent } from './workspace-shell.component';

export const workspaceShellRoutes: Routes = [
  {
    path: '',
    component: WorkspaceShellComponent,
    children: [
      {
        path: '',
        redirectTo: 'tasks',
        pathMatch: 'full',
      },
      {
        path: 'tasks',
        loadComponent: () =>
          import('../../task/task-list/task-list.component').then(
            m => m.TaskListComponent,
          ),
      },
      {
        path: 'chat',
        redirectTo: 'tasks',
        pathMatch: 'full',
      },
      {
        path: 'chat/:channelId',
        loadComponent: () =>
          import('../../chat/channel-view/channel-view.component').then(
            m => m.ChannelViewComponent,
          ),
      },
    ],
  },
];
```

- [ ] **Step 2: Update shell.routes.ts to add /workspaces/:id lazy child**

Replace the full contents of `frontend/src/app/features/shell/shell.routes.ts`:

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
    ],
  },
];
```

- [ ] **Step 3: Type-check**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.app.json
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/features/shell/workspace-shell/workspace-shell.routes.ts \
        frontend/src/app/features/shell/shell.routes.ts
git commit -m "feat(frontend): workspace-shell routes wired into shell.routes"
```

---

## Task 14: Frontend — CreateTaskDialogComponent

**Files:**
- Create: `frontend/src/app/features/task/create-task-dialog/create-task-dialog.component.ts`

- [ ] **Step 1: Create CreateTaskDialogComponent**

Create `frontend/src/app/features/task/create-task-dialog/create-task-dialog.component.ts`:

```typescript
// frontend/src/app/features/task/create-task-dialog/create-task-dialog.component.ts
import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { MatDialogRef, MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { TaskService } from '../../../core/services/task.service';
import { AppError } from '../../../core/models/api-response.model';
import { TaskPriority } from '../../../core/models/task.model';

@Component({
  selector: 'app-create-task-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  template: `
    <h2 mat-dialog-title style="color:#f1f5f9;margin:0 0 1rem;">New task</h2>

    <mat-dialog-content style="padding:0;min-width:340px;">
      @if (error()) {
        <div class="auth-error" style="margin-bottom:1rem;">{{ error() }}</div>
      }

      <form [formGroup]="form" (ngSubmit)="submit()" id="create-task-form">
        <mat-form-field appearance="outline" style="width:100%;margin-bottom:0.5rem;">
          <mat-label>Task title</mat-label>
          <input matInput formControlName="title" placeholder="e.g. Fix login bug" autocomplete="off" />
          @if (form.controls.title.errors?.['required'] && form.controls.title.touched) {
            <mat-error>Title is required</mat-error>
          }
        </mat-form-field>

        <mat-form-field appearance="outline" style="width:100%;margin-bottom:0.5rem;">
          <mat-label>Priority</mat-label>
          <mat-select formControlName="priority">
            <mat-option value="low">Low</mat-option>
            <mat-option value="medium">Medium</mat-option>
            <mat-option value="high">High</mat-option>
            <mat-option value="urgent">Urgent</mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" style="width:100%;">
          <mat-label>Due date (optional)</mat-label>
          <input matInput type="datetime-local" formControlName="dueDate" />
        </mat-form-field>
      </form>
    </mat-dialog-content>

    <mat-dialog-actions align="end" style="padding-top:1rem;">
      <button mat-button mat-dialog-close [disabled]="saving()">Cancel</button>
      <button
        mat-flat-button color="primary"
        type="submit"
        form="create-task-form"
        [disabled]="form.invalid || saving()"
      >
        {{ saving() ? 'Creating…' : 'Create' }}
      </button>
    </mat-dialog-actions>
  `,
})
export class CreateTaskDialogComponent {
  private taskSvc   = inject(TaskService);
  private dialogRef = inject(MatDialogRef<CreateTaskDialogComponent>);
  private data      = inject<{ workspaceId: string }>(MAT_DIALOG_DATA);
  private fb        = inject(FormBuilder);

  readonly saving = signal(false);
  readonly error  = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    title:   ['', [Validators.required, Validators.maxLength(500)]],
    priority: ['medium'],
    dueDate:  [''],
  });

  submit(): void {
    if (this.form.invalid) return;
    const { title, priority, dueDate } = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    this.taskSvc.create(this.data.workspaceId, title, {
      priority: priority as TaskPriority,
      dueDate:  dueDate || undefined,
    }).subscribe({
      next:  () => { this.saving.set(false); this.dialogRef.close(true); },
      error: (err: AppError) => {
        this.saving.set(false);
        this.error.set(err.message ?? 'Failed to create task');
      },
    });
  }
}
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.app.json
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/features/task/create-task-dialog/create-task-dialog.component.ts
git commit -m "feat(frontend): CreateTaskDialogComponent with title, priority, due date"
```

---

## Task 15: Frontend — TaskListComponent (TDD)

**Files:**
- Create: `frontend/src/app/features/task/task-list/task-list.component.spec.ts`
- Create: `frontend/src/app/features/task/task-list/task-list.component.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/app/features/task/task-list/task-list.component.spec.ts`:

```typescript
// frontend/src/app/features/task/task-list/task-list.component.spec.ts
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { TaskListComponent } from './task-list.component';
import { TaskService } from '../../../core/services/task.service';
import { Task } from '../../../core/models/task.model';

const TASK: Task = {
  id: 'task-1', orgId: 'org-1', workspaceId: 'ws-1',
  title: 'Fix bug', description: null,
  status: 'todo', priority: 'medium',
  assigneeIds: [], dueDate: null,
  version: 1, createdAt: '', updatedAt: '',
};

describe('TaskListComponent', () => {
  let fixture: ComponentFixture<TaskListComponent>;
  let taskSvc: { tasks: ReturnType<typeof signal<Task[]>>; loading: ReturnType<typeof signal<boolean>>; load: jest.Mock; updateStatus: jest.Mock };

  beforeEach(async () => {
    taskSvc = {
      tasks:        signal<Task[]>([]),
      loading:      signal(false),
      load:         jest.fn().mockReturnValue(of([])),
      updateStatus: jest.fn().mockReturnValue(of(TASK)),
    };

    await TestBed.configureTestingModule({
      imports: [TaskListComponent],
      providers: [
        { provide: TaskService, useValue: taskSvc },
        {
          provide: ActivatedRoute,
          useValue: {
            parent: { snapshot: { paramMap: { get: () => 'ws-1' } } },
            snapshot: { paramMap: { get: () => null } },
          },
        },
        provideRouter([]),
        provideAnimations(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TaskListComponent);
    fixture.detectChanges();
  });

  it('calls taskSvc.load() with workspaceId on init', () => {
    expect(taskSvc.load).toHaveBeenCalledWith('ws-1');
  });

  it('renders a task row for each task in the todo group', fakeAsync(() => {
    taskSvc.tasks.set([TASK]);
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('.task-row');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Fix bug');
  }));

  it('shows empty message when no tasks in a group', fakeAsync(() => {
    taskSvc.tasks.set([]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No todo tasks');
  }));

  it('calls updateStatus when status select changes', fakeAsync(() => {
    taskSvc.tasks.set([TASK]);
    fixture.detectChanges();
    const select = fixture.nativeElement.querySelector('.task-status-select');
    select.value = 'done';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    tick();
    expect(taskSvc.updateStatus).toHaveBeenCalledWith('task-1', 'done', 1);
  }));
});
```

- [ ] **Step 2: Run tests — expect them to fail**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="task-list.component.spec"
```

Expected: `FAIL — Cannot find module './task-list.component'`.

- [ ] **Step 3: Implement TaskListComponent**

Create `frontend/src/app/features/task/task-list/task-list.component.ts`:

```typescript
// frontend/src/app/features/task/task-list/task-list.component.ts
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { TaskService } from '../../../core/services/task.service';
import { Task, TaskStatus } from '../../../core/models/task.model';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';
import { CreateTaskDialogComponent } from '../create-task-dialog/create-task-dialog.component';

const STATUS_GROUPS: { status: TaskStatus; label: string }[] = [
  { status: 'todo',        label: 'Todo' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'in_review',   label: 'In Review' },
  { status: 'done',        label: 'Done' },
  { status: 'cancelled',   label: 'Cancelled' },
];

@Component({
  selector: 'app-task-list',
  standalone: true,
  imports: [CommonModule, LoadingSpinnerComponent],
  template: `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;">
      <h1 style="color:#f1f5f9;font-size:20px;font-weight:700;margin:0;">Tasks</h1>
      <button class="workspace-new-btn" (click)="openCreate()">+ New Task</button>
    </div>

    @if (loading()) {
      <app-loading-spinner />
    } @else {
      @for (group of statusGroups; track group.status) {
        <div class="task-group">
          <div class="task-group-label">
            {{ group.label }} ({{ tasksForStatus(group.status).length }})
          </div>

          @for (task of tasksForStatus(group.status); track task.id) {
            <div class="task-row">
              <select
                class="task-status-select"
                [value]="task.status"
                (change)="updateStatus(task, $event)"
              >
                <option value="todo">Todo</option>
                <option value="in_progress">In Progress</option>
                <option value="in_review">In Review</option>
                <option value="done">Done</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <span class="task-title">{{ task.title }}</span>
              <span class="task-priority task-priority--{{ task.priority }}">{{ task.priority }}</span>
              <span class="task-due">{{ task.dueDate ? (task.dueDate | date:'MMM d') : '' }}</span>
            </div>
          }

          @if (tasksForStatus(group.status).length === 0) {
            <div class="task-empty">No {{ group.label.toLowerCase() }} tasks</div>
          }
        </div>
      }
    }
  `,
})
export class TaskListComponent implements OnInit {
  private taskSvc = inject(TaskService);
  private route   = inject(ActivatedRoute);
  private dialog  = inject(MatDialog);

  readonly loading      = this.taskSvc.loading;
  readonly tasks        = this.taskSvc.tasks;
  readonly statusGroups = STATUS_GROUPS;

  private workspaceId = '';

  ngOnInit(): void {
    this.workspaceId = this.route.parent!.snapshot.paramMap.get('id')!;
    this.taskSvc.load(this.workspaceId).subscribe();
  }

  tasksForStatus(status: TaskStatus): Task[] {
    return this.tasks().filter(t => t.status === status);
  }

  openCreate(): void {
    const ref = this.dialog.open(CreateTaskDialogComponent, {
      data:       { workspaceId: this.workspaceId },
      panelClass: 'dark-dialog',
    });
    ref.afterClosed().subscribe((created: boolean) => {
      if (created) this.taskSvc.load(this.workspaceId).subscribe();
    });
  }

  updateStatus(task: Task, event: Event): void {
    const status = (event.target as HTMLSelectElement).value as TaskStatus;
    this.taskSvc.updateStatus(task.id, status, task.version).subscribe({
      error: () => { /* signal reverted by service */ },
    });
  }
}
```

- [ ] **Step 4: Run tests — expect them to pass**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="task-list.component.spec"
```

Expected: `PASS — 4 tests passed`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/features/task/task-list/task-list.component.ts \
        frontend/src/app/features/task/task-list/task-list.component.spec.ts
git commit -m "feat(frontend): TaskListComponent grouped by status with inline status-update (TDD)"
```

---

## Task 16: Frontend — CreateChannelDialogComponent

**Files:**
- Create: `frontend/src/app/features/chat/create-channel-dialog/create-channel-dialog.component.ts`

- [ ] **Step 1: Create CreateChannelDialogComponent**

Create `frontend/src/app/features/chat/create-channel-dialog/create-channel-dialog.component.ts`:

```typescript
// frontend/src/app/features/chat/create-channel-dialog/create-channel-dialog.component.ts
import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { MatDialogRef, MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ChannelService } from '../../../core/services/channel.service';
import { AppError } from '../../../core/models/api-response.model';

@Component({
  selector: 'app-create-channel-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <h2 mat-dialog-title style="color:#f1f5f9;margin:0 0 1rem;">New channel</h2>

    <mat-dialog-content style="padding:0;min-width:300px;">
      @if (error()) {
        <div class="auth-error" style="margin-bottom:1rem;">{{ error() }}</div>
      }

      <form [formGroup]="form" (ngSubmit)="submit()" id="create-channel-form">
        <mat-form-field appearance="outline" style="width:100%;">
          <mat-label>Channel name</mat-label>
          <input matInput formControlName="name" placeholder="e.g. general" autocomplete="off" />
          @if (form.controls.name.errors?.['required'] && form.controls.name.touched) {
            <mat-error>Name is required</mat-error>
          }
        </mat-form-field>
      </form>
    </mat-dialog-content>

    <mat-dialog-actions align="end" style="padding-top:1rem;">
      <button mat-button mat-dialog-close [disabled]="saving()">Cancel</button>
      <button
        mat-flat-button color="primary"
        type="submit"
        form="create-channel-form"
        [disabled]="form.invalid || saving()"
      >
        {{ saving() ? 'Creating…' : 'Create' }}
      </button>
    </mat-dialog-actions>
  `,
})
export class CreateChannelDialogComponent {
  private chSvc     = inject(ChannelService);
  private dialogRef = inject(MatDialogRef<CreateChannelDialogComponent>);
  private data      = inject<{ workspaceId: string }>(MAT_DIALOG_DATA);
  private fb        = inject(FormBuilder);

  readonly saving = signal(false);
  readonly error  = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(255)]],
  });

  submit(): void {
    if (this.form.invalid) return;
    const { name } = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    this.chSvc.create(name, this.data.workspaceId).subscribe({
      next:  () => { this.saving.set(false); this.dialogRef.close(true); },
      error: (err: AppError) => {
        this.saving.set(false);
        this.error.set(err.message ?? 'Failed to create channel');
      },
    });
  }
}
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.app.json
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/features/chat/create-channel-dialog/create-channel-dialog.component.ts
git commit -m "feat(frontend): CreateChannelDialogComponent"
```

---

## Task 17: Frontend — ChannelViewComponent (TDD)

**Files:**
- Create: `frontend/src/app/features/chat/channel-view/channel-view.component.spec.ts`
- Create: `frontend/src/app/features/chat/channel-view/channel-view.component.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/app/features/chat/channel-view/channel-view.component.spec.ts`:

```typescript
// frontend/src/app/features/chat/channel-view/channel-view.component.spec.ts
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { ReactiveFormsModule } from '@angular/forms';
import { signal } from '@angular/core';
import { of, Subscription } from 'rxjs';
import { ChannelViewComponent } from './channel-view.component';
import { MessageService } from '../../../core/services/message.service';
import { ChannelService } from '../../../core/services/channel.service';
import { Message } from '../../../core/models/message.model';
import { Channel } from '../../../core/models/channel.model';

const MSG: Message = {
  id: 'msg-1', channelId: 'ch-1', senderUserId: 'u-1',
  body: 'Hello!', clientMessageId: 'cid-1', createdAt: '2024-01-01T10:00:00.000Z',
};

const CH: Channel = {
  id: 'ch-1', orgId: 'org-1', workspaceId: 'ws-1',
  type: 'group', name: 'general', createdAt: '',
};

describe('ChannelViewComponent', () => {
  let fixture: ComponentFixture<ChannelViewComponent>;
  let msgSvc: { messages: ReturnType<typeof signal<Message[]>>; sending: ReturnType<typeof signal<boolean>>; load: jest.Mock; send: jest.Mock; subscribeRealtime: jest.Mock };
  let chSvc:  { channels: ReturnType<typeof signal<Channel[]>> };

  beforeEach(async () => {
    msgSvc = {
      messages:           signal<Message[]>([]),
      sending:            signal(false),
      load:               jest.fn().mockReturnValue(of([])),
      send:               jest.fn().mockReturnValue(of(MSG)),
      subscribeRealtime:  jest.fn().mockReturnValue(new Subscription()),
    };
    chSvc = {
      channels: signal<Channel[]>([CH]),
    };

    await TestBed.configureTestingModule({
      imports: [ChannelViewComponent, ReactiveFormsModule],
      providers: [
        { provide: MessageService, useValue: msgSvc },
        { provide: ChannelService, useValue: chSvc },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 'ch-1' } } },
        },
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ChannelViewComponent);
    fixture.detectChanges();
  });

  it('calls load() and subscribeRealtime() with channelId on init', fakeAsync(() => {
    tick();
    expect(msgSvc.load).toHaveBeenCalledWith('ch-1');
    expect(msgSvc.subscribeRealtime).toHaveBeenCalledWith('ch-1');
  }));

  it('renders a message row for each message', fakeAsync(() => {
    msgSvc.messages.set([MSG]);
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('.message-row');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Hello!');
  }));

  it('shows empty state when no messages', fakeAsync(() => {
    msgSvc.messages.set([]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No messages yet');
  }));

  it('calls send() and resets form on submit', fakeAsync(() => {
    const input = fixture.nativeElement.querySelector('.message-input');
    input.value = 'Hi there';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const form = fixture.nativeElement.querySelector('form');
    form.dispatchEvent(new Event('submit'));
    tick();
    expect(msgSvc.send).toHaveBeenCalledWith('ch-1', 'Hi there');
  }));
});
```

- [ ] **Step 2: Run tests — expect them to fail**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="channel-view.component.spec"
```

Expected: `FAIL — Cannot find module './channel-view.component'`.

- [ ] **Step 3: Implement ChannelViewComponent**

Create `frontend/src/app/features/chat/channel-view/channel-view.component.ts`:

```typescript
// frontend/src/app/features/chat/channel-view/channel-view.component.ts
import { Component, OnInit, OnDestroy, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { MessageService } from '../../../core/services/message.service';
import { ChannelService } from '../../../core/services/channel.service';

@Component({
  selector: 'app-channel-view',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="channel-view">
      <div class="channel-header"># {{ channelName() }}</div>

      <div class="message-list">
        @for (msg of messages(); track msg.id) {
          <div class="message-row">
            <span class="message-sender">{{ msg.senderUserId }}</span>
            <span class="message-body">{{ msg.body }}</span>
            <span class="message-time">{{ msg.createdAt | date:'shortTime' }}</span>
          </div>
        }

        @if (messages().length === 0) {
          <div class="message-empty">No messages yet — say hello!</div>
        }
      </div>

      <form class="message-input-row" [formGroup]="form" (ngSubmit)="send()">
        <input
          formControlName="body"
          class="message-input"
          [placeholder]="'Message #' + channelName() + '…'"
          autocomplete="off"
        />
        <button type="submit" class="message-send-btn" [disabled]="form.invalid || sending()">
          Send
        </button>
      </form>
    </div>
  `,
})
export class ChannelViewComponent implements OnInit, OnDestroy {
  private route    = inject(ActivatedRoute);
  private msgSvc   = inject(MessageService);
  private chSvc    = inject(ChannelService);
  private fb       = inject(FormBuilder);

  private realtimeSub?: Subscription;
  private channelId = signal('');

  readonly messages    = this.msgSvc.messages;
  readonly sending     = this.msgSvc.sending;
  readonly channelName = computed(() => {
    const ch = this.chSvc.channels().find(c => c.id === this.channelId());
    return ch?.name ?? '';
  });

  readonly form = this.fb.nonNullable.group({
    body: ['', Validators.required],
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('channelId')!;
    this.channelId.set(id);
    this.msgSvc.load(id).subscribe();
    this.realtimeSub = this.msgSvc.subscribeRealtime(id);
  }

  ngOnDestroy(): void {
    this.realtimeSub?.unsubscribe();
  }

  send(): void {
    if (this.form.invalid) return;
    const { body } = this.form.getRawValue();
    this.msgSvc.send(this.channelId(), body).subscribe({
      next: () => this.form.reset(),
    });
  }
}
```

- [ ] **Step 4: Run tests — expect them to pass**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="channel-view.component.spec"
```

Expected: `PASS — 4 tests passed`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/features/chat/channel-view/channel-view.component.ts \
        frontend/src/app/features/chat/channel-view/channel-view.component.spec.ts
git commit -m "feat(frontend): ChannelViewComponent with real-time messages and send (TDD)"
```

---

## Task 18: Smoke Test — Full suite green

- [ ] **Step 1: Run all frontend unit tests**

```bash
cd frontend && npx ng test --watch=false
```

Expected — all suites pass including:
```
PASS src/app/core/services/token-storage.service.spec.ts
PASS src/app/core/services/tenant.service.spec.ts
PASS src/app/core/services/auth.service.spec.ts
PASS src/app/core/services/workspace.service.spec.ts
PASS src/app/core/services/socket.service.spec.ts
PASS src/app/core/services/task.service.spec.ts
PASS src/app/core/services/channel.service.spec.ts
PASS src/app/core/services/message.service.spec.ts
PASS src/app/core/interceptors/jwt.interceptor.spec.ts
PASS src/app/core/interceptors/idempotency.interceptor.spec.ts
PASS src/app/core/interceptors/error.interceptor.spec.ts
PASS src/app/core/guards/auth.guard.spec.ts
PASS src/app/core/guards/org.guard.spec.ts
PASS src/app/features/auth/login/login.component.spec.ts
PASS src/app/features/auth/mfa/mfa.component.spec.ts
PASS src/app/features/workspace/workspace-list/workspace-list.component.spec.ts
PASS src/app/features/org-picker/org-picker.component.spec.ts
PASS src/app/features/shell/workspace-shell/workspace-shell.component.spec.ts
PASS src/app/features/shell/workspace-shell/workspace-sidebar/workspace-sidebar.component.spec.ts
PASS src/app/features/task/task-list/task-list.component.spec.ts
PASS src/app/features/chat/channel-view/channel-view.component.spec.ts
PASS src/app/app.component.spec.ts
```

If any suite fails, fix it before continuing.

- [ ] **Step 2: TypeScript compile check — frontend**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.app.json
```

Expected: zero errors.

- [ ] **Step 3: TypeScript compile check — backend**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: Angular Phase 3A — task management + workspace chat (MVP)"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Migration 017 — workspace_id on channels — Task 1
- ✅ ChannelRepository + ChannelService updated for workspace filter — Task 2 + 3
- ✅ `POST /channels/workspace` endpoint — Task 3
- ✅ Task, Channel, Message models with Dto mappers — Tasks 4 + 5
- ✅ WorkspaceService.loadOne() + activeWorkspace signal — Task 6
- ✅ TaskService TDD — load, create, updateStatus + optimistic revert — Task 7
- ✅ ChannelService TDD — load with filter, create — Task 8
- ✅ MessageService TDD — load, send, subscribeRealtime, dedupe — Task 9
- ✅ CSS classes for workspace shell, tasks, chat — Task 10
- ✅ WorkspaceSidebarComponent TDD — Task 11
- ✅ WorkspaceShellComponent TDD — Task 12
- ✅ workspace-shell.routes.ts + shell.routes.ts — Task 13
- ✅ CreateTaskDialogComponent — Task 14
- ✅ TaskListComponent TDD — grouped by status, inline update — Task 15
- ✅ CreateChannelDialogComponent — Task 16
- ✅ ChannelViewComponent TDD — messages, send, realtime, unsub on destroy — Task 17
- ✅ Full smoke test — Task 18

**Type consistency:**
- `toTask(TaskDto): Task` — defined Task 4, used Tasks 7, 15 ✅
- `toChannel(ChannelDto): Channel` — defined Task 5, used Tasks 8, 11 ✅
- `toMessage(MessageDto): Message` — defined Task 5, used Tasks 9, 17 ✅
- `WorkspaceService.activeWorkspace` — defined Task 6, used Task 12 ✅
- `TaskService.updateStatus(taskId, status, version)` — defined Task 7, used Task 15 ✅
- `MessageService.subscribeRealtime(channelId): Subscription` — defined Task 9, used Task 17 ✅
- `WorkspaceSidebarComponent @Input workspaceId` — defined Task 11, passed in Task 12 ✅
