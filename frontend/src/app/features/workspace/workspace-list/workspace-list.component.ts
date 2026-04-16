// frontend/src/app/features/workspace/workspace-list/workspace-list.component.ts
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';
import { CreateWorkspaceDialogComponent } from '../create-workspace-dialog/create-workspace-dialog.component';

@Component({
  selector: 'app-workspace-list',
  standalone: true,
  imports: [CommonModule, RouterLink, LoadingSpinnerComponent],
  template: `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;">
      <h1 style="color:#f1f5f9;font-size:20px;font-weight:700;margin:0;">Workspaces</h1>
    </div>

    @if (loading()) {
      <app-loading-spinner />
    } @else {
      <div class="workspace-grid">
        @for (ws of workspaces(); track ws.id) {
          <a class="workspace-card" [routerLink]="['/app/workspaces', ws.id]">
            <div class="workspace-card-icon">◫</div>
            <div class="workspace-card-name">{{ ws.name }}</div>
            <div class="workspace-card-desc">{{ ws.description ?? 'No description' }}</div>
          </a>
        }

        @empty {
          <div style="grid-column:1/-1;color:#64748b;font-size:14px;padding:2rem 0;">
            No workspaces yet — create your first one.
          </div>
        }

        <button class="workspace-new-btn" (click)="openCreate()">
          <span style="font-size:20px;">+</span> New workspace
        </button>
      </div>
    }
  `,
})
export class WorkspaceListComponent implements OnInit {
  private wsService = inject(WorkspaceService);
  private dialog    = inject(MatDialog);

  readonly workspaces = this.wsService.workspaces;
  readonly loading    = this.wsService.loading;

  ngOnInit(): void {
    this.wsService.load().subscribe();
  }

  openCreate(): void {
    const ref = this.dialog.open(CreateWorkspaceDialogComponent, {
      panelClass: 'dark-dialog',
    });
    ref.afterClosed().subscribe((created: boolean) => {
      if (created) this.wsService.load().subscribe();
    });
  }
}
