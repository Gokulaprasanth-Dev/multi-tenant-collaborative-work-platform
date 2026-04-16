// frontend/src/app/core/interceptors/idempotency.interceptor.ts
import { HttpInterceptorFn } from '@angular/common/http';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const idempotencyInterceptor: HttpInterceptorFn = (req, next) => {
  if (!MUTATING.has(req.method)) return next(req);
  return next(req.clone({
    headers: req.headers.set('Idempotency-Key', crypto.randomUUID()),
  }));
};
