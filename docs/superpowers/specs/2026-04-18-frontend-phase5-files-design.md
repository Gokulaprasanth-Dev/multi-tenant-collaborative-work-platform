# Frontend Phase 5 — File Management Design

**Date:** 2026-04-18
**Scope:** Angular frontend — file upload, preview, and management. Shared upload component wired into chat and tasks. Standalone Files page.

---

## State Machine

Each upload is an independent `FileUpload` object. States:

```
PENDING → UPLOADING → SCANNING → READY
                    ↘           ↘ REJECTED  (terminal, stays red until dismissed)
               CANCELLED        ERROR → retry → UPLOADING
```

```typescript
type UploadState = 'pending' | 'uploading' | 'scanning' | 'ready' | 'rejected' | 'cancelled' | 'error';

interface FileUpload {
  id: string;              // client-side uuid
  file: File;
  state: UploadState;
  progress: number;        // 0–100, meaningful only in 'uploading'
  fileId?: string;         // set on 'ready' — valid to include in API payloads
  error?: string;          // set on 'error' | 'rejected'
  abortController?: AbortController; // alive only in 'uploading'
}
```

- `REJECTED` and `CANCELLED` are terminal — no retry, user re-selects.
- Both stay red in the list until manually dismissed (no silent auto-remove).
- `ERROR` allows retry (re-enters `UPLOADING`).

---

## Architecture

### FileService (core singleton — stateless orchestrator)

`FileService` runs the upload pipeline but owns no list. It takes a file and a state-change callback; the caller owns the `FileUpload` object.

```typescript
// Public API
upload(file: File, onStateChange: (update: Partial<FileUpload>) => void): void;
// cancel is handled by calling abortController.abort() on the FileUpload object
```

**Pipeline steps:**
1. `POST /files/upload-url` → `{ uploadUrl, fileId }` — transitions to `uploading`
2. `XHR PUT <uploadUrl>` with progress events — updates `progress` (0–100)
3. `POST /files/:id/confirm` — transitions to `scanning`, then `ready` (200) or `rejected` (422)
4. On XHR abort → `cancelled`
5. On network error at any step → `error` with message

### Shared Components (`shared/components/file-upload/`, `shared/components/file-preview/`)

**`FileUploadComponent`** — owns its own `signal<FileUpload[]>`. Provides:
- Drag-and-drop zone (via `ngx-dropzone`)
- Paste listener (`(paste)` on host, reads `ClipboardEvent.clipboardData.files`)
- File picker button (`<input type="file" multiple>`)
- Upload chips — one per entry in signal, visible from `PENDING` onward
- `@Output() fileReady = new EventEmitter<string>()` — fires `fileId` when state hits `READY`
- Cancel button on `UPLOADING` chips (calls `abortController.abort()`)
- Dismiss button on `REJECTED`/`CANCELLED`/`ERROR` chips (removes from local signal)

The send button of the host form is disabled while any attachment is in `uploading | scanning | error`.

**`FilePreviewComponent`** — given `{ url: string, mimeType: string, name: string }`, renders:

| MIME type | Renderer |
|-----------|----------|
| `image/*` | `<img [src]="url">` |
| `application/pdf` | `<iframe [src]="safeUrl" type="application/pdf">` |
| `video/*` | `<video [src]="url" controls>` |
| `audio/*` | `<audio [src]="url" controls>` |
| everything else | Download anchor — `GET /files/:id/download` for presigned URL |

> **Known gap:** `<iframe>` PDF rendering is broken on Safari iOS (opens externally or fails). The platform is desktop-first; if mobile scope expands, swap to PDF.js or a server-side PDF-to-image pipeline.

**`FileChipComponent`** — compact chip (filename, size, state icon, remove button) for use in task/chat input areas.

### Feature: `features/files/`

Standalone Files page:
- Workspace-scoped file list from `GET /files?workspaceId=:id` (paginated, sorted by `created_at` desc)
- `FileUploadComponent` at top of page
- Grid/list view toggle
- `FilePreviewComponent` in a modal on click
- Delete with confirm dialog → `DELETE /files/:id`

---

## Integration: Chat & Tasks

**Scoped signal principle:** Each `FileUploadComponent` instance owns its own signal. `dismiss()` only removes from that instance's list. No cross-context leakage — a dismiss on the Files page cannot remove a chip from an active chat compose area.

**Chat (`MessageInputComponent`):**
- Mount `<app-file-upload (fileReady)="onFileReady($event)">` below text input
- `onFileReady` appends `fileId` to `attachments: string[]`
- Attachments sent in message payload: `{ content, attachments }`
- `FileChipComponent` per attachment in the compose area (with remove)

**Tasks (`CommentEditorComponent`):**
- Same pattern — `FileUploadComponent` in comment footer
- `fileReady` appends to comment's `attachments` array

---

## API Endpoints (backend already implemented)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/files/upload-url` | Get presigned S3 URL + fileId |
| `PUT` | `<presigned S3 URL>` | Direct S3 upload (XHR with progress) |
| `POST` | `/files/:id/confirm` | Trigger scan, finalize |
| `GET` | `/files` | Paginated file list (workspace-scoped) |
| `GET` | `/files/:id/download` | Presigned download URL |
| `DELETE` | `/files/:id` | Delete file |

All requests carry `Authorization` + `X-Org-ID` + `Idempotency-Key` headers via `JwtInterceptor`.

---

## Testing Strategy

- **`FileService`**: unit-test each state transition — mock `HttpClient` for presigned URL and confirm; mock XHR for progress events and abort
- **`FileUploadComponent`**: test drop event, paste event, picker trigger, cancel button (abort), dismiss button, `fileReady` output fires only on `READY`
- **`FilePreviewComponent`**: test correct element rendered per MIME type (image/pdf/video/audio/other)
- **`FileChipComponent`**: test state-specific class and button visibility
- **Integration (FileUploadComponent + FileService)**: upload pipeline from `pending` → `ready` end-to-end with `HttpClientTestingModule`
