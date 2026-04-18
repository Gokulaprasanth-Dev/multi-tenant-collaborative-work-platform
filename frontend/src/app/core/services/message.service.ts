// frontend/src/app/core/services/message.service.ts
import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subscription, EMPTY, throwError } from 'rxjs';
import { map, tap, catchError } from 'rxjs';
import { Message, MessageDto, toMessage } from '../models/message.model';
import { ApiResponse } from '../models/api-response.model';
import { TenantService } from './tenant.service';
import { SocketService } from './socket.service';

@Injectable({ providedIn: 'root' })
export class MessageService {
  readonly messages = signal<Message[]>([]);
  readonly sending  = signal(false);

  constructor(
    private http:   HttpClient,
    private tenant: TenantService,
    private socket: SocketService,
  ) {}

  load(channelId: string): Observable<Message[]> {
    const orgId = this.tenant.activeOrgId();
    if (!orgId) return EMPTY;
    return this.http
      .get<ApiResponse<MessageDto[]>>(
        `/api/v1/orgs/${orgId}/channels/${channelId}/messages?limit=50`
      )
      .pipe(
        map((res: ApiResponse<MessageDto[]>) => res.data.map(toMessage)),
        tap((msgs: Message[]) => this.messages.set(msgs)),
      );
  }

  send(channelId: string, body: string): Observable<Message> {
    const orgId = this.tenant.activeOrgId()!;
    this.sending.set(true);
    return this.http
      .post<ApiResponse<MessageDto>>(
        `/api/v1/orgs/${orgId}/channels/${channelId}/messages`,
        { body, client_message_id: crypto.randomUUID() }
      )
      .pipe(
        map((res: ApiResponse<MessageDto>) => toMessage(res.data)),
        tap(() => this.sending.set(false)),
        catchError((err: unknown) => { this.sending.set(false); return throwError(() => err); }),
      );
  }

  subscribeRealtime(channelId: string): Subscription {
    return this.socket.fromEvent<MessageDto>('chat:message').subscribe((dto: MessageDto) => {
      if (dto.channel_id !== channelId) return;
      const incoming = toMessage(dto);
      this.messages.update((msgs: Message[]) =>
        msgs.some(m => m.id === incoming.id) ? msgs : [...msgs, incoming]
      );
    });
  }
}
