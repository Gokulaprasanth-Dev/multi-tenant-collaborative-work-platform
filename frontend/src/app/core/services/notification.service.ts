import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, EMPTY, throwError, Subscription } from 'rxjs';
import { map, tap, catchError } from 'rxjs/operators';
import { TenantService } from './tenant.service';
import { SocketService } from './socket.service';
import { ApiResponse } from '../models/api-response.model';
import { Notification, NotificationDto, toNotification } from '../models/notification.model';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private http   = inject(HttpClient);
  private tenant = inject(TenantService);
  private socket = inject(SocketService);

  readonly notifications = signal<Notification[]>([]);
  readonly unreadCount   = signal(0);
  readonly loading       = signal(false);

  load(limit = 20): Observable<Notification[]> {
    const orgId = this.tenant.activeOrgId();
    if (!orgId) return EMPTY;
    this.loading.set(true);
    return this.http
      .get<ApiResponse<NotificationDto[]>>(`/api/v1/orgs/${orgId}/notifications?limit=${limit}`)
      .pipe(
        map(res => res.data.map(toNotification)),
        tap(items => {
          this.notifications.set(items);
          this.unreadCount.set(items.filter(n => !n.isRead).length);
          this.loading.set(false);
        }),
        catchError(err => { this.loading.set(false); return throwError(() => err); }),
      );
  }

  markRead(id: string): Observable<void> {
    const orgId    = this.tenant.activeOrgId()!;
    const snapshot = this.notifications();
    this.notifications.update(ns => ns.map(n => n.id === id ? { ...n, isRead: true } : n));
    this.unreadCount.set(this.notifications().filter(n => !n.isRead).length);
    return this.http
      .patch<ApiResponse<unknown>>(`/api/v1/orgs/${orgId}/notifications/${id}/read`, {})
      .pipe(
        map(() => undefined),
        catchError(err => {
          this.notifications.set(snapshot);
          this.unreadCount.set(snapshot.filter(n => !n.isRead).length);
          return throwError(() => err);
        }),
      );
  }

  markAllRead(): Observable<void> {
    const orgId    = this.tenant.activeOrgId()!;
    const snapshot = this.notifications();
    this.notifications.update(ns => ns.map(n => ({ ...n, isRead: true })));
    this.unreadCount.set(0);
    return this.http
      .post<ApiResponse<unknown>>(`/api/v1/orgs/${orgId}/notifications/read-all`, {})
      .pipe(
        map(() => undefined),
        catchError(err => {
          this.notifications.set(snapshot);
          this.unreadCount.set(snapshot.filter(n => !n.isRead).length);
          return throwError(() => err);
        }),
      );
  }

  subscribeRealtime(): Subscription {
    return this.socket.fromEvent<NotificationDto>('notification:new').subscribe(dto => {
      const n = toNotification(dto);
      this.notifications.update(ns => [n, ...ns]);
      this.unreadCount.update(c => c + 1);
    });
  }
}
