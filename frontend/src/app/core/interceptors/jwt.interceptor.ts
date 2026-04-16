// frontend/src/app/core/interceptors/jwt.interceptor.ts
import { HttpInterceptorFn, HttpRequest, HttpHandlerFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { throwError, catchError, switchMap } from 'rxjs';
import { TokenStorageService } from '../services/token-storage.service';
import { TenantService }       from '../services/tenant.service';
import { AuthService }         from '../services/auth.service';

const AUTH_URLS = [
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/refresh',
  '/api/v1/auth/verify-email',
  '/api/v1/auth/forgot-password',
  '/api/v1/auth/reset-password',
];

function addHeaders(req: HttpRequest<unknown>, token: string | null, orgId: string | null) {
  let headers = req.headers;
  if (token) headers = headers.set('Authorization', `Bearer ${token}`);
  if (orgId) headers = headers.set('X-Org-ID', orgId);
  return req.clone({ headers });
}

export const jwtInterceptor: HttpInterceptorFn = (req, next) => {
  const storage = inject(TokenStorageService);
  const tenant  = inject(TenantService);
  const auth    = inject(AuthService);

  const isAuthUrl = AUTH_URLS.some(url => req.url.includes(url));
  if (isAuthUrl) return next(req);

  const cloned = addHeaders(req, storage.getAccessToken(), tenant.activeOrgId());

  return next(cloned).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status !== 401) return throwError(() => err);

      return auth.refreshToken().pipe(
        switchMap((newToken: string) => {
          const retried = addHeaders(req, newToken, tenant.activeOrgId());
          return next(retried).pipe(
            catchError((err2: HttpErrorResponse) => {
              if (err2.status === 401) auth.logout();
              return throwError(() => err2);
            }),
          );
        }),
      );
    }),
  );
};
