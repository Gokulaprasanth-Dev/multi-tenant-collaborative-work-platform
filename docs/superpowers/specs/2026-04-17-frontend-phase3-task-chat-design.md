# Frontend Phase 3A — Task Management + Chat (MVP)

**Date:** 2026-04-17
**Status:** Approved

## Scope

Phase 3A delivers a working MVP of both core collaboration features inside a workspace:
- **Task management:** task list grouped by status, create/assign/status-update/comment on tasks
- **Chat:** workspace-scoped channels, real-time messaging via SocketService

Deferred to Phase 3B: board (Kanban) view, subtasks, DMs, file sharing, message reactions, thread replies.

---

## Architecture

### Routing

```
/app                           → ShellComponent (outer shell, workspace list sidebar)
  /workspaces                  → WorkspaceListComponent  [existing]
  /workspaces/:id              → WorkspaceShellComponent [new inner shell]
    ''                         → redirect → tasks
    /tasks                     → TaskListComponent
    /chat/:channelId           → ChannelViewComponent
    /chat                      → redirect → first channel (or empty state)
```

`WorkspaceShellComponent` renders inside the outer shell's `<main class="main-content">`. It uses its own CSS Grid (`160px sidebar + 1fr`) that fills 100% of the available area — no full-page re-layout needed.

### Navigation

Entering a workspace replaces the visible sidebar content with `WorkspaceSidebarComponent`:
- Back arrow → `/app/workspaces`
- Workspace name (heading)
- **Tasks** nav link → `/app/workspaces/:id/tasks`
- **Chat** section header + channel list (one link per channel) → `/app/workspaces/:id/chat/:channelId`
- "+" button to create a new channel

### Backend Changes

Three small additions required before frontend work begins:

1. **Migration `017_channel_workspace_id.js`** — adds nullable `workspace_id UUID REFERENCES workspaces(id)` column on `channels` table. Existing channels unaffected.
2. **`GET /api/v1/orgs/:orgId/channels?workspaceId=`** — filter channels by workspace when query param provided.
3. **`POST /api/v1/orgs/:orgId/channels/group`** — accept optional `workspace_id` in request body.

---

## Components

### Workspace Shell

| Component | File | Purpose |
|---|---|---|
| `WorkspaceShellComponent` | `features/shell/workspace-shell/workspace-shell.component.ts` | Resolves `:id`, loads workspace + channels, renders inner sidebar + `<router-outlet>` |
| `WorkspaceSidebarComponent` | `features/shell/workspace-shell/workspace-sidebar/workspace-sidebar.component.ts` | Back arrow, workspace name, Tasks link, channel list, create-channel button |

### Tasks

| Component | File | Purpose |
|---|---|---|
| `TaskListComponent` | `features/task/task-list/task-list.component.ts` | Tasks grouped by status (todo / in_progress / done), "+ New Task" button |
| `CreateTaskDialogComponent` | `features/task/create-task-dialog/create-task-dialog.component.ts` | Material dialog: name (required), description, assignee, due date, priority |

### Chat

| Component | File | Purpose |
|---|---|---|
| `ChannelViewComponent` | `features/chat/channel-view/channel-view.component.ts` | Scrollable message list (newest at bottom), message input, real-time via SocketService |
| `CreateChannelDialogComponent` | `features/chat/create-channel-dialog/create-channel-dialog.component.ts` | Material dialog: channel name |

---

## Services

All services use Angular Signals for state and follow the TDD pattern from Phase 2.

### `TaskService`

```
signals:  tasks: Signal<Task[]>, loading: Signal<boolean>
methods:  load(workspaceId): Observable<Task[]>
          create(workspaceId, payload): Observable<Task>
          updateStatus(taskId, status): Observable<Task>  [optimistic update]
API:      GET  /api/v1/orgs/:orgId/tasks?workspaceId=:id
          POST /api/v1/orgs/:orgId/tasks
          PATCH /api/v1/orgs/:orgId/tasks/:taskId
```

### `ChannelService`

```
signals:  channels: Signal<Channel[]>, loading: Signal<boolean>
methods:  load(workspaceId): Observable<Channel[]>
          create(name, workspaceId): Observable<Channel>
API:      GET  /api/v1/orgs/:orgId/channels?workspaceId=:id
          POST /api/v1/orgs/:orgId/channels/workspace  { name, workspace_id }
          (new dedicated endpoint — group endpoint requires min 2 member_ids which breaks single-creator channels)
```

### `MessageService`

```
signals:  messages: Signal<Message[]>, sending: Signal<boolean>
methods:  load(channelId): Observable<Message[]>
          send(channelId, body): Observable<Message>  [generates client_message_id UUID internally]
          subscribeRealtime(channelId): Subscription  [SocketService.fromEvent('chat:message')]
API:      GET  /api/v1/orgs/:orgId/channels/:channelId/messages?limit=50
          POST /api/v1/orgs/:orgId/channels/:channelId/messages  { body, client_message_id }
```

---

## Models

### Task

```typescript
interface Task {
  id: string;
  orgId: string;
  workspaceId: string;
  title: string;
  description: string | null;
  status: 'todo' | 'in_progress' | 'done';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assigneeUserId: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### Channel

```typescript
interface Channel {
  id: string;
  orgId: string;
  workspaceId: string | null;
  name: string;
  type: 'direct' | 'group';
  createdAt: string;
}
```

### Message

```typescript
interface Message {
  id: string;
  channelId: string;
  senderUserId: string;
  body: string;           // backend field name is `body`, not `content`
  clientMessageId: string; // UUID sent by client for idempotency
  createdAt: string;
}
```

> `senderName` is not returned by the backend — display the sender's userId short-form or resolve via a `UserService.getDisplayName()` helper (added to Phase 3B).

---

## Data Flow

### Workspace Entry

1. User clicks workspace → navigates to `/app/workspaces/:id`
2. `WorkspaceShellComponent.ngOnInit()` reads `:id` from route params
3. `WorkspaceService.loadOne(id)` → sets `activeWorkspace` signal
4. `ChannelService.load(workspaceId)` → populates sidebar channel list
5. Default child redirect → `/tasks` → `TaskService.load(workspaceId)` fires

### Task Status Update

- Inline status toggle on task row → `TaskService.updateStatus(taskId, newStatus)`
- Optimistic: signal updated immediately; reverted on HTTP error with inline error banner

### Chat Message Flow

1. User submits message → `MessageService.send(channelId, content)` → POST
2. Backend emits `chat:message` event via Redis pub/sub → Socket.IO broadcasts to org room
3. `MessageService.subscribeRealtime()` receives event → appends to `messages` signal
4. Deduplication by message `id` prevents double-append for sender

---

## Error Handling

- HTTP errors: inline banner using existing `auth-error` CSS class on list components
- Dialog errors: displayed inside dialog (pattern from `CreateWorkspaceDialogComponent`)
- Socket disconnect: topbar status dot turns grey; `ChannelViewComponent` shows "Reconnecting…" notice
- Task status revert: failed PATCH reverts signal to previous status, shows inline error

---

## Testing Plan

All services written TDD (failing spec → implementation → passing spec).

| Spec file | Key cases |
|---|---|
| `task.service.spec.ts` | `load()` with workspaceId, `create()` appends to signal, `updateStatus()` optimistic update + revert on error |
| `channel.service.spec.ts` | `load()` sends `?workspaceId=`, `create()` POSTs with `workspace_id` |
| `message.service.spec.ts` | `load()` fetches, `send()` POSTs + appends, `subscribeRealtime()` appends socket events, dedupes by id |
| `workspace-shell.component.spec.ts` | loads workspace on init, renders workspace sidebar, default-redirects to tasks |
| `task-list.component.spec.ts` | renders tasks grouped by status, shows empty state per group, calls `load()` on init |
| `channel-view.component.spec.ts` | renders messages, sends on submit, subscribes real-time on init, unsubscribes on destroy |
| `workspace-sidebar.component.spec.ts` | renders channel list, back arrow navigates to `/app/workspaces` |

Backend migration smoke test: `npm run migrate:up` applies cleanly, existing channels retain `workspace_id = null`.

---

## File Map

**Backend:**
- Create: `migrations/017_channel_workspace_id.js`
- Modify: `src/modules/chat/chat.router.ts` — add `workspaceId` filter to GET channels, add new `POST /channels/workspace` endpoint

**Frontend — services (existing, modified):**
- Modify: `frontend/src/app/core/services/workspace.service.ts` — add `loadOne(id): Observable<Workspace>` method and `activeWorkspace` signal

**Frontend — models:**
- Create: `frontend/src/app/core/models/task.model.ts`
- Create: `frontend/src/app/core/models/channel.model.ts`
- Create: `frontend/src/app/core/models/message.model.ts`

**Frontend — services:**
- Create: `frontend/src/app/core/services/task.service.ts` + `.spec.ts`
- Create: `frontend/src/app/core/services/channel.service.ts` + `.spec.ts`
- Create: `frontend/src/app/core/services/message.service.ts` + `.spec.ts`

**Frontend — workspace shell:**
- Create: `frontend/src/app/features/shell/workspace-shell/workspace-shell.component.ts` + `.spec.ts`
- Create: `frontend/src/app/features/shell/workspace-shell/workspace-sidebar/workspace-sidebar.component.ts` + `.spec.ts`
- Create: `frontend/src/app/features/shell/workspace-shell/workspace-shell.routes.ts`
- Modify: `frontend/src/app/features/shell/shell.routes.ts` — add `/workspaces/:id` lazy child

**Frontend — tasks:**
- Create: `frontend/src/app/features/task/task-list/task-list.component.ts` + `.spec.ts`
- Create: `frontend/src/app/features/task/create-task-dialog/create-task-dialog.component.ts`

**Frontend — chat:**
- Create: `frontend/src/app/features/chat/channel-view/channel-view.component.ts` + `.spec.ts`
- Create: `frontend/src/app/features/chat/create-channel-dialog/create-channel-dialog.component.ts`

**Frontend — styles:**
- Modify: `frontend/src/styles/_shell.scss` — add `.workspace-shell`, `.workspace-sidebar-*`, `.message-*`, `.task-row-*` classes
