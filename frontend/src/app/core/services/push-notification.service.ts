import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, from, switchMap, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/api-response.model';

@Injectable({ providedIn: 'root' })
export class PushNotificationService {
  private http = inject(HttpClient);

  readonly permissionDenied = signal(false);

  isSupported(): boolean {
    return 'serviceWorker' in navigator && 'PushManager' in window;
  }

  requestPermission(): Observable<void> {
    return from(
      navigator.serviceWorker.register('/sw.js').then(async reg => {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          this.permissionDenied.set(true);
          throw new Error('Push permission denied');
        }
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: this.urlBase64ToUint8Array(environment.vapidPublicKey),
          });
        }
        return sub;
      }),
    ).pipe(
      switchMap(sub => {
        const p256dh = this.arrayBufferToBase64(sub.getKey('p256dh')!);
        const auth   = this.arrayBufferToBase64(sub.getKey('auth')!);
        return this.http.post<ApiResponse<unknown>>('/api/v1/push/subscribe', {
          endpoint: sub.endpoint,
          keys: { p256dh, auth },
        });
      }),
      map(() => undefined),
    );
  }

  unsubscribe(): Observable<void> {
    return from(
      navigator.serviceWorker.ready.then(reg => reg.pushManager.getSubscription()),
    ).pipe(
      switchMap(sub => {
        const endpoint = sub?.endpoint ?? '';
        sub?.unsubscribe();
        return this.http.delete<ApiResponse<unknown>>('/api/v1/push/subscribe', { body: { endpoint } });
      }),
      map(() => undefined),
    );
  }

  private urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw     = atob(base64);
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
  }
}
