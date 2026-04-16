// frontend/src/app/core/interceptors/error.interceptor.ts
import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { throwError, catchError } from 'rxjs';
import { AppError } from '../models/api-response.model';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      const code    = err.error?.error?.code ?? 'UNKNOWN_ERROR';
      const message = err.error?.error?.message ?? err.message;
      return throwError(() => new AppError(code, message, err.status));
    }),
  );
};
