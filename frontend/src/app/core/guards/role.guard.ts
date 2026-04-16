// frontend/src/app/core/guards/role.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

// Stub — full implementation in Phase 8
export function roleGuard(requiredRole: string): CanActivateFn {
  return () => {
    const auth   = inject(AuthService);
    const router = inject(Router);
    const user   = auth.currentUser();

    if (user?.role === requiredRole) return true;

    router.navigate(['/auth/login']);
    return false;
  };
}
