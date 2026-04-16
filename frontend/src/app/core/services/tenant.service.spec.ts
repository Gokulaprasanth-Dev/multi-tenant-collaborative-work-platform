// frontend/src/app/core/services/tenant.service.spec.ts
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TenantService } from './tenant.service';
import { OrgDto } from '../models/org.model';

const ORG_DTO: OrgDto = {
  id: 'org-1', name: 'Acme', slug: 'acme',
  status: 'active', plan_tier: 'free',
};

describe('TenantService', () => {
  let service: TenantService;
  let ctrl: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(TenantService);
    ctrl    = TestBed.inject(HttpTestingController);
  });

  afterEach(() => ctrl.verify());

  it('activeOrgId is null initially', () => {
    expect(service.activeOrgId()).toBeNull();
  });

  it('setOrg updates activeOrg and activeOrgId', () => {
    service.setOrg({ id: 'org-1', name: 'Acme', slug: 'acme', status: 'active', plan: 'free' });
    expect(service.activeOrgId()).toBe('org-1');
    expect(service.activeOrg()?.name).toBe('Acme');
  });

  it('loadUserOrgs fetches from /api/v1/orgs/mine and sets userOrgs signal', fakeAsync(() => {
    service.loadUserOrgs().subscribe();
    ctrl.expectOne('/api/v1/orgs/mine')
      .flush({ data: [ORG_DTO], error: null, meta: {} });
    tick();
    expect(service.userOrgs().length).toBe(1);
    expect(service.userOrgs()[0].id).toBe('org-1');
    expect(service.userOrgs()[0].plan).toBe('free');
  }));

  it('toOrg maps deleted status to cancelled', fakeAsync(() => {
    service.loadUserOrgs().subscribe();
    ctrl.expectOne('/api/v1/orgs/mine')
      .flush({ data: [{ ...ORG_DTO, status: 'deleted' }], error: null, meta: {} });
    tick();
    expect(service.userOrgs()[0].status).toBe('cancelled');
  }));
});
