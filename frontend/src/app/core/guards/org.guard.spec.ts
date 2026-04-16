// frontend/src/app/core/guards/org.guard.spec.ts
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { orgGuard } from './org.guard';
import { TenantService } from '../services/tenant.service';
import { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';

const ROUTE  = {} as ActivatedRouteSnapshot;
const STATE  = {} as RouterStateSnapshot;
const ORG_A  = { id: 'org-a', name: 'A', slug: 'a', status: 'active' as const, plan: 'free' };
const ORG_B  = { id: 'org-b', name: 'B', slug: 'b', status: 'active' as const, plan: 'pro'  };

describe('orgGuard', () => {
  // Use a plain object with jest.fn() properties; cast via unknown to avoid
  // Signal vs Mock type incompatibility (activeOrgId is Signal in TenantService).
  let tenant: {
    activeOrgId:  jest.Mock;
    setOrg:       jest.Mock;
    loadUserOrgs: jest.Mock;
  };
  let router: Router;

  const runGuard = () =>
    TestBed.runInInjectionContext(() => orgGuard(ROUTE, STATE));

  beforeEach(() => {
    tenant = {
      activeOrgId:  jest.fn().mockReturnValue(null),
      setOrg:       jest.fn(),
      loadUserOrgs: jest.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: TenantService, useValue: tenant as unknown as TenantService },
        provideRouter([]),
      ],
    });
    router = TestBed.inject(Router);
  });

  it('returns true immediately when activeOrgId is set', async () => {
    tenant.activeOrgId.mockReturnValue('org-a');
    expect(await runGuard()).toBe(true);
    expect(tenant.loadUserOrgs).not.toHaveBeenCalled();
  });

  it('auto-selects the org and returns true when user has exactly one org', async () => {
    tenant.loadUserOrgs.mockReturnValue(of([ORG_A]));
    expect(await runGuard()).toBe(true);
    expect(tenant.setOrg).toHaveBeenCalledWith(ORG_A);
  });

  it('redirects to /pick-org when user has multiple orgs', async () => {
    const navSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    tenant.loadUserOrgs.mockReturnValue(of([ORG_A, ORG_B]));
    const result = await runGuard();
    expect(result).toBe(false);
    expect(navSpy).toHaveBeenCalledWith(['/pick-org']);
  });

  it('redirects to /auth/login when user has zero orgs', async () => {
    const navSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    tenant.loadUserOrgs.mockReturnValue(of([]));
    const result = await runGuard();
    expect(result).toBe(false);
    expect(navSpy).toHaveBeenCalledWith(['/auth/login']);
  });

  it('redirects to /auth/login when loadUserOrgs throws', async () => {
    const navSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    tenant.loadUserOrgs.mockReturnValue(throwError(() => new Error('Network')));
    const result = await runGuard();
    expect(result).toBe(false);
    expect(navSpy).toHaveBeenCalledWith(['/auth/login']);
  });
});
