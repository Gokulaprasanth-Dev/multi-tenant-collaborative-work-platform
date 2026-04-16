// frontend/src/app/app.routes.ts
import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { orgGuard }  from './core/guards/org.guard';
import { roleGuard } from './core/guards/role.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: '/app',
    pathMatch: 'full',
  },
  {
    path: 'auth',
    loadChildren: () =>
      import('./features/auth/auth.routes').then(m => m.authRoutes),
  },
  {
    path: 'app',
    canActivate: [authGuard, orgGuard],
    loadComponent: () =>
      import('./features/shell/shell-placeholder.component').then(
        m => m.ShellPlaceholderComponent,
      ),
  },
  {
    path: 'admin',
    canActivate: [authGuard, roleGuard('platform_admin')],
    loadComponent: () =>
      import('./features/admin/admin-placeholder.component').then(
        m => m.AdminPlaceholderComponent,
      ),
  },
  {
    path: '**',
    redirectTo: '/auth/login',
  },
];
