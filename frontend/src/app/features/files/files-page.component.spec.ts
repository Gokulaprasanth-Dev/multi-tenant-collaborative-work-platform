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
