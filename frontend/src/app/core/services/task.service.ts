// frontend/src/app/core/services/task.service.ts
import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, EMPTY, throwError } from 'rxjs';
import { map, tap, catchError } from 'rxjs';
import { Task, TaskDto, TaskStatus, TaskPriority, toTask } from '../models/task.model';
import { Comment, CommentDto, toComment } from '../models/comment.model';
import { ApiResponse } from '../models/api-response.model';
import { TenantService } from './tenant.service';

@Injectable({ providedIn: 'root' })
export class TaskService {
  readonly tasks   = signal<Task[]>([]);
  readonly loading = signal(false);

  constructor(
    private http:   HttpClient,
    private tenant: TenantService,
  ) {}

  load(workspaceId: string): Observable<Task[]> {
    const orgId = this.tenant.activeOrgId();
    if (!orgId) return EMPTY;
    this.loading.set(true);
    return this.http
      .get<ApiResponse<TaskDto[]>>(`/api/v1/orgs/${orgId}/tasks?workspace_id=${workspaceId}`)
      .pipe(
        map((res: ApiResponse<TaskDto[]>) => res.data.map(toTask)),
        tap((tasks: Task[]) => { this.tasks.set(tasks); this.loading.set(false); }),
        catchError((err: unknown) => { this.loading.set(false); return throwError(() => err); }),
      );
  }

  create(
    workspaceId: string,
    title: string,
    opts: { priority?: TaskPriority; dueDate?: string } = {},
  ): Observable<Task> {
    const orgId = this.tenant.activeOrgId()!;
    return this.http
      .post<ApiResponse<TaskDto>>(`/api/v1/orgs/${orgId}/tasks`, {
        workspace_id: workspaceId,
        title,
        priority:    opts.priority ?? 'medium',
        due_date:    opts.dueDate  ?? null,
        assignee_ids: [],
      })
      .pipe(
        map((res: ApiResponse<TaskDto>) => toTask(res.data)),
        tap((task: Task) => this.tasks.update((prev: Task[]) => [...prev, task])),
      );
  }

  addComment(taskId: string, body: Record<string, unknown>, attachments: string[] = []): Observable<Comment> {
    const orgId = this.tenant.activeOrgId()!;
    return this.http
      .post<ApiResponse<CommentDto>>(
        `/api/v1/orgs/${orgId}/tasks/${taskId}/comments`,
        { body: { ...body, attachments } }
      )
      .pipe(map((res: ApiResponse<CommentDto>) => toComment(res.data)));
  }

  updateStatus(taskId: string, status: TaskStatus, version: number): Observable<Task> {
    const orgId = this.tenant.activeOrgId()!;
    const snapshot = this.tasks();
    this.tasks.update((tasks: Task[]) =>
      tasks.map(t => t.id === taskId ? { ...t, status } : t)
    );
    return this.http
      .patch<ApiResponse<TaskDto>>(`/api/v1/orgs/${orgId}/tasks/${taskId}`, { status, version })
      .pipe(
        map((res: ApiResponse<TaskDto>) => toTask(res.data)),
        tap((updated: Task) =>
          this.tasks.update((tasks: Task[]) => tasks.map(t => t.id === taskId ? updated : t))
        ),
        catchError((err: unknown) => {
          this.tasks.set(snapshot);
          return throwError(() => err);
        }),
      );
  }
}
