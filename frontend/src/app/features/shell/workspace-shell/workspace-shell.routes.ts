// frontend/src/app/features/shell/workspace-shell/workspace-shell.routes.ts
import { Routes } from '@angular/router';
import { WorkspaceShellComponent } from './workspace-shell.component';

export const workspaceShellRoutes: Routes = [
  {
    path: '',
    component: WorkspaceShellComponent,
    children: [
      {
        path: '',
        redirectTo: 'tasks',
        pathMatch: 'full',
      },
      {
        path: 'tasks',
        loadComponent: () =>
          import('../../task/task-list/task-list.component').then(
            m => m.TaskListComponent,
          ),
      },
      {
        path: 'chat',
        redirectTo: 'tasks',
        pathMatch: 'full',
      },
      {
        path: 'chat/:channelId',
        loadComponent: () =>
          import('../../chat/channel-view/channel-view.component').then(
            m => m.ChannelViewComponent,
          ),
      },
    ],
  },
];
