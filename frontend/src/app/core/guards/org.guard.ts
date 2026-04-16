// frontend/src/app/core/guards/org.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { TenantService } from '../services/tenant.service';
import { firstValueFrom } from 'rxjs';

export const orgGuard: CanActivateFn = async () => {
  const tenant = inject(TenantService);
  const router = inject(Router);

  if (tenant.activeOrgId()) return true;

  // Try to auto-select if user belongs to exactly one org
  try {
    const orgs = await firstValueFrom(tenant.loadUserOrgs());
    if (orgs.length === 1) {
      tenant.setOrg(orgs[0]);
      return true;
    }
    // Multiple orgs — Phase 2 shell will handle org-picker
    router.navigate(['/auth/login']);
    return false;
  } catch {
    router.navigate(['/auth/login']);
    return false;
  }
};
