// frontend/src/app/features/shell/components/topbar/topbar.component.ts
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TenantService } from '../../../../core/services/tenant.service';
import { SocketService } from '../../../../core/services/socket.service';
import { NotificationBellComponent } from '../../../notifications/notification-bell/notification-bell.component';

@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [CommonModule, NotificationBellComponent],
  template: `
    <span class="topbar-title">{{ org()?.name ?? 'WorkSpace' }}</span>

    <div class="topbar-right">
      <div
        class="topbar-status-dot"
        [class.connected]="connected()"
        [title]="connected() ? 'Real-time connected' : 'Connecting…'"
      ></div>
      <app-notification-bell />
    </div>
  `,
})
export class TopbarComponent {
  private tenant  = inject(TenantService);
  private socket  = inject(SocketService);

  readonly org       = this.tenant.activeOrg;
  readonly connected = this.socket.connected;
}
