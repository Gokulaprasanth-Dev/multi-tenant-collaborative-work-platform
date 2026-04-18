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
