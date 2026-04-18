import { Component, input, output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Notification } from '../../../core/models/notification.model';

const TYPE_LABELS: Record<string, string> = {
  'task.assigned':   'assigned you to',
  'task.mentioned':  'mentioned you in task',
  'task.completed':  'completed task',
  'chat.mention':    'mentioned you in',
  'comment.created': 'commented on',
};

@Component({
  selector: 'app-notification-item',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="notif-item"
      [class.notif-item--unread]="!notification().isRead"
      (click)="onClick()"
    >
      @if (!notification().isRead) {
        <span class="notif-dot"></span>
      }
      <div class="notif-item-body">
        <span class="notif-text">{{ label() }}</span>
        <span class="notif-time">{{ notification().createdAt | date:'shortTime' }}</span>
      </div>
    </div>
  `,
})
export class NotificationItemComponent {
  private router = inject(Router);

  readonly notification = input.required<Notification>();
  readonly read         = output<void>();

  label(): string {
    const n      = this.notification();
    const action = TYPE_LABELS[n.type] ?? n.type;
    const entity = (n.payload['entityTitle'] as string | undefined) ?? n.entityId;
    return `${action} ${entity}`;
  }

  onClick(): void {
    this.read.emit();
    const n           = this.notification();
    const workspaceId = n.payload['workspaceId'] as string | undefined;
    if (n.entityType === 'task' && workspaceId) {
      this.router.navigate(['/app/workspaces', workspaceId, 'tasks']);
    } else if (n.entityType === 'channel' && workspaceId) {
      this.router.navigate(['/app/workspaces', workspaceId, 'chat', n.entityId]);
    }
  }
}
