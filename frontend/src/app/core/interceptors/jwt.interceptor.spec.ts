// frontend/src/app/core/interceptors/jwt.interceptor.spec.ts
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { jwtInterceptor } from './jwt.interceptor';
import { TokenStorageService } from '../services/token-storage.service';
import { TenantService } from '../services/tenant.service';
import { AuthService } from '../services/auth.service';
import { Router } from '@angular/router';

describe('jwtInterceptor', () => {
  let http: HttpClient;
  let ctrl: HttpTestingController;
  let storage: TokenStorageService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([jwtInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthService, useValue: { refreshToken: jest.fn(), logout: jest.fn() } },
      ],
    });
    http    = TestBed.inject(HttpClient);
    ctrl    = TestBed.inject(HttpTestingController);
    storage = TestBed.inject(TokenStorageService);
    localStorage.clear();
  });

  afterEach(() => ctrl.verify());

  it('attaches Authorization header when token exists', () => {
    storage.setAccessToken('my-token');
    http.get('/api/v1/tasks').subscribe();
    const req = ctrl.expectOne('/api/v1/tasks');
    expect(req.request.headers.get('Authorization')).toBe('Bearer my-token');
    req.flush({});
  });

  it('does NOT attach Authorization header on auth endpoints', () => {
    storage.setAccessToken('my-token');
    http.post('/api/v1/auth/login', {}).subscribe();
    const req = ctrl.expectOne('/api/v1/auth/login');
    expect(req.request.headers.get('Authorization')).toBeNull();
    req.flush({});
  });

  it('attaches X-Org-ID when activeOrgId is set', () => {
    const tenant = TestBed.inject(TenantService);
    tenant.setOrg({ id: 'org-99', name: 'X', slug: 'x', status: 'active', plan: 'pro' });
    storage.setAccessToken('tok');
    http.get('/api/v1/tasks').subscribe();
    const req = ctrl.expectOne('/api/v1/tasks');
    expect(req.request.headers.get('X-Org-ID')).toBe('org-99');
    req.flush({});
  });
});
