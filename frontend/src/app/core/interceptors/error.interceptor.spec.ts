// frontend/src/app/core/interceptors/error.interceptor.spec.ts
import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { errorInterceptor } from './error.interceptor';
import { AppError } from '../models/api-response.model';

describe('errorInterceptor', () => {
  let http: HttpClient;
  let ctrl: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    ctrl = TestBed.inject(HttpTestingController);
  });

  afterEach(() => ctrl.verify());

  it('maps HTTP error to AppError with code and status', () => {
    let caught: AppError | undefined;
    http.get('/api/v1/tasks').subscribe({ error: e => (caught = e) });
    ctrl.expectOne('/api/v1/tasks').flush(
      { error: { code: 'NOT_FOUND', message: 'Resource not found' } },
      { status: 404, statusText: 'Not Found' },
    );
    expect(caught).toBeInstanceOf(AppError);
    expect(caught!.code).toBe('NOT_FOUND');
    expect(caught!.status).toBe(404);
    expect(caught!.message).toBe('Resource not found');
  });

  it('falls back to UNKNOWN_ERROR when no structured error body', () => {
    let caught: AppError | undefined;
    http.get('/api/v1/tasks').subscribe({ error: e => (caught = e) });
    ctrl.expectOne('/api/v1/tasks').flush('Server error', {
      status: 500, statusText: 'Internal Server Error',
    });
    expect(caught).toBeInstanceOf(AppError);
    expect(caught!.code).toBe('UNKNOWN_ERROR');
    expect(caught!.status).toBe(500);
  });
});
