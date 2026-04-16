// frontend/src/app/features/shell/components/sidebar/sidebar.component.ts
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../../../core/services/auth.service';
import { TenantService } from '../../../../core/services/tenant.service';
import { WorkspaceService } from '../../../../core/services/workspace.service';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  template: `
    <!-- Brand / org switcher -->
    <div class="sidebar-brand" (click)="openOrgSwitcher()">
      <div class="sidebar-brand-icon"></div>
      <span class="sidebar-brand-name">{{ org()?.name ?? 'WorkSpace' }}</span>
      <span class="sidebar-brand-chevron">⌄</span>
    </div>

    <!-- Navigation -->
    <nav class="sidebar-nav">
      <div class="sidebar-section-label">Workspaces</div>

      @for (ws of workspaces(); track ws.id) {
        <a
          class="sidebar-nav-item"
          routerLinkActive="active"
          [routerLink]="['/app/workspaces', ws.id]"
        >
          <span class="nav-icon">◫</span>
          <span class="nav-label">{{ ws.name }}</span>
        </a>
      }

      <a class="sidebar-nav-item" routerLink="/app/workspaces" routerLinkActive="active"
         [routerLinkActiveOptions]="{ exact: true }">
        <span class="nav-icon">⊞</span>
        <span class="nav-label">All workspaces</span>
      </a>
    </nav>

    <!-- User footer -->
    <div class="sidebar-footer">
      <div class="sidebar-avatar">
        {{ initials() }}
      </div>
      <div class="sidebar-user-info">
        <div class="sidebar-user-name">{{ user()?.name }}</div>
        <div class="sidebar-user-email">{{ user()?.email }}</div>
      </div>
      <button class="sidebar-logout-btn" title="Sign out" (click)="logout()">⎋</button>
    </div>
  `,
})
export class SidebarComponent {
  private auth    = inject(AuthService);
  private tenant  = inject(TenantService);
  protected ws    = inject(WorkspaceService);

  readonly org        = this.tenant.activeOrg;
  readonly user       = this.auth.currentUser;
  readonly workspaces = this.ws.workspaces;

  readonly initials = () => {
    const name = this.user()?.name ?? '';
    return name.split(' ').slice(0, 2).map((w: string) => w[0]).join('').toUpperCase() || '?';
  };

  logout(): void { this.auth.logout(); }

  openOrgSwitcher(): void {
    window.location.href = '/pick-org';
  }
}
