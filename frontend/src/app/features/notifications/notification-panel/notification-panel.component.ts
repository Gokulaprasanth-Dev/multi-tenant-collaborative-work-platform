import { Component, computed, inject, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { NotificationService } from '../../../core/services/notification.service';
import { Notification } from '../../../core/models/notification.model';
import { NotificationItemComponent } from '../notification-item/notification-item.component';

type Tab = 'all' | 'unread' | 'mentions';

const MENTION_TYPES = ['task.mentioned', 'chat.mention', 'comment.mentioned'];

@Component({
  selector: 'app-notification-panel',
  standalone: true,
  imports: [CommonModule, RouterLink, NotificationItemComponent],
  template: `
    <div class="notif-panel">
      <div class="notif-panel-header">
        <span class="notif-panel-title">Notifications</span>
        <button class="notif-mark-all-btn" (click)="markAllRead()">Mark all read</button>
      </div>

      <div class="notif-tabs">
        <button
          class="notif-tab"
          [class.notif-tab--active]="activeTab() === 'all'"
          (click)="activeTab.set('all')"
        >All</button>
        <button
          class="notif-tab"
          [class.notif-tab--active]="activeTab() === 'unread'"
          (click)="activeTab.set('unread')"
        >Unread <span class="notif-tab-badge">{{ unreadCount() }}</span></button>
        <button
          class="notif-tab"
          [class.notif-tab--active]="activeTab() === 'mentions'"
          (click)="activeTab.set('mentions')"
        >Mentions</button>
      </div>

      <div class="notif-list">
        @for (n of filtered(); track n.id) {
          <app-notification-item [notification]="n" (read)="markRead(n.id)" />
        }
        @if (filtered().length === 0) {
          <div class="notif-empty">No notifications</div>
        }
      </div>

      <div class="notif-panel-footer">
        <a routerLink="/app/settings/notifications" (click)="closed.emit()">⚙ Preferences</a>
      </div>
    </div>
  `,
})
export class NotificationPanelComponent {
  private notifSvc = inject(NotificationService);

  readonly closed    = output<void>();
  readonly activeTab = signal<Tab>('all');

  private notifications = this.notifSvc.notifications;
  readonly unreadCount  = computed(() => this.notifications().filter(n => !n.isRead).length);

  readonly filtered = computed<Notification[]>(() => {
    const tab = this.activeTab();
    const all = this.notifications();
    if (tab === 'unread')   return all.filter(n => !n.isRead);
    if (tab === 'mentions') return all.filter(n => MENTION_TYPES.includes(n.type));
    return all;
  });

  markRead(id: string): void {
    this.notifSvc.markRead(id).subscribe();
  }

  markAllRead(): void {
    this.notifSvc.markAllRead().subscribe();
  }
}
