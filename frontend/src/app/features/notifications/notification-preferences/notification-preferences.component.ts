import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { TenantService } from '../../../core/services/tenant.service';
import { PushNotificationService } from '../../../core/services/push-notification.service';
import { ApiResponse } from '../../../core/models/api-response.model';
import {
  NotificationPreference,
  NotificationPreferenceDto,
  toNotificationPreference,
} from '../../../core/models/notification.model';

@Component({
  selector: 'app-notification-preferences',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="prefs-page">
      <h1 style="color:#f1f5f9;font-size:20px;font-weight:700;margin:0 0 1.5rem;">
        Notification preferences
      </h1>

      @if (pushSvc.isSupported()) {
        @if (pushSvc.permissionDenied()) {
          <div class="prefs-push-blocked">
            Browser notifications are blocked in your browser settings.
          </div>
        } @else {
          <button class="push-enable-btn" (click)="enablePush()">
            Enable browser notifications
          </button>
        }
      }

      <div class="prefs-grid">
        <div class="prefs-grid-header">
          <span>Event</span>
          <span>In-app</span>
          <span>Email</span>
          <span>Push</span>
        </div>

        @for (pref of preferences(); track pref.eventType) {
          <div class="prefs-row">
            <span class="pref-event-type">{{ pref.eventType }}</span>

            <button
              class="pref-toggle pref-toggle-inapp"
              [class.pref-toggle--on]="pref.channelInapp"
              (click)="toggle(pref, 'channelInapp')"
            >{{ pref.channelInapp ? 'On' : 'Off' }}</button>

            <button
              class="pref-toggle pref-toggle-email"
              [class.pref-toggle--on]="pref.channelEmail"
              (click)="toggle(pref, 'channelEmail')"
            >{{ pref.channelEmail ? 'On' : 'Off' }}</button>

            <button
              class="pref-toggle pref-toggle-push"
              [class.pref-toggle--on]="pref.channelPush"
              (click)="toggle(pref, 'channelPush')"
            >{{ pref.channelPush ? 'On' : 'Off' }}</button>
          </div>
        }
      </div>
    </div>
  `,
})
export class NotificationPreferencesComponent implements OnInit {
  private http   = inject(HttpClient);
  private tenant = inject(TenantService);
  readonly pushSvc = inject(PushNotificationService);

  readonly preferences = signal<NotificationPreference[]>([]);

  ngOnInit(): void {
    const orgId = this.tenant.activeOrgId()!;
    this.http
      .get<ApiResponse<NotificationPreferenceDto[]>>(`/api/v1/orgs/${orgId}/notification-preferences`)
      .subscribe(res => this.preferences.set(res.data.map(toNotificationPreference)));
  }

  toggle(pref: NotificationPreference, channel: 'channelInapp' | 'channelEmail' | 'channelPush'): void {
    const orgId   = this.tenant.activeOrgId()!;
    const updated = { ...pref, [channel]: !pref[channel] };
    this.preferences.update(ps => ps.map(p => p.eventType === pref.eventType ? updated : p));
    const body: Record<string, boolean> = {
      channel_inapp: updated.channelInapp,
      channel_email: updated.channelEmail,
      channel_push:  updated.channelPush,
    };
    this.http
      .patch<ApiResponse<unknown>>(
        `/api/v1/orgs/${orgId}/notification-preferences/${pref.eventType}`,
        body,
      )
      .subscribe();
  }

  enablePush(): void {
    this.pushSvc.requestPermission().subscribe();
  }
}
