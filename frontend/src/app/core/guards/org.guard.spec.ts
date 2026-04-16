// frontend/src/app/core/guards/org.guard.spec.ts
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { orgGuard } from './org.guard';
import { TenantService } from '../services/tenant.service';
import { signal, computed } from '@angular/core';

function makeTenantService(orgId: string | null, orgs: any[] = []) {
  const activeOrg = signal<any>(orgId ? { id: orgId } : null);
  return {
    activeOrg: activeOrg.asReadonly(),
    activeOrgId: computed(() => activeOrg()?.id ?? null),
    setOrg: jest.fn((org: any) => activeOrg.set(org)),
    loadUserOrgs: jest.fn(() => of(orgs)),
  };
}

describe('orgGuard', () => {
  let router: { navigate: jest.Mock };

  beforeEach(() => {
    router = { navigate: jest.fn() };
    TestBed.configureTestingModule({
      providers: [{ provide: Router, useValue: router }],
    });
  });

  it('returns true immediately when activeOrgId is set', async () => {
    TestBed.overrideProvider(TenantService, { useValue: makeTenantService('org-1') });
    const result = await TestBed.runInInjectionContext(() => orgGuard({} as any, {} as any));
    expect(result).toBe(true);
  });

  it('auto-selects single org and returns true', async () => {
    const tenant = makeTenantService(null, [{ id: 'org-2', name: 'X', slug: 'x', status: 'active', plan: 'pro' }]);
    TestBed.overrideProvider(TenantService, { useValue: tenant });
    const result = await TestBed.runInInjectionContext(() => orgGuard({} as any, {} as any));
    expect(tenant.setOrg).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('redirects to /auth/login when multiple orgs and none selected', async () => {
    const tenant = makeTenantService(null, [
      { id: 'org-1' }, { id: 'org-2' },
    ]);
    TestBed.overrideProvider(TenantService, { useValue: tenant });
    const result = await TestBed.runInInjectionContext(() => orgGuard({} as any, {} as any));
    expect(result).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith(['/auth/login']);
  });

  it('redirects to /auth/login on error', async () => {
    const tenant = { ...makeTenantService(null), loadUserOrgs: jest.fn(() => throwError(() => new Error('net'))) };
    TestBed.overrideProvider(TenantService, { useValue: tenant });
    const result = await TestBed.runInInjectionContext(() => orgGuard({} as any, {} as any));
    expect(result).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith(['/auth/login']);
  });
});
