// frontend/src/app/core/services/file.service.spec.ts
import { TestBed, fakeAsync, tick, discardPeriodicTasks } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { FileService } from './file.service';
import { TenantService } from './tenant.service';
import { signal } from '@angular/core';

describe('FileService', () => {
  let service: FileService;
  let http: HttpTestingController;
  let mockXhr: {
    upload: { addEventListener: jest.Mock };
    addEventListener: jest.Mock;
    open: jest.Mock;
    send: jest.Mock;
    status: number;
  };

  beforeEach(() => {
    mockXhr = {
      upload: { addEventListener: jest.fn() },
      addEventListener: jest.fn(),
      open: jest.fn(),
      send: jest.fn(),
      status: 200,
    };
    jest.spyOn(globalThis as any, 'XMLHttpRequest').mockImplementation(() => mockXhr);

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        FileService,
        { provide: TenantService, useValue: { activeOrgId: signal('org-1') } },
      ],
    });
    service = TestBed.inject(FileService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    jest.restoreAllMocks();
  });

  it('should emit uploading state after requesting upload URL', fakeAsync(() => {
    const file = new File(['hello'], 'test.txt', { type: 'text/plain' });
    const states: string[] = [];

    service.upload(file).subscribe(u => { if (u.state) states.push(u.state); });

    http.expectOne('/api/v1/orgs/org-1/files/upload-url').flush({
      data: { fileId: 'f-1', uploadUrl: 'https://s3.example.com', uploadFields: {}, expiresAt: '' },
    });

    expect(states).toContain('uploading');
  }));

  it('should emit scanning state after S3 upload completes', fakeAsync(() => {
    const file = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
    const states: string[] = [];
    service.upload(file).subscribe(u => { if (u.state) states.push(u.state); });

    http.expectOne('/api/v1/orgs/org-1/files/upload-url').flush({
      data: { fileId: 'f-1', uploadUrl: 'https://s3.example.com', uploadFields: {}, expiresAt: '' },
    });

    // Simulate XHR load (S3 upload complete)
    const loadHandler = mockXhr.addEventListener.mock.calls.find((c: any[]) => c[0] === 'load')?.[1];
    loadHandler?.();

    expect(states).toContain('scanning');
    tick(3500);
    http.expectOne('/api/v1/orgs/org-1/files/f-1/download-url').flush(
      { data: { url: 'https://s3.example.com/f-1' } },
      { status: 200, statusText: 'OK' }
    );
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

    const loadHandler = mockXhr.addEventListener.mock.calls.find((c: any[]) => c[0] === 'load')?.[1];
    loadHandler?.();

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

    const loadHandler = mockXhr.addEventListener.mock.calls.find((c: any[]) => c[0] === 'load')?.[1];
    loadHandler?.();

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
