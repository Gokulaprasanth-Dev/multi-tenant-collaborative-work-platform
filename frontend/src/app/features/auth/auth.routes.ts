// frontend/src/app/features/auth/auth.routes.ts
import { Routes } from '@angular/router';
import { AuthLayoutComponent } from './layout/auth-layout.component';

export const authRoutes: Routes = [
  {
    path: '',
    component: AuthLayoutComponent,
    children: [
      { path: '', redirectTo: 'login', pathMatch: 'full' },
      {
        path: 'login',
        loadComponent: () =>
          import('./login/login.component').then(m => m.LoginComponent),
      },
      {
        path: 'register',
        loadComponent: () =>
          import('./register/register.component').then(m => m.RegisterComponent),
      },
      {
        path: 'verify',
        loadComponent: () =>
          import('./verify-email/verify-email.component').then(m => m.VerifyEmailComponent),
      },
      {
        path: 'mfa',
        loadComponent: () =>
          import('./mfa/mfa.component').then(m => m.MfaComponent),
      },
      {
        path: 'forgot',
        loadComponent: () =>
          import('./forgot-password/forgot-password.component').then(m => m.ForgotPasswordComponent),
      },
      {
        path: 'reset',
        loadComponent: () =>
          import('./reset-password/reset-password.component').then(m => m.ResetPasswordComponent),
      },
      {
        path: 'callback',
        loadComponent: () =>
          import('./sso-callback/sso-callback.component').then(m => m.SsoCallbackComponent),
      },
    ],
  },
];
