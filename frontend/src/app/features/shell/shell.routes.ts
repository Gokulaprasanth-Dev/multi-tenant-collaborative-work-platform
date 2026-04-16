// frontend/src/app/features/shell/shell.routes.ts
import { Routes } from '@angular/router';
import { ShellComponent } from './shell.component';

export const shellRoutes: Routes = [
  {
    path: '',
    component: ShellComponent,
    children: [
      {
        path: '',
        redirectTo: 'workspaces',
        pathMatch: 'full',
      },
      {
        path: 'workspaces',
        loadComponent: () =>
          import('../workspace/workspace-list/workspace-list.component').then(
            m => m.WorkspaceListComponent,
          ),
      },
    ],
  },
];
