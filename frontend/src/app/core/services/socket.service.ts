// frontend/src/app/core/services/socket.service.ts
import { Injectable, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../../environments/environment';
import { TokenStorageService } from './token-storage.service';

@Injectable({ providedIn: 'root' })
export class SocketService {
  private socket: Socket | null = null;
  readonly connected = signal(false);

  constructor(private storage: TokenStorageService) {}

  /** Call from ShellComponent.ngOnInit() after authentication is confirmed. */
  connect(): void {
    if (this.socket?.connected) return;
    const token = this.storage.getAccessToken();
    if (!token) return;

    this.socket = io(environment.wsUrl, {
      auth:               { token },
      reconnectionAttempts: 5,
      transports:         ['websocket'],
    });
    this.socket.on('connect',    () => this.connected.set(true));
    this.socket.on('disconnect', () => this.connected.set(false));
  }

  /** Call from ShellComponent.ngOnDestroy() or AuthService.logout(). */
  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.connected.set(false);
  }

  /** Returns an Observable that emits every time the socket fires the given event. */
  fromEvent<T>(event: string): Observable<T> {
    return new Observable<T>(observer => {
      if (!this.socket) { observer.complete(); return; }
      const handler = (data: T) => observer.next(data);
      this.socket.on(event, handler);
      return () => this.socket?.off(event, handler);
    });
  }

  emit(event: string, data: unknown): void {
    this.socket?.emit(event, data);
  }
}
