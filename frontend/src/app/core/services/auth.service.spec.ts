// frontend/src/app/core/services/auth.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { TokenStorageService } from './token-storage.service';

const mockUser = {
  id: 'u-1', email: 'a@b.com', name: 'Alice',
  emailVerified: true, mfaEnabled: false,
  role: 'member' as const, createdAt: '2026-01-01',
};

describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;
  let storage: TokenStorageService;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        { provide: Router, useValue: { navigate: jest.fn() } },
      ],
    });
    service = TestBed.inject(AuthService);
    http    = TestBed.inject(HttpTestingController);
    storage = TestBed.inject(TokenStorageService);
    router  = TestBed.inject(Router);
    localStorage.clear();
  });

  afterEach(() => http.verify());

  it('currentUser starts null, isLoggedIn starts false', () => {
    expect(service.currentUser()).toBeNull();
    expect(service.isLoggedIn()).toBe(false);
  });

  it('login() sets currentUser signal on success', () => {
    service.login('a@b.com', 'pass').subscribe();
    const req = http.expectOne('/api/v1/auth/login');
    req.flush({ data: { user: mockUser, accessToken: 'tok', refreshToken: 'ref' }, error: null, meta: {} });
    expect(service.currentUser()).toEqual(mockUser);
    expect(service.isLoggedIn()).toBe(true);
  });

  it('login() returns { mfaRequired: true } when backend signals MFA', () => {
    let result: any;
    service.login('a@b.com', 'pass').subscribe(r => result = r);
    const req = http.expectOne('/api/v1/auth/login');
    req.flush({ data: { mfa_required: true }, error: null, meta: {} });
    expect(result).toEqual({ mfaRequired: true });
    expect(service.currentUser()).toBeNull();
  });

  it('logout() clears currentUser and navigates to /auth/login', () => {
    service['currentUserSignal'].set(mockUser);
    storage.setAccessToken('tok');
    service.logout();
    expect(service.currentUser()).toBeNull();
    expect(storage.getAccessToken()).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(['/auth/login']);
  });
});
