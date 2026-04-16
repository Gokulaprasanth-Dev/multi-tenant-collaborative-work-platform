// frontend/src/app/core/interceptors/idempotency.interceptor.spec.ts
import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { idempotencyInterceptor } from './idempotency.interceptor';

describe('idempotencyInterceptor', () => {
  let http: HttpClient;
  let ctrl: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([idempotencyInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    ctrl = TestBed.inject(HttpTestingController);
  });

  afterEach(() => ctrl.verify());

  it('adds Idempotency-Key header on POST', () => {
    http.post('/api/v1/tasks', {}).subscribe();
    const req = ctrl.expectOne('/api/v1/tasks');
    expect(req.request.headers.get('Idempotency-Key')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    req.flush({});
  });

  it('does NOT add Idempotency-Key on GET', () => {
    http.get('/api/v1/tasks').subscribe();
    const req = ctrl.expectOne('/api/v1/tasks');
    expect(req.request.headers.get('Idempotency-Key')).toBeNull();
    req.flush({});
  });
});
