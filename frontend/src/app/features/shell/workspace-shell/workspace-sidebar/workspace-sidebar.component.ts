// frontend/src/app/features/shell/workspace-shell/workspace-sidebar/workspace-sidebar.component.ts
import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { WorkspaceService } from '../../../../core/services/workspace.service';
import { ChannelService } from '../../../../core/services/channel.service';
import { CreateChannelDialogComponent } from '../../../chat/create-channel-dialog/create-channel-dialog.component';

@Component({
  selector: 'app-workspace-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  template: `
    <!-- Back to workspace list -->
    <a class="workspace-sidebar-back" routerLink="/app/workspaces">← All workspaces</a>

    <!-- Workspace name -->
    <div class="workspace-sidebar-name">{{ workspace()?.name ?? '…' }}</div>

    <!-- Tasks link -->
    <nav>
      <a
        class="workspace-sidebar-item"
        routerLinkActive="active"
        [routerLink]="['/app/workspaces', workspaceId, 'tasks']"
      >
        ☑ Tasks
      </a>
    </nav>

    <!-- Channel list -->
    <div class="workspace-sidebar-section">
      <span>Channels</span>
      <button class="workspace-sidebar-add-btn" title="New channel" (click)="openCreateChannel()">+</button>
    </div>

    @for (ch of channels(); track ch.id) {
      <a
        class="workspace-sidebar-item"
        routerLinkActive="active"
        [routerLink]="['/app/workspaces', workspaceId, 'chat', ch.id]"
      >
        # {{ ch.name }}
      </a>
    }

    @if (channels().length === 0) {
      <div style="padding:6px 12px;color:#475569;font-size:12px;">No channels yet</div>
    }
  `,
})
export class WorkspaceSidebarComponent {
  @Input({ required: true }) workspaceId!: string;

  private wsSvc  = inject(WorkspaceService);
  private chSvc  = inject(ChannelService);
  private dialog = inject(MatDialog);

  readonly workspace = this.wsSvc.activeWorkspace;
  readonly channels  = this.chSvc.channels;

  openCreateChannel(): void {
    this.dialog.open(CreateChannelDialogComponent, {
      data:        { workspaceId: this.workspaceId },
      panelClass:  'dark-dialog',
    });
  }
}
