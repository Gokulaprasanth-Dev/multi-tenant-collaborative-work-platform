// frontend/src/app/features/settings/settings.routes.ts
import { Routes } from '@angular/router';
import { SettingsComponent } from './settings.component';

export const settingsRoutes: Routes = [
  {
    path: '',
    component: SettingsComponent,
    children: [
      { path: '', redirectTo: 'profile', pathMatch: 'full' },
      {
        path: 'profile',
        loadComponent: () =>
          import('./profile/profile-tab.component').then(m => m.ProfileTabComponent),
      },
      {
        path: 'security',
        loadComponent: () =>
          import('./security/security-tab.component').then(m => m.SecurityTabComponent),
      },
      {
        path: 'preferences',
        loadComponent: () =>
          import('./preferences/preferences-tab.component').then(m => m.PreferencesTabComponent),
      },
      {
        path: 'notifications',
        loadComponent: () =>
          import('../notifications/notification-preferences/notification-preferences.component').then(
            m => m.NotificationPreferencesComponent,
          ),
      },
    ],
  },
];
