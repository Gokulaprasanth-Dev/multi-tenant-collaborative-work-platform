// frontend/src/app/core/services/tenant.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TenantService } from './tenant.service';
import { Org } from '../models/org.model';

const mockOrg: Org = {
  id: 'org-1',
  name: 'Acme',
  slug: 'acme',
  status: 'active',
  plan: 'pro',
};

describe('TenantService', () => {
  let service: TenantService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    service = TestBed.inject(TenantService);
    http    = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('activeOrg starts null', () => {
    expect(service.activeOrg()).toBeNull();
  });

  it('setOrg updates activeOrg and activeOrgId signals', () => {
    service.setOrg(mockOrg);
    expect(service.activeOrg()).toEqual(mockOrg);
    expect(service.activeOrgId()).toBe('org-1');
  });

  it('loadUserOrgs GETs /api/v1/organizations', () => {
    service.loadUserOrgs().subscribe(orgs => expect(orgs.length).toBe(1));
    const req = http.expectOne('/api/v1/organizations');
    expect(req.request.method).toBe('GET');
    req.flush({ data: [mockOrg], error: null, meta: {} });
  });
});
