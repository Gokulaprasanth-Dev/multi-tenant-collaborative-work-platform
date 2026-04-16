// frontend/src/app/app.config.ts
import { ApplicationConfig } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { routes } from './app.routes';
import { jwtInterceptor }         from './core/interceptors/jwt.interceptor';
import { idempotencyInterceptor } from './core/interceptors/idempotency.interceptor';
import { errorInterceptor }       from './core/interceptors/error.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([
      jwtInterceptor,
      idempotencyInterceptor,
      errorInterceptor,
    ])),
    provideAnimations(),
  ],
};
