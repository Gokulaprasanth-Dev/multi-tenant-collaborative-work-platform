// frontend/src/app/features/task/task-list/task-list.component.ts
import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { TaskService } from '../../../core/services/task.service';
import { Task, TaskStatus } from '../../../core/models/task.model';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';
import { CreateTaskDialogComponent } from '../create-task-dialog/create-task-dialog.component';
import { TaskCommentComponent } from '../task-comment/task-comment.component';

const STATUS_GROUPS: { status: TaskStatus; label: string }[] = [
  { status: 'todo',        label: 'Todo' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'in_review',   label: 'In Review' },
  { status: 'done',        label: 'Done' },
  { status: 'cancelled',   label: 'Cancelled' },
];

@Component({
  selector: 'app-task-list',
  standalone: true,
  imports: [CommonModule, LoadingSpinnerComponent, TaskCommentComponent],
  template: `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;">
      <h1 style="color:#f1f5f9;font-size:20px;font-weight:700;margin:0;">Tasks</h1>
      <button class="workspace-new-btn" (click)="openCreate()">+ New Task</button>
    </div>

    @if (loading()) {
      <app-loading-spinner />
    } @else {
      @for (group of statusGroups; track group.status) {
        <div class="task-group">
          <div class="task-group-label">
            {{ group.label }} ({{ tasksForStatus(group.status).length }})
          </div>

          @for (task of tasksForStatus(group.status); track task.id) {
            <div class="task-row" (click)="toggleExpand(task.id)" style="cursor:pointer">
              <select
                class="task-status-select"
                [value]="task.status"
                (change)="updateStatus(task, $event)"
                (click)="$event.stopPropagation()"
              >
                <option value="todo">Todo</option>
                <option value="in_progress">In Progress</option>
                <option value="in_review">In Review</option>
                <option value="done">Done</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <span class="task-title">{{ task.title }}</span>
              <span class="task-priority task-priority--{{ task.priority }}">{{ task.priority }}</span>
              <span class="task-due">{{ task.dueDate ? (task.dueDate | date:'MMM d') : '' }}</span>
            </div>
            @if (expandedTaskId() === task.id) {
              <app-task-comment [taskId]="task.id" (commented)="expandedTaskId.set(null)" />
            }
          }

          @if (tasksForStatus(group.status).length === 0) {
            <div class="task-empty">No {{ group.label.toLowerCase() }} tasks</div>
          }
        </div>
      }
    }
  `,
})
export class TaskListComponent implements OnInit {
  private taskSvc = inject(TaskService);
  private route   = inject(ActivatedRoute);
  private dialog  = inject(MatDialog);

  readonly loading        = this.taskSvc.loading;
  readonly tasks          = this.taskSvc.tasks;
  readonly statusGroups   = STATUS_GROUPS;
  readonly expandedTaskId = signal<string | null>(null);

  private workspaceId = '';

  ngOnInit(): void {
    this.workspaceId = this.route.parent!.snapshot.paramMap.get('id')!;
    this.taskSvc.load(this.workspaceId).subscribe();
  }

  tasksForStatus(status: TaskStatus): Task[] {
    return this.tasks().filter(t => t.status === status);
  }

  openCreate(): void {
    const ref = this.dialog.open(CreateTaskDialogComponent, {
      data:       { workspaceId: this.workspaceId },
      panelClass: 'dark-dialog',
    });
    ref.afterClosed().subscribe((created: boolean) => {
      if (created) this.taskSvc.load(this.workspaceId).subscribe();
    });
  }

  toggleExpand(taskId: string): void {
    this.expandedTaskId.update(id => id === taskId ? null : taskId);
  }

  updateStatus(task: Task, event: Event): void {
    const status = (event.target as HTMLSelectElement).value as TaskStatus;
    this.taskSvc.updateStatus(task.id, status, task.version).subscribe({
      error: () => { /* signal reverted by service */ },
    });
  }
}
