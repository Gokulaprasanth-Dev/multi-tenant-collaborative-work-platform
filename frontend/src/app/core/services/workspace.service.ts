// frontend/src/app/core/services/workspace.service.ts
import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, EMPTY, of, throwError } from 'rxjs';
import { map, tap, catchError } from 'rxjs';
import { Workspace, WorkspaceDto, toWorkspace } from '../models/workspace.model';
import { ApiResponse } from '../models/api-response.model';
import { TenantService } from './tenant.service';

@Injectable({ providedIn: 'root' })
export class WorkspaceService {
  readonly workspaces      = signal<Workspace[]>([]);
  readonly loading         = signal(false);
  readonly activeWorkspace = signal<Workspace | null>(null);

  constructor(
    private http:   HttpClient,
    private tenant: TenantService,
  ) {}

  load(): Observable<Workspace[]> {
    const orgId = this.tenant.activeOrgId();
    if (!orgId) return EMPTY;
    this.loading.set(true);
    return this.http
      .get<ApiResponse<WorkspaceDto[]>>(`/api/v1/orgs/${orgId}/workspaces`)
      .pipe(
        map((res: ApiResponse<WorkspaceDto[]>) => res.data.map(toWorkspace)),
        tap((ws: Workspace[]) => { this.workspaces.set(ws); this.loading.set(false); }),
        catchError((err: unknown) => { this.loading.set(false); return throwError(() => err); }),
      );
  }

  /** Returns workspace from cache if available; falls back to loading the full list. */
  loadOne(id: string): Observable<Workspace> {
    const cached = this.workspaces().find(w => w.id === id);
    if (cached) {
      this.activeWorkspace.set(cached);
      return of(cached);
    }
    return this.load().pipe(
      map(() => {
        const ws = this.workspaces().find(w => w.id === id);
        if (!ws) throw new Error(`Workspace ${id} not found`);
        this.activeWorkspace.set(ws);
        return ws;
      }),
    );
  }

  create(name: string, description?: string): Observable<Workspace> {
    const orgId = this.tenant.activeOrgId()!;
    return this.http
      .post<ApiResponse<WorkspaceDto>>(`/api/v1/orgs/${orgId}/workspaces`, { name, description })
      .pipe(
        map((res: ApiResponse<WorkspaceDto>) => toWorkspace(res.data)),
        tap((ws: Workspace) => this.workspaces.update((prev: Workspace[]) => [...prev, ws])),
      );
  }
}
