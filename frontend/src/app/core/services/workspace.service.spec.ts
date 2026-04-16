// frontend/src/app/core/services/workspace.service.spec.ts
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClient, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { WorkspaceService } from './workspace.service';
import { TenantService } from './tenant.service';
import { WorkspaceDto } from '../models/workspace.model';

const WS_DTO: WorkspaceDto = {
  id: 'ws-1', org_id: 'org-1', name: 'Dev', description: null,
  status: 'active', owner_user_id: 'u-1', version: 1,
  created_at: '2024-01-01T00:00:00.000Z', updated_at: '2024-01-01T00:00:00.000Z',
};

describe('WorkspaceService', () => {
  let service: WorkspaceService;
  let ctrl: HttpTestingController;
  let tenant: TenantService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(WorkspaceService);
    ctrl    = TestBed.inject(HttpTestingController);
    tenant  = TestBed.inject(TenantService);
  });

  afterEach(() => ctrl.verify());

  it('load() does nothing when no org is active', fakeAsync(() => {
    let called = false;
    service.load().subscribe(() => (called = true));
    tick();
    ctrl.expectNone('/api/v1/orgs/org-1/workspaces');
    expect(called).toBe(false);
    expect(service.workspaces()).toEqual([]);
  }));

  it('load() fetches workspaces and updates signal', fakeAsync(() => {
    tenant.setOrg({ id: 'org-1', name: 'Acme', slug: 'acme', status: 'active', plan: 'free' });
    service.load().subscribe();
    ctrl.expectOne('/api/v1/orgs/org-1/workspaces')
      .flush({ data: [WS_DTO], error: null, meta: {} });
    tick();
    expect(service.workspaces().length).toBe(1);
    expect(service.workspaces()[0].name).toBe('Dev');
    expect(service.workspaces()[0].orgId).toBe('org-1');
  }));

  it('create() POSTs and appends new workspace to signal', fakeAsync(() => {
    tenant.setOrg({ id: 'org-1', name: 'Acme', slug: 'acme', status: 'active', plan: 'free' });
    service.create('New WS').subscribe();
    const req = ctrl.expectOne('/api/v1/orgs/org-1/workspaces');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'New WS', description: undefined });
    req.flush({ data: { ...WS_DTO, id: 'ws-2', name: 'New WS' }, error: null, meta: {} });
    tick();
    expect(service.workspaces().length).toBe(1);
    expect(service.workspaces()[0].name).toBe('New WS');
  }));
});
