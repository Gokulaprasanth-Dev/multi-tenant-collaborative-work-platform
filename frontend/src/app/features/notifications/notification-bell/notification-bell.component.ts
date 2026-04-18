import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { NotificationService } from '../../../core/services/notification.service';
import { NotificationPanelComponent } from '../notification-panel/notification-panel.component';

@Component({
  selector: 'app-notification-bell',
  standalone: true,
  imports: [CommonModule, NotificationPanelComponent],
  template: `
    <div class="notif-bell-wrapper">
      <button class="notif-bell-btn" (click)="togglePanel()" aria-label="Notifications">
        🔔
        @if (unreadCount() > 0) {
          <span class="notif-badge">{{ unreadCount() }}</span>
        }
      </button>

      @if (panelOpen()) {
        <app-notification-panel (close)="panelOpen.set(false)" />
      }
    </div>
  `,
})
export class NotificationBellComponent implements OnInit, OnDestroy {
  private notifSvc = inject(NotificationService);

  readonly unreadCount = this.notifSvc.unreadCount;
  readonly panelOpen   = signal(false);

  private realtimeSub?: Subscription;

  ngOnInit(): void {
    this.notifSvc.load().subscribe();
    this.realtimeSub = this.notifSvc.subscribeRealtime();
  }

  ngOnDestroy(): void {
    this.realtimeSub?.unsubscribe();
  }

  togglePanel(): void {
    this.panelOpen.update(v => !v);
  }
}
