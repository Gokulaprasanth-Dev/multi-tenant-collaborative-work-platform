// frontend/src/app/core/guards/auth.guard.spec.ts
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { authGuard } from './auth.guard';
import { AuthService } from '../services/auth.service';
import { signal, computed } from '@angular/core';

function makeAuthService(loggedIn: boolean) {
  const currentUser = signal(loggedIn ? { id: 'u1' } as any : null);
  return {
    currentUser: currentUser.asReadonly(),
    isLoggedIn: computed(() => !!currentUser()),
  };
}

describe('authGuard', () => {
  let router: { navigate: jest.Mock };

  beforeEach(() => {
    router = { navigate: jest.fn() };
    TestBed.configureTestingModule({
      providers: [{ provide: Router, useValue: router }],
    });
  });

  it('returns true when logged in', () => {
    TestBed.overrideProvider(AuthService, { useValue: makeAuthService(true) });
    const result = TestBed.runInInjectionContext(() =>
      authGuard({} as any, {} as any)
    );
    expect(result).toBe(true);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('navigates to /auth/login and returns false when not logged in', () => {
    TestBed.overrideProvider(AuthService, { useValue: makeAuthService(false) });
    const result = TestBed.runInInjectionContext(() =>
      authGuard({} as any, {} as any)
    );
    expect(result).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith(['/auth/login']);
  });
});
