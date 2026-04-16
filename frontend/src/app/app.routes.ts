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
    path: 'pick-org',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/org-picker/org-picker.component').then(
        m => m.OrgPickerComponent,
      ),
  },
  {
    path: 'app',
    canActivate: [authGuard, orgGuard],
    loadChildren: () =>
      import('./features/shell/shell.routes').then(m => m.shellRoutes),
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
