// frontend/src/app/core/guards/org.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { TenantService } from '../services/tenant.service';
import { firstValueFrom } from 'rxjs';

export const orgGuard: CanActivateFn = async () => {
  const tenant = inject(TenantService);
  const router = inject(Router);

  // Already have an active org (e.g. after login or org-picker selection)
  if (tenant.activeOrgId()) return true;

  try {
    const orgs = await firstValueFrom(tenant.loadUserOrgs());

    if (orgs.length === 0) {
      // No org membership — send back to login
      router.navigate(['/auth/login']);
      return false;
    }

    if (orgs.length === 1) {
      // Single org — auto-select and proceed
      tenant.setOrg(orgs[0]!);
      return true;
    }

    // Multiple orgs — let the user pick
    router.navigate(['/pick-org']);
    return false;
  } catch {
    router.navigate(['/auth/login']);
    return false;
  }
};
