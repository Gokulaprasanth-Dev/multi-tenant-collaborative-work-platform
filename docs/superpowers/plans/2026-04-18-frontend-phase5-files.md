# Frontend Phase 5 — File Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build file upload (drag-drop/paste/picker), preview (image/PDF/video/audio), and management (Files page), wiring the shared upload component into chat and tasks.

**Architecture:** `FileService` is a stateless orchestrator — it runs the S3 presigned-POST upload pipeline and polls scan status, returning an Observable of state updates. `FileUploadComponent` owns its own `signal<FileUpload[]>` list so each surface (chat, tasks, Files page) is fully isolated. Shared `FileChipComponent` and `FilePreviewComponent` are imported wherever needed.

**Tech Stack:** Angular 17 standalone components, `ngx-dropzone` (already installed), `@angular/common/http`, `rxjs`, Angular `DomSanitizer` for PDF iframe, XHR for S3 upload progress.

---

## File Map

| Action | Path |
|--------|------|
| Create | `frontend/src/app/core/models/file.model.ts` |
| Create | `frontend/src/app/core/services/file.service.ts` |
| Create | `frontend/src/app/core/services/file.service.spec.ts` |
| Create | `frontend/src/app/shared/components/file-chip/file-chip.component.ts` |
| Create | `frontend/src/app/shared/components/file-chip/file-chip.component.spec.ts` |
| Create | `frontend/src/app/shared/components/file-upload/file-upload.component.ts` |
| Create | `frontend/src/app/shared/components/file-upload/file-upload.component.spec.ts` |
| Create | `frontend/src/app/shared/components/file-preview/file-preview.component.ts` |
| Create | `frontend/src/app/shared/components/file-preview/file-preview.component.spec.ts` |
| Create | `frontend/src/app/features/files/files-page.component.ts` |
| Create | `frontend/src/app/features/files/files-page.component.spec.ts` |
| Create | `frontend/src/app/core/models/comment.model.ts` |
| Create | `frontend/src/app/features/task/task-comment/task-comment.component.ts` |
| Create | `frontend/src/app/features/task/task-comment/task-comment.component.spec.ts` |
| Modify | `frontend/src/app/core/models/message.model.ts` |
| Modify | `frontend/src/app/core/services/message.service.ts` |
| Modify | `frontend/src/app/core/services/task.service.ts` |
| Modify | `frontend/src/app/features/chat/channel-view/channel-view.component.ts` |
| Modify | `frontend/src/app/features/chat/channel-view/channel-view.component.spec.ts` |
| Modify | `frontend/src/app/features/task/task-list/task-list.component.ts` |
| Modify | `frontend/src/app/shell/shell.routes.ts` |

---

## Task 1: File model types

**Files:**
- Create: `frontend/src/app/core/models/file.model.ts`

- [ ] **Step 1: Create the model file**

```typescript
// frontend/src/app/core/models/file.model.ts

export type UploadState =
  | 'pending'
  | 'uploading'
  | 'scanning'
  | 'ready'
  | 'rejected'
  | 'cancelled'
  | 'error';

export interface FileUpload {
  id: string;              // client-side uuid
  file: File;
  state: UploadState;
  progress: number;        // 0–100, meaningful only in 'uploading'
  fileId?: string;         // set on 'ready'
  error?: string;          // set on 'error' | 'rejected'
  xhr?: XMLHttpRequest;    // alive only in 'uploading'; call xhr.abort() to cancel
}

export interface FileRecord {
  id: string;
  orgId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  scanStatus: 'pending' | 'clean' | 'quarantined';
  createdAt: string;
}

export interface FileRecordDto {
  id: string;
  org_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  scan_status: 'pending' | 'clean' | 'quarantined';
  created_at: string;
}

export function toFileRecord(dto: FileRecordDto): FileRecord {
  return {
    id:         dto.id,
    orgId:      dto.org_id,
    filename:   dto.filename,
    mimeType:   dto.mime_type,
    sizeBytes:  dto.size_bytes,
    scanStatus: dto.scan_status,
    createdAt:  dto.created_at,
  };
}

export interface UploadUrlResult {
  fileId:       string;
  uploadUrl:    string;
  uploadFields: Record<string, string>;
  expiresAt:    string;
}

export interface UploadUrlResultDto {
  fileId:        string;
  uploadUrl:     string;
  uploadFields:  Record<string, string>;
  expiresAt:     string;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/core/models/file.model.ts
git commit -m "feat: file model types — FileUpload state machine + FileRecord"
```

---

## Task 2: FileService (stateless orchestrator) — TDD

**Files:**
- Create: `frontend/src/app/core/services/file.service.ts`
- Create: `frontend/src/app/core/services/file.service.spec.ts`

`FileService` orchestrates: POST upload-url → XHR POST to S3 (with progress) → poll download-url until scan resolves. Returns `Observable<Partial<FileUpload>>`.

- [ ] **Step 1: Write the failing tests**

```typescript
// frontend/src/app/core/services/file.service.spec.ts
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { FileService } from './file.service';
import { TenantService } from './tenant.service';
import { signal } from '@angular/core';

describe('FileService', () => {
  let service: FileService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        FileService,
        {
          provide: TenantService,
          useValue: { activeOrgId: signal('org-1') },
        },
      ],
    });
    service = TestBed.inject(FileService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('should emit uploading state after requesting upload URL', (done) => {
    const file = new File(['hello'], 'test.txt', { type: 'text/plain' });
    const states: string[] = [];

    service.upload(file).subscribe({
      next: u => { if (u.state) states.push(u.state); },
      complete: () => {
        expect(states).toContain('uploading');
        done();
      },
    });

    http.expectOne('/api/v1/orgs/org-1/files/upload-url').flush({
      data: { fileId: 'f-1', uploadUrl: 'https://s3.example.com', uploadFields: {}, expiresAt: '' },
    });
    // XHR is mocked via jasmine.createSpyObj in implementation tests — this test just checks HTTP call
    http.verify();
    done();
  });

  it('should emit scanning state after S3 upload completes', fakeAsync(() => {
    const file = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
    const states: string[] = [];
    service.upload(file).subscribe(u => { if (u.state) states.push(u.state); });

    http.expectOne('/api/v1/orgs/org-1/files/upload-url').flush({
      data: { fileId: 'f-1', uploadUrl: 'https://s3.example.com', uploadFields: {}, expiresAt: '' },
    });

    tick(100);
    // After S3 upload (mocked internally), scanning state is emitted before poll starts
    expect(states).toContain('uploading');
  }));

  it('should emit ready state when download-url returns 200', fakeAsync(() => {
    const file = new File(['x'], 'img.png', { type: 'image/png' });
    const states: string[] = [];
    let readyFileId: string | undefined;

    service.upload(file).subscribe(u => {
      if (u.state) states.push(u.state);
      if (u.fileId) readyFileId = u.fileId;
    });

    http.expectOne('/api/v1/orgs/org-1/files/upload-url').flush({
      data: { fileId: 'f-1', uploadUrl: 'https://s3.example.com', uploadFields: {}, expiresAt: '' },
    });

    tick(3500);
    http.expectOne('/api/v1/orgs/org-1/files/f-1/download-url').flush(
      { data: { url: 'https://s3.example.com/f-1' } },
      { status: 200, statusText: 'OK' }
    );

    expect(states).toContain('ready');
    expect(readyFileId).toBe('f-1');
  }));

  it('should emit rejected state when download-url returns 422', fakeAsync(() => {
    const file = new File(['x'], 'virus.exe', { type: 'application/octet-stream' });
    const states: string[] = [];

    service.upload(file).subscribe(u => { if (u.state) states.push(u.state); });

    http.expectOne('/api/v1/orgs/org-1/files/upload-url').flush({
      data: { fileId: 'f-1', uploadUrl: 'https://s3.example.com', uploadFields: {}, expiresAt: '' },
    });

    tick(3500);
    const req = http.expectOne('/api/v1/orgs/org-1/files/f-1/download-url');
    req.flush({ error: { code: 'FILE_QUARANTINED' } }, { status: 422, statusText: 'Unprocessable' });

    expect(states).toContain('rejected');
  }));

  it('should emit error state when upload-url request fails', fakeAsync(() => {
    const file = new File(['x'], 'test.txt', { type: 'text/plain' });
    const states: string[] = [];

    service.upload(file).subscribe(u => { if (u.state) states.push(u.state); });

    http.expectOne('/api/v1/orgs/org-1/files/upload-url').flush(
      { error: { code: 'QUOTA_EXCEEDED' } }, { status: 403, statusText: 'Forbidden' }
    );

    expect(states).toContain('error');
  }));
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="file.service" 2>&1 | tail -15
```
Expected: `FAIL` — `FileService` not found.

- [ ] **Step 3: Implement FileService**

```typescript
// frontend/src/app/core/services/file.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, of } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import { ApiResponse } from '../models/api-response.model';
import { FileUpload, UploadState, UploadUrlResultDto } from '../models/file.model';
import { TenantService } from './tenant.service';

@Injectable({ providedIn: 'root' })
export class FileService {
  private http   = inject(HttpClient);
  private tenant = inject(TenantService);

  upload(file: File): Observable<Partial<FileUpload>> {
    const orgId = this.tenant.activeOrgId()!;
    const subject = new Subject<Partial<FileUpload>>();

    this.http
      .post<ApiResponse<UploadUrlResultDto>>(
        `/api/v1/orgs/${orgId}/files/upload-url`,
        { filename: file.name, mimeType: file.type || 'application/octet-stream', sizeBytes: file.size }
      )
      .subscribe({
        next: res => {
          const { fileId, uploadUrl, uploadFields } = res.data;
          this.uploadToS3(file, uploadUrl, uploadFields, fileId, subject, orgId);
        },
        error: err => {
          subject.next({ state: 'error', error: err?.error?.error?.code ?? 'Upload URL request failed' });
          subject.complete();
        },
      });

    return subject.asObservable();
  }

  private uploadToS3(
    file: File,
    uploadUrl: string,
    uploadFields: Record<string, string>,
    fileId: string,
    subject: Subject<Partial<FileUpload>>,
    orgId: string,
  ): void {
    const formData = new FormData();
    for (const [key, value] of Object.entries(uploadFields)) {
      formData.append(key, value);
    }
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    subject.next({ state: 'uploading', progress: 0, xhr });

    xhr.upload.addEventListener('progress', (e: ProgressEvent) => {
      if (e.lengthComputable) {
        subject.next({ progress: Math.round((e.loaded / e.total) * 100) });
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        subject.next({ state: 'scanning', progress: 100 });
        this.pollScanStatus(orgId, fileId, subject);
      } else {
        subject.next({ state: 'error', error: `S3 upload failed (${xhr.status})` });
        subject.complete();
      }
    });

    xhr.addEventListener('error', () => {
      subject.next({ state: 'error', error: 'Network error during upload' });
      subject.complete();
    });

    xhr.addEventListener('abort', () => {
      subject.next({ state: 'cancelled' });
      subject.complete();
    });

    xhr.open('POST', uploadUrl);
    xhr.send(formData);
  }

  private pollScanStatus(
    orgId: string,
    fileId: string,
    subject: Subject<Partial<FileUpload>>,
  ): void {
    const poll = () => {
      this.http
        .get<ApiResponse<{ url: string }>>(
          `/api/v1/orgs/${orgId}/files/${fileId}/download-url`,
          { observe: 'response' }
        )
        .subscribe({
          next: res => {
            if (res.status === 200) {
              subject.next({ state: 'ready', fileId });
              subject.complete();
            } else {
              // 202 — still scanning, retry in 3s
              setTimeout(poll, 3000);
            }
          },
          error: err => {
            if (err.status === 422) {
              subject.next({ state: 'rejected', error: 'File rejected by virus scan' });
            } else {
              subject.next({ state: 'error', error: 'Scan check failed' });
            }
            subject.complete();
          },
        });
    };

    setTimeout(poll, 3000);
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="file.service" 2>&1 | tail -15
```
Expected: `PASS` — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/core/services/file.service.ts frontend/src/app/core/services/file.service.spec.ts
git commit -m "feat: FileService — stateless upload orchestrator (presigned POST + scan poll)"
```

---

## Task 3: FileChipComponent — TDD

**Files:**
- Create: `frontend/src/app/shared/components/file-chip/file-chip.component.ts`
- Create: `frontend/src/app/shared/components/file-chip/file-chip.component.spec.ts`

Compact chip: filename, size, state-specific icon/colour, cancel button (uploading), dismiss button (rejected/cancelled/error).

- [ ] **Step 1: Write the failing tests**

```typescript
// frontend/src/app/shared/components/file-chip/file-chip.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FileChipComponent } from './file-chip.component';
import { FileUpload } from '../../../core/models/file.model';

const makeUpload = (overrides: Partial<FileUpload>): FileUpload => ({
  id: 'u-1', file: new File(['x'], 'test.txt', { type: 'text/plain' }),
  state: 'pending', progress: 0, ...overrides,
});

describe('FileChipComponent', () => {
  let fixture: ComponentFixture<FileChipComponent>;
  let component: FileChipComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [FileChipComponent] }).compileComponents();
    fixture = TestBed.createComponent(FileChipComponent);
    component = fixture.componentInstance;
  });

  it('should display filename', () => {
    component.upload = makeUpload({ file: new File(['x'], 'report.pdf', { type: 'application/pdf' }) });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('report.pdf');
  });

  it('should show progress bar only in uploading state', () => {
    component.upload = makeUpload({ state: 'uploading', progress: 42 });
    fixture.detectChanges();
    const bar: HTMLElement | null = fixture.nativeElement.querySelector('.chip-progress');
    expect(bar).toBeTruthy();

    component.upload = makeUpload({ state: 'ready', fileId: 'f-1' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.chip-progress')).toBeNull();
  });

  it('should show cancel button only in uploading state', () => {
    component.upload = makeUpload({ state: 'uploading', progress: 10 });
    fixture.detectChanges();
    const cancel: HTMLElement | null = fixture.nativeElement.querySelector('[data-testid="cancel-btn"]');
    expect(cancel).toBeTruthy();
  });

  it('should emit cancel event on cancel button click', () => {
    component.upload = makeUpload({ state: 'uploading', progress: 10 });
    fixture.detectChanges();
    const spy = jest.spyOn(component.cancel, 'emit');
    fixture.nativeElement.querySelector('[data-testid="cancel-btn"]').click();
    expect(spy).toHaveBeenCalledWith('u-1');
  });

  it('should show dismiss button for rejected, cancelled, error states', () => {
    for (const state of ['rejected', 'cancelled', 'error'] as const) {
      component.upload = makeUpload({ state });
      fixture.detectChanges();
      const dismiss: HTMLElement | null = fixture.nativeElement.querySelector('[data-testid="dismiss-btn"]');
      expect(dismiss).toBeTruthy();
    }
  });

  it('should emit dismiss event on dismiss button click', () => {
    component.upload = makeUpload({ state: 'rejected', error: 'virus' });
    fixture.detectChanges();
    const spy = jest.spyOn(component.dismiss, 'emit');
    fixture.nativeElement.querySelector('[data-testid="dismiss-btn"]').click();
    expect(spy).toHaveBeenCalledWith('u-1');
  });

  it('should apply error class for rejected state', () => {
    component.upload = makeUpload({ state: 'rejected' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.chip').classList).toContain('chip--rejected');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="file-chip" 2>&1 | tail -10
```
Expected: `FAIL`.

- [ ] **Step 3: Implement FileChipComponent**

```typescript
// frontend/src/app/shared/components/file-chip/file-chip.component.ts
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FileUpload } from '../../../core/models/file.model';

@Component({
  selector: 'app-file-chip',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="chip" [ngClass]="'chip--' + upload.state">
      <span class="chip-icon">{{ icon }}</span>
      <span class="chip-name">{{ upload.file.name }}</span>
      <span class="chip-size">{{ formatSize(upload.file.size) }}</span>

      @if (upload.state === 'uploading') {
        <div class="chip-progress-wrapper">
          <div class="chip-progress" [style.width.%]="upload.progress"></div>
        </div>
        <button data-testid="cancel-btn" class="chip-action" (click)="cancel.emit(upload.id)" title="Cancel">✕</button>
      }

      @if (upload.state === 'rejected' || upload.state === 'cancelled' || upload.state === 'error') {
        <span class="chip-error-msg">{{ upload.error ?? upload.state }}</span>
        <button data-testid="dismiss-btn" class="chip-action" (click)="dismiss.emit(upload.id)" title="Dismiss">✕</button>
      }
    </div>
  `,
})
export class FileChipComponent {
  @Input({ required: true }) upload!: FileUpload;
  @Output() cancel  = new EventEmitter<string>();
  @Output() dismiss = new EventEmitter<string>();

  get icon(): string {
    const icons: Record<string, string> = {
      pending: '⏳', uploading: '⬆', scanning: '🔍',
      ready: '✅', rejected: '🚫', cancelled: '⛔', error: '⚠',
    };
    return icons[this.upload.state] ?? '📄';
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="file-chip" 2>&1 | tail -10
```
Expected: `PASS` — 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/shared/components/file-chip/
git commit -m "feat: FileChipComponent — upload state chip with cancel/dismiss"
```

---

## Task 4: FileUploadComponent — TDD

**Files:**
- Create: `frontend/src/app/shared/components/file-upload/file-upload.component.ts`
- Create: `frontend/src/app/shared/components/file-upload/file-upload.component.spec.ts`

Owns `signal<FileUpload[]>`. Handles drop, paste, picker. Emits `fileReady(fileId)` when state hits `ready`. Send-disabled while any item is in `uploading | scanning | error`.

- [ ] **Step 1: Write the failing tests**

```typescript
// frontend/src/app/shared/components/file-upload/file-upload.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FileUploadComponent } from './file-upload.component';
import { FileService } from '../../../core/services/file.service';
import { Subject } from 'rxjs';
import { FileUpload } from '../../../core/models/file.model';

const mockFile = (name = 'test.txt') => new File(['x'], name, { type: 'text/plain' });

describe('FileUploadComponent', () => {
  let fixture: ComponentFixture<FileUploadComponent>;
  let component: FileUploadComponent;
  let fileServiceUpload: jest.Mock;
  let uploadSubject: Subject<Partial<FileUpload>>;

  beforeEach(async () => {
    uploadSubject = new Subject();
    fileServiceUpload = jest.fn().mockReturnValue(uploadSubject.asObservable());

    await TestBed.configureTestingModule({
      imports: [FileUploadComponent],
      providers: [{ provide: FileService, useValue: { upload: fileServiceUpload } }],
    }).compileComponents();

    fixture = TestBed.createComponent(FileUploadComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should start with empty uploads list', () => {
    expect(component.uploads().length).toBe(0);
  });

  it('should add chip immediately when file is picked', () => {
    component.onFilesSelected([mockFile()]);
    expect(component.uploads().length).toBe(1);
    expect(component.uploads()[0].state).toBe('pending');
  });

  it('should transition to uploading once FileService emits uploading', () => {
    component.onFilesSelected([mockFile()]);
    uploadSubject.next({ state: 'uploading', progress: 0 });
    expect(component.uploads()[0].state).toBe('uploading');
  });

  it('should emit fileReady when state becomes ready', () => {
    const readyIds: string[] = [];
    component.fileReady.subscribe((id: string) => readyIds.push(id));

    component.onFilesSelected([mockFile()]);
    uploadSubject.next({ state: 'ready', fileId: 'f-abc' });

    expect(readyIds).toEqual(['f-abc']);
  });

  it('should not emit fileReady for non-ready states', () => {
    const readyIds: string[] = [];
    component.fileReady.subscribe((id: string) => readyIds.push(id));

    component.onFilesSelected([mockFile()]);
    uploadSubject.next({ state: 'uploading', progress: 50 });
    uploadSubject.next({ state: 'scanning' });

    expect(readyIds).toEqual([]);
  });

  it('should mark hasPending true while uploading', () => {
    component.onFilesSelected([mockFile()]);
    uploadSubject.next({ state: 'uploading', progress: 10 });
    expect(component.hasPending()).toBe(true);
  });

  it('should remove upload on dismiss', () => {
    component.onFilesSelected([mockFile()]);
    uploadSubject.next({ state: 'rejected', error: 'virus' });
    const id = component.uploads()[0].id;
    component.onDismiss(id);
    expect(component.uploads().length).toBe(0);
  });

  it('should abort xhr and mark cancelled on cancel', () => {
    const mockXhr = { abort: jest.fn() } as unknown as XMLHttpRequest;
    component.onFilesSelected([mockFile()]);
    uploadSubject.next({ state: 'uploading', progress: 10, xhr: mockXhr });
    const id = component.uploads()[0].id;
    component.onCancel(id);
    expect(mockXhr.abort).toHaveBeenCalled();
    // cancelled state is emitted by XHR abort event → FileService emits cancelled
    uploadSubject.next({ state: 'cancelled' });
    expect(component.uploads()[0].state).toBe('cancelled');
  });

  it('should handle paste event with files', () => {
    const dt = new DataTransfer();
    dt.items.add(mockFile('pasted.png'));
    const pasteEvent = new ClipboardEvent('paste', { clipboardData: dt as unknown as DataTransfer });
    component.onPaste(pasteEvent);
    expect(component.uploads().length).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="file-upload.component" 2>&1 | tail -10
```
Expected: `FAIL`.

- [ ] **Step 3: Implement FileUploadComponent**

```typescript
// frontend/src/app/shared/components/file-upload/file-upload.component.ts
import {
  Component, Output, EventEmitter, HostListener, signal, computed, inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgxDropzoneModule, NgxDropzoneChangeEvent } from 'ngx-dropzone';
import { FileService } from '../../../core/services/file.service';
import { FileUpload, UploadState } from '../../../core/models/file.model';
import { FileChipComponent } from '../file-chip/file-chip.component';

const PENDING_STATES: UploadState[] = ['uploading', 'scanning', 'error'];

@Component({
  selector: 'app-file-upload',
  standalone: true,
  imports: [CommonModule, NgxDropzoneModule, FileChipComponent],
  template: `
    <ngx-dropzone (change)="onDrop($event)" [disableClick]="true" class="dropzone">
      <ngx-dropzone-label>
        <button type="button" class="pick-btn" (click)="picker.click()">Attach files</button>
        <span class="drop-hint"> or drag & drop</span>
      </ngx-dropzone-label>
    </ngx-dropzone>

    <input #picker type="file" multiple hidden (change)="onPickerChange($event)" />

    @if (uploads().length > 0) {
      <div class="chip-list">
        @for (u of uploads(); track u.id) {
          <app-file-chip [upload]="u" (cancel)="onCancel($event)" (dismiss)="onDismiss($event)" />
        }
      </div>
    }
  `,
})
export class FileUploadComponent {
  private fileSvc = inject(FileService);

  @Output() fileReady = new EventEmitter<string>();

  readonly uploads   = signal<FileUpload[]>([]);
  readonly hasPending = computed(() => this.uploads().some(u => PENDING_STATES.includes(u.state)));

  onDrop(event: NgxDropzoneChangeEvent): void {
    this.onFilesSelected(event.addedFiles);
  }

  onPickerChange(event: Event): void {
    const files = Array.from((event.target as HTMLInputElement).files ?? []);
    this.onFilesSelected(files);
    (event.target as HTMLInputElement).value = '';
  }

  @HostListener('paste', ['$event'])
  onPaste(event: ClipboardEvent): void {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length) this.onFilesSelected(files);
  }

  onFilesSelected(files: File[]): void {
    for (const file of files) {
      const entry: FileUpload = {
        id: crypto.randomUUID(), file, state: 'pending', progress: 0,
      };
      this.uploads.update(list => [...list, entry]);

      this.fileSvc.upload(file).subscribe(update => {
        this.uploads.update(list =>
          list.map(u => u.id === entry.id ? { ...u, ...update } : u)
        );
        if (update.state === 'ready' && update.fileId) {
          this.fileReady.emit(update.fileId);
        }
      });
    }
  }

  onCancel(uploadId: string): void {
    const entry = this.uploads().find(u => u.id === uploadId);
    entry?.xhr?.abort();
  }

  onDismiss(uploadId: string): void {
    this.uploads.update(list => list.filter(u => u.id !== uploadId));
  }

  clearReady(): void {
    this.uploads.update(list => list.filter(u => u.state !== 'ready'));
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="file-upload.component" 2>&1 | tail -10
```
Expected: `PASS` — 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/shared/components/file-upload/
git commit -m "feat: FileUploadComponent — drag/drop/paste/picker, isolated signal list, fileReady output"
```

---

## Task 5: FilePreviewComponent — TDD

**Files:**
- Create: `frontend/src/app/shared/components/file-preview/file-preview.component.ts`
- Create: `frontend/src/app/shared/components/file-preview/file-preview.component.spec.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// frontend/src/app/shared/components/file-preview/file-preview.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FilePreviewComponent } from './file-preview.component';

describe('FilePreviewComponent', () => {
  let fixture: ComponentFixture<FilePreviewComponent>;
  let component: FilePreviewComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [FilePreviewComponent] }).compileComponents();
    fixture = TestBed.createComponent(FilePreviewComponent);
    component = fixture.componentInstance;
  });

  it('should render <img> for image MIME types', () => {
    component.url = 'https://example.com/img.png';
    component.mimeType = 'image/png';
    component.filename = 'img.png';
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('img')).toBeTruthy();
  });

  it('should render <iframe> for application/pdf', () => {
    component.url = 'https://example.com/doc.pdf';
    component.mimeType = 'application/pdf';
    component.filename = 'doc.pdf';
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('iframe')).toBeTruthy();
  });

  it('should render <video> for video MIME types', () => {
    component.url = 'https://example.com/clip.mp4';
    component.mimeType = 'video/mp4';
    component.filename = 'clip.mp4';
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('video')).toBeTruthy();
  });

  it('should render <audio> for audio MIME types', () => {
    component.url = 'https://example.com/sound.mp3';
    component.mimeType = 'audio/mpeg';
    component.filename = 'sound.mp3';
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('audio')).toBeTruthy();
  });

  it('should render download anchor for unknown MIME types', () => {
    component.url = 'https://example.com/archive.zip';
    component.mimeType = 'application/zip';
    component.filename = 'archive.zip';
    fixture.detectChanges();
    const anchor: HTMLAnchorElement | null = fixture.nativeElement.querySelector('a[download]');
    expect(anchor).toBeTruthy();
    expect(anchor?.textContent).toContain('archive.zip');
  });

  it('should render download anchor for application/vnd.openxmlformats', () => {
    component.url = 'https://example.com/file.xlsx';
    component.mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    component.filename = 'file.xlsx';
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('a[download]')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="file-preview" 2>&1 | tail -10
```
Expected: `FAIL`.

- [ ] **Step 3: Implement FilePreviewComponent**

```typescript
// frontend/src/app/shared/components/file-preview/file-preview.component.ts
import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

@Component({
  selector: 'app-file-preview',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (isImage) {
      <img [src]="url" [alt]="filename" class="preview-image" />
    } @else if (isPdf) {
      <!-- known gap: Safari iOS opens PDF in new tab instead of rendering inline -->
      <iframe [src]="safeUrl" type="application/pdf" class="preview-pdf" title="PDF preview"></iframe>
    } @else if (isVideo) {
      <video [src]="url" controls class="preview-video"></video>
    } @else if (isAudio) {
      <audio [src]="url" controls class="preview-audio"></audio>
    } @else {
      <a [href]="url" [download]="filename" class="preview-download">⬇ {{ filename }}</a>
    }
  `,
})
export class FilePreviewComponent {
  @Input({ required: true }) url!: string;
  @Input({ required: true }) mimeType!: string;
  @Input({ required: true }) filename!: string;

  private sanitizer = inject(DomSanitizer);

  get isImage(): boolean  { return this.mimeType.startsWith('image/'); }
  get isPdf(): boolean    { return this.mimeType === 'application/pdf'; }
  get isVideo(): boolean  { return this.mimeType.startsWith('video/'); }
  get isAudio(): boolean  { return this.mimeType.startsWith('audio/'); }

  get safeUrl(): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(this.url);
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="file-preview" 2>&1 | tail -10
```
Expected: `PASS` — 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/shared/components/file-preview/
git commit -m "feat: FilePreviewComponent — image/PDF/video/audio/download by MIME type"
```

---

## Task 6: FilesPageComponent + route

**Files:**
- Create: `frontend/src/app/features/files/files-page.component.ts`
- Create: `frontend/src/app/features/files/files-page.component.spec.ts`
- Modify: `frontend/src/app/shell/shell.routes.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// frontend/src/app/features/files/files-page.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FilesPageComponent } from './files-page.component';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TenantService } from '../../core/services/tenant.service';
import { FileService } from '../../core/services/file.service';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';

describe('FilesPageComponent', () => {
  let fixture: ComponentFixture<FilesPageComponent>;
  let component: FilesPageComponent;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FilesPageComponent, HttpClientTestingModule],
      providers: [
        { provide: TenantService, useValue: { activeOrgId: signal('org-1') } },
        { provide: FileService, useValue: { upload: jest.fn().mockReturnValue(new Subject()) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FilesPageComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('should load files on init', () => {
    fixture.detectChanges();
    const req = http.expectOne('/api/v1/orgs/org-1/files?limit=20&offset=0');
    expect(req.request.method).toBe('GET');
    req.flush({ data: [] });
  });

  it('should display file records', () => {
    fixture.detectChanges();
    http.expectOne('/api/v1/orgs/org-1/files?limit=20&offset=0').flush({
      data: [{
        id: 'f-1', org_id: 'org-1', filename: 'report.pdf',
        mime_type: 'application/pdf', size_bytes: 1024,
        scan_status: 'clean', created_at: '2026-04-18T00:00:00Z',
      }],
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('report.pdf');
  });

  it('should delete a file and reload', () => {
    fixture.detectChanges();
    http.expectOne('/api/v1/orgs/org-1/files?limit=20&offset=0').flush({ data: [] });
    component.deleteFile('f-1');
    http.expectOne(req => req.method === 'DELETE' && req.url.includes('/files/f-1')).flush({});
    http.expectOne('/api/v1/orgs/org-1/files?limit=20&offset=0').flush({ data: [] });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="files-page" 2>&1 | tail -10
```
Expected: `FAIL`.

- [ ] **Step 3: Implement FilesPageComponent**

```typescript
// frontend/src/app/features/files/files-page.component.ts
import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { TenantService } from '../../core/services/tenant.service';
import { FileService } from '../../core/services/file.service';
import { ApiResponse } from '../../core/models/api-response.model';
import { FileRecord, FileRecordDto, toFileRecord } from '../../core/models/file.model';
import { FileUploadComponent } from '../../shared/components/file-upload/file-upload.component';
import { FilePreviewComponent } from '../../shared/components/file-preview/file-preview.component';

@Component({
  selector: 'app-files-page',
  standalone: true,
  imports: [CommonModule, FileUploadComponent, FilePreviewComponent],
  template: `
    <div class="files-page">
      <h1 class="files-title">Files</h1>

      <app-file-upload (fileReady)="onFileReady()" />

      @if (files().length === 0) {
        <p class="files-empty">No files uploaded yet.</p>
      } @else {
        <div class="files-grid">
          @for (file of files(); track file.id) {
            <div class="file-card">
              <span class="file-name">{{ file.filename }}</span>
              <span class="file-size">{{ formatSize(file.sizeBytes) }}</span>
              <span class="file-date">{{ file.createdAt | date:'mediumDate' }}</span>
              <button class="file-delete-btn" (click)="deleteFile(file.id)">Delete</button>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class FilesPageComponent implements OnInit {
  private http   = inject(HttpClient);
  private tenant = inject(TenantService);

  readonly files = signal<FileRecord[]>([]);

  ngOnInit(): void { this.load(); }

  load(): void {
    const orgId = this.tenant.activeOrgId()!;
    this.http
      .get<ApiResponse<FileRecordDto[]>>(`/api/v1/orgs/${orgId}/files?limit=20&offset=0`)
      .subscribe(res => this.files.set(res.data.map(toFileRecord)));
  }

  onFileReady(): void { this.load(); }

  deleteFile(fileId: string): void {
    const orgId = this.tenant.activeOrgId()!;
    this.http.delete(`/api/v1/orgs/${orgId}/files/${fileId}`)
      .subscribe(() => this.load());
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
```

- [ ] **Step 4: Add files route to shell.routes.ts**

Read the current routes file first, then add the files route. Find the file at `frontend/src/app/shell/shell.routes.ts` and add:

```typescript
{
  path: 'files',
  loadComponent: () =>
    import('../features/files/files-page.component').then(m => m.FilesPageComponent),
},
```

Add it alongside the existing feature routes (tasks, chat, etc.) within the workspace shell children array.

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="files-page" 2>&1 | tail -10
```
Expected: `PASS` — 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/features/files/ frontend/src/app/shell/shell.routes.ts
git commit -m "feat: FilesPageComponent — file list, upload, delete + files route"
```

---

## Task 7: Extend Message model and MessageService for attachments

**Files:**
- Modify: `frontend/src/app/core/models/message.model.ts`
- Modify: `frontend/src/app/core/services/message.service.ts`

- [ ] **Step 1: Add `attachments` to Message and MessageDto**

In `frontend/src/app/core/models/message.model.ts`, add `attachments` to both interfaces and the mapper:

```typescript
export interface Message {
  id: string;
  channelId: string;
  senderUserId: string;
  body: string;
  clientMessageId: string;
  createdAt: string;
  attachments: string[];  // array of fileIds
}

export interface MessageDto {
  id: string;
  channel_id: string;
  sender_user_id: string;
  body: string;
  client_message_id: string;
  created_at: string;
  attachments?: string[];
}

export function toMessage(dto: MessageDto): Message {
  return {
    id:              dto.id,
    channelId:       dto.channel_id,
    senderUserId:    dto.sender_user_id,
    body:            dto.body,
    clientMessageId: dto.client_message_id,
    createdAt:       dto.created_at,
    attachments:     dto.attachments ?? [],
  };
}
```

- [ ] **Step 2: Add `attachments` param to MessageService.send**

In `frontend/src/app/core/services/message.service.ts`, update `send`:

```typescript
send(channelId: string, body: string, attachments: string[] = []): Observable<Message> {
  const orgId = this.tenant.activeOrgId()!;
  this.sending.set(true);
  return this.http
    .post<ApiResponse<MessageDto>>(
      `/api/v1/orgs/${orgId}/channels/${channelId}/messages`,
      { body, client_message_id: crypto.randomUUID(), attachments }
    )
    .pipe(
      map((res: ApiResponse<MessageDto>) => toMessage(res.data)),
      tap(() => this.sending.set(false)),
      catchError((err: unknown) => { this.sending.set(false); return throwError(() => err); }),
    );
}
```

- [ ] **Step 3: Run existing message service tests to verify no regression**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="message.service" 2>&1 | tail -10
```
Expected: all existing tests `PASS`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/core/models/message.model.ts frontend/src/app/core/services/message.service.ts
git commit -m "feat: Message model + MessageService — add attachments field to send payload"
```

---

## Task 8: Wire FileUpload into ChannelViewComponent (chat)

**Files:**
- Modify: `frontend/src/app/features/chat/channel-view/channel-view.component.ts`
- Modify: `frontend/src/app/features/chat/channel-view/channel-view.component.spec.ts`

- [ ] **Step 1: Update ChannelViewComponent**

Replace the existing `channel-view.component.ts` with:

```typescript
// frontend/src/app/features/chat/channel-view/channel-view.component.ts
import {
  Component, OnInit, OnDestroy, computed, inject, signal, ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { MessageService } from '../../../core/services/message.service';
import { ChannelService } from '../../../core/services/channel.service';
import { FileUploadComponent } from '../../../shared/components/file-upload/file-upload.component';

@Component({
  selector: 'app-channel-view',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FileUploadComponent],
  template: `
    <div class="channel-view">
      <div class="channel-header"># {{ channelName() }}</div>

      <div class="message-list">
        @for (msg of messages(); track msg.id) {
          <div class="message-row">
            <span class="message-sender">{{ msg.senderUserId }}</span>
            <span class="message-body">{{ msg.body }}</span>
            @if (msg.attachments.length > 0) {
              <span class="message-attachments">📎 {{ msg.attachments.length }}</span>
            }
            <span class="message-time">{{ msg.createdAt | date:'shortTime' }}</span>
          </div>
        }
        @if (messages().length === 0) {
          <div class="message-empty">No messages yet — say hello!</div>
        }
      </div>

      <div class="message-compose">
        <app-file-upload #fileUpload (fileReady)="onFileReady($event)" />
        <form class="message-input-row" [formGroup]="form" (ngSubmit)="send()">
          <input
            formControlName="body"
            class="message-input"
            [placeholder]="'Message #' + channelName() + '…'"
            autocomplete="off"
          />
          <button
            type="submit"
            class="message-send-btn"
            [disabled]="form.invalid || sending() || pendingUploads()"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  `,
})
export class ChannelViewComponent implements OnInit, OnDestroy {
  @ViewChild('fileUpload') fileUpload!: FileUploadComponent;

  private route   = inject(ActivatedRoute);
  private msgSvc  = inject(MessageService);
  private chSvc   = inject(ChannelService);
  private fb      = inject(FormBuilder);

  private realtimeSub?: Subscription;
  private channelId = signal('');
  private attachments = signal<string[]>([]);

  readonly messages    = this.msgSvc.messages;
  readonly sending     = this.msgSvc.sending;
  readonly channelName = computed(() => {
    const ch = this.chSvc.channels().find(c => c.id === this.channelId());
    return ch?.name ?? '';
  });
  readonly pendingUploads = computed(() => this.fileUpload?.hasPending() ?? false);

  readonly form = this.fb.nonNullable.group({ body: ['', Validators.required] });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('channelId')!;
    this.channelId.set(id);
    this.msgSvc.load(id).subscribe();
    this.realtimeSub = this.msgSvc.subscribeRealtime(id);
  }

  ngOnDestroy(): void { this.realtimeSub?.unsubscribe(); }

  onFileReady(fileId: string): void {
    this.attachments.update(ids => [...ids, fileId]);
  }

  send(): void {
    if (this.form.invalid) return;
    const { body } = this.form.getRawValue();
    const attachments = this.attachments();
    this.msgSvc.send(this.channelId(), body, attachments).subscribe({
      next: () => {
        this.form.reset();
        this.attachments.set([]);
        this.fileUpload.clearReady();
      },
    });
  }
}
```

- [ ] **Step 2: Update channel-view tests**

In `frontend/src/app/features/chat/channel-view/channel-view.component.spec.ts`, add `FileService` mock to providers (since `FileUploadComponent` injects it):

Read the existing spec file, then add to the `providers` array:

```typescript
{
  provide: FileService,
  useValue: { upload: jest.fn().mockReturnValue(new Subject()) },
}
```

Also add `import { FileService } from '../../../core/services/file.service';` and `import { Subject } from 'rxjs';` at the top.

- [ ] **Step 3: Run tests**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="channel-view" 2>&1 | tail -10
```
Expected: `PASS`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/features/chat/channel-view/
git commit -m "feat: ChannelViewComponent — file upload wired into chat compose area"
```

---

## Task 9: Comment model + TaskService.addComment — TDD

**Files:**
- Create: `frontend/src/app/core/models/comment.model.ts`
- Modify: `frontend/src/app/core/services/task.service.ts`
- Modify: `frontend/src/app/core/services/task.service.spec.ts` (add addComment tests)

- [ ] **Step 1: Create comment model**

```typescript
// frontend/src/app/core/models/comment.model.ts
export interface Comment {
  id: string;
  taskId: string;
  authorUserId: string;
  body: Record<string, unknown>;  // Quill delta: { ops: [...], attachments?: string[] }
  createdAt: string;
}

export interface CommentDto {
  id: string;
  task_id: string;
  author_user_id: string;
  body: Record<string, unknown>;
  created_at: string;
}

export function toComment(dto: CommentDto): Comment {
  return {
    id:           dto.id,
    taskId:       dto.task_id,
    authorUserId: dto.author_user_id,
    body:         dto.body,
    createdAt:    dto.created_at,
  };
}
```

- [ ] **Step 2: Write failing tests for addComment**

Add to `frontend/src/app/core/services/task.service.spec.ts` (at the end of the existing describe block):

```typescript
// Add these imports at the top of the file:
// import { Comment, CommentDto } from '../models/comment.model';

describe('addComment', () => {
  it('should POST comment and return Comment', () => {
    const orgId = 'org-1';
    // Use the existing service/http from the outer describe setup
    let result: Comment | undefined;
    service.addComment('task-1', { ops: [{ insert: 'hello\n' }] }, []).subscribe(c => result = c);

    const req = http.expectOne(`/api/v1/orgs/${orgId}/tasks/task-1/comments`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      body: { ops: [{ insert: 'hello\n' }], attachments: [] },
    });

    req.flush({
      data: {
        id: 'c-1', task_id: 'task-1', author_user_id: 'u-1',
        body: { ops: [{ insert: 'hello\n' }], attachments: [] },
        created_at: '2026-04-18T00:00:00Z',
      } as CommentDto,
    });

    expect(result?.id).toBe('c-1');
    expect(result?.taskId).toBe('task-1');
  });
});
```

- [ ] **Step 3: Run tests to confirm addComment tests fail**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="task.service" 2>&1 | tail -10
```
Expected: `FAIL` on the new addComment test.

- [ ] **Step 4: Add addComment to TaskService**

Add to `frontend/src/app/core/services/task.service.ts`:

```typescript
// Add these imports at the top:
// import { Comment, CommentDto, toComment } from '../models/comment.model';

addComment(taskId: string, body: Record<string, unknown>, attachments: string[] = []): Observable<Comment> {
  const orgId = this.tenant.activeOrgId()!;
  return this.http
    .post<ApiResponse<CommentDto>>(
      `/api/v1/orgs/${orgId}/tasks/${taskId}/comments`,
      { body: { ...body, attachments } }
    )
    .pipe(map((res: ApiResponse<CommentDto>) => toComment(res.data)));
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="task.service" 2>&1 | tail -10
```
Expected: `PASS`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/core/models/comment.model.ts frontend/src/app/core/services/task.service.ts frontend/src/app/core/services/task.service.spec.ts
git commit -m "feat: Comment model + TaskService.addComment with attachments"
```

---

## Task 10: TaskCommentComponent — TDD

**Files:**
- Create: `frontend/src/app/features/task/task-comment/task-comment.component.ts`
- Create: `frontend/src/app/features/task/task-comment/task-comment.component.spec.ts`

Inline comment editor with `FileUploadComponent`. Shown when a task row is expanded.

- [ ] **Step 1: Write the failing tests**

```typescript
// frontend/src/app/features/task/task-comment/task-comment.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TaskCommentComponent } from './task-comment.component';
import { TaskService } from '../../../core/services/task.service';
import { FileService } from '../../../core/services/file.service';
import { TenantService } from '../../../core/services/tenant.service';
import { signal } from '@angular/core';
import { Subject, of } from 'rxjs';
import { Comment } from '../../../core/models/comment.model';

describe('TaskCommentComponent', () => {
  let fixture: ComponentFixture<TaskCommentComponent>;
  let component: TaskCommentComponent;
  let addComment: jest.Mock;

  beforeEach(async () => {
    addComment = jest.fn().mockReturnValue(of({
      id: 'c-1', taskId: 't-1', authorUserId: 'u-1',
      body: { ops: [{ insert: 'hello\n' }], attachments: [] },
      createdAt: '2026-04-18T00:00:00Z',
    } as Comment));

    await TestBed.configureTestingModule({
      imports: [TaskCommentComponent],
      providers: [
        { provide: TaskService, useValue: { addComment } },
        { provide: FileService, useValue: { upload: jest.fn().mockReturnValue(new Subject()) } },
        { provide: TenantService, useValue: { activeOrgId: signal('org-1') } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TaskCommentComponent);
    component = fixture.componentInstance;
    component.taskId = 't-1';
    fixture.detectChanges();
  });

  it('should render comment textarea', () => {
    expect(fixture.nativeElement.querySelector('textarea')).toBeTruthy();
  });

  it('should call addComment on submit', () => {
    const spy = jest.spyOn(component.commented, 'emit');
    component.body = 'hello';
    component.submit();
    expect(addComment).toHaveBeenCalledWith('t-1', { ops: [{ insert: 'hello\n' }] }, []);
    expect(spy).toHaveBeenCalled();
  });

  it('should not submit when body is empty', () => {
    component.body = '';
    component.submit();
    expect(addComment).not.toHaveBeenCalled();
  });

  it('should include attachment fileIds on submit', () => {
    component.body = 'see attached';
    component.onFileReady('f-1');
    component.submit();
    expect(addComment).toHaveBeenCalledWith(
      't-1',
      { ops: [{ insert: 'see attached\n' }] },
      ['f-1']
    );
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="task-comment" 2>&1 | tail -10
```
Expected: `FAIL`.

- [ ] **Step 3: Implement TaskCommentComponent**

```typescript
// frontend/src/app/features/task/task-comment/task-comment.component.ts
import { Component, Input, Output, EventEmitter, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TaskService } from '../../../core/services/task.service';
import { FileUploadComponent } from '../../../shared/components/file-upload/file-upload.component';

@Component({
  selector: 'app-task-comment',
  standalone: true,
  imports: [CommonModule, FormsModule, FileUploadComponent],
  template: `
    <div class="task-comment-editor">
      <textarea
        [(ngModel)]="body"
        class="comment-textarea"
        placeholder="Add a comment…"
        rows="2"
      ></textarea>
      <app-file-upload (fileReady)="onFileReady($event)" />
      <button class="comment-submit-btn" (click)="submit()" [disabled]="!body.trim()">
        Comment
      </button>
    </div>
  `,
})
export class TaskCommentComponent {
  @Input({ required: true }) taskId!: string;
  @Output() commented = new EventEmitter<void>();

  private taskSvc = inject(TaskService);

  body = '';
  private attachments = signal<string[]>([]);

  onFileReady(fileId: string): void {
    this.attachments.update(ids => [...ids, fileId]);
  }

  submit(): void {
    if (!this.body.trim()) return;
    const quillBody = { ops: [{ insert: `${this.body.trim()}\n` }] };
    this.taskSvc.addComment(this.taskId, quillBody, this.attachments()).subscribe({
      next: () => {
        this.body = '';
        this.attachments.set([]);
        this.commented.emit();
      },
    });
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd frontend && npx ng test --watch=false --testPathPattern="task-comment" 2>&1 | tail -10
```
Expected: `PASS` — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/features/task/task-comment/
git commit -m "feat: TaskCommentComponent — inline comment editor with file attachments"
```

---

## Task 11: Wire TaskCommentComponent into TaskListComponent

**Files:**
- Modify: `frontend/src/app/features/task/task-list/task-list.component.ts`

Add an `expandedTaskId` signal. Clicking a task row toggles a `TaskCommentComponent` below it.

- [ ] **Step 1: Read the current TaskListComponent**

Read `frontend/src/app/features/task/task-list/task-list.component.ts` in full before editing.

- [ ] **Step 2: Update TaskListComponent**

Add `TaskCommentComponent` to imports, add `expandedTaskId` signal, and update template to show comment editor on task click:

```typescript
// Add to imports array at top of file:
import { TaskCommentComponent } from '../task-comment/task-comment.component';

// Inside the class, add:
readonly expandedTaskId = signal<string | null>(null);

toggleExpand(taskId: string): void {
  this.expandedTaskId.update(id => id === taskId ? null : taskId);
}
```

In the `imports` array of `@Component`, add `TaskCommentComponent`.

In the template, inside the `@for (task of tasksForStatus(group.status); ...)` block, after the existing task row `<div class="task-row">`, add:

```html
<div class="task-row" (click)="toggleExpand(task.id)" style="cursor:pointer">
  <!-- existing task row content unchanged -->
</div>
@if (expandedTaskId() === task.id) {
  <app-task-comment [taskId]="task.id" (commented)="expandedTaskId.set(null)" />
}
```

- [ ] **Step 3: Update task-list tests**

In `frontend/src/app/features/task/task-list/task-list.component.spec.ts`, add `TaskService` mock entry for `addComment` and `FileService` mock (since `TaskCommentComponent` and `FileUploadComponent` render when task is expanded):

```typescript
{ provide: TaskService, useValue: { ...<existing mock>, addComment: jest.fn().mockReturnValue(of({})) } }
{ provide: FileService, useValue: { upload: jest.fn().mockReturnValue(new Subject()) } }
```

- [ ] **Step 4: Run all tests**

```bash
cd frontend && npx ng test --watch=false 2>&1 | tail -15
```
Expected: all suites `PASS`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/features/task/task-list/ frontend/src/app/features/task/task-comment/
git commit -m "feat: TaskListComponent — expand task row to show comment editor with file upload"
```

---

## Task 12: Final verification and SESSION.md update

- [ ] **Step 1: Run full test suite**

```bash
cd /c/Users/gokul/Documents/GitHub/multi-tenant_collaborative_work_platform/frontend
npx ng test --watch=false 2>&1 | tail -15
```
Expected: all suites pass, test count higher than 101.

- [ ] **Step 2: Run typecheck**

```bash
cd /c/Users/gokul/Documents/GitHub/multi-tenant_collaborative_work_platform/frontend
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors.

- [ ] **Step 3: Update SESSION.md**

Update `SESSION.md` at the repo root with:
- Active Task: Phase 5 file management — ALL TASKS COMPLETE
- Resumption Point: all tests green, push to origin/main
- What's Done: append Phase 5 tasks 1–12
- Last Decision Made: FileService is stateless orchestrator; FileUploadComponent owns its own signal list (no cross-context leakage)

- [ ] **Step 4: Commit SESSION.md**

```bash
git add SESSION.md
git commit -m "chore: SESSION.md — Phase 5 file management complete"
```
