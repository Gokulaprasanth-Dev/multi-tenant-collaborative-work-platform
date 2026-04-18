// frontend/src/app/core/services/channel.service.ts
import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, EMPTY, throwError } from 'rxjs';
import { map, tap, catchError } from 'rxjs';
import { Channel, ChannelDto, toChannel } from '../models/channel.model';
import { ApiResponse } from '../models/api-response.model';
import { TenantService } from './tenant.service';

@Injectable({ providedIn: 'root' })
export class ChannelService {
  readonly channels = signal<Channel[]>([]);
  readonly loading  = signal(false);

  constructor(
    private http:   HttpClient,
    private tenant: TenantService,
  ) {}

  load(workspaceId: string): Observable<Channel[]> {
    const orgId = this.tenant.activeOrgId();
    if (!orgId) return EMPTY;
    this.loading.set(true);
    return this.http
      .get<ApiResponse<ChannelDto[]>>(`/api/v1/orgs/${orgId}/channels?workspace_id=${workspaceId}`)
      .pipe(
        map((res: ApiResponse<ChannelDto[]>) => res.data.map(toChannel)),
        tap((ch: Channel[]) => { this.channels.set(ch); this.loading.set(false); }),
        catchError((err: unknown) => { this.loading.set(false); return throwError(() => err); }),
      );
  }

  create(name: string, workspaceId: string): Observable<Channel> {
    const orgId = this.tenant.activeOrgId()!;
    return this.http
      .post<ApiResponse<ChannelDto>>(`/api/v1/orgs/${orgId}/channels/workspace`, {
        name,
        workspace_id: workspaceId,
      })
      .pipe(
        map((res: ApiResponse<ChannelDto>) => toChannel(res.data)),
        tap((ch: Channel) => this.channels.update((prev: Channel[]) => [...prev, ch])),
      );
  }
}
