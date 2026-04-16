// frontend/src/app/features/shell/components/topbar/topbar.component.ts
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TenantService } from '../../../../core/services/tenant.service';
import { SocketService } from '../../../../core/services/socket.service';

@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <span class="topbar-title">{{ org()?.name ?? 'WorkSpace' }}</span>

    <!-- WebSocket connection indicator -->
    <div
      class="topbar-status-dot"
      [class.connected]="connected()"
      [title]="connected() ? 'Real-time connected' : 'Connecting…'"
    ></div>
  `,
})
export class TopbarComponent {
  private tenant  = inject(TenantService);
  private socket  = inject(SocketService);

  readonly org       = this.tenant.activeOrg;
  readonly connected = this.socket.connected;
}
