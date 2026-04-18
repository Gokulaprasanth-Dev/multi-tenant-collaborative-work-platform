// frontend/src/app/features/task/create-task-dialog/create-task-dialog.component.ts
import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { MatDialogRef, MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { TaskService } from '../../../core/services/task.service';
import { AppError } from '../../../core/models/api-response.model';
import { TaskPriority } from '../../../core/models/task.model';

@Component({
  selector: 'app-create-task-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  template: `
    <h2 mat-dialog-title style="color:#f1f5f9;margin:0 0 1rem;">New task</h2>

    <mat-dialog-content style="padding:0;min-width:340px;">
      @if (error()) {
        <div class="auth-error" style="margin-bottom:1rem;">{{ error() }}</div>
      }

      <form [formGroup]="form" (ngSubmit)="submit()" id="create-task-form">
        <mat-form-field appearance="outline" style="width:100%;margin-bottom:0.5rem;">
          <mat-label>Task title</mat-label>
          <input matInput formControlName="title" placeholder="e.g. Fix login bug" autocomplete="off" />
          @if (form.controls.title.errors?.['required'] && form.controls.title.touched) {
            <mat-error>Title is required</mat-error>
          }
        </mat-form-field>

        <mat-form-field appearance="outline" style="width:100%;margin-bottom:0.5rem;">
          <mat-label>Priority</mat-label>
          <mat-select formControlName="priority">
            <mat-option value="low">Low</mat-option>
            <mat-option value="medium">Medium</mat-option>
            <mat-option value="high">High</mat-option>
            <mat-option value="urgent">Urgent</mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" style="width:100%;">
          <mat-label>Due date (optional)</mat-label>
          <input matInput type="datetime-local" formControlName="dueDate" />
        </mat-form-field>
      </form>
    </mat-dialog-content>

    <mat-dialog-actions align="end" style="padding-top:1rem;">
      <button mat-button mat-dialog-close [disabled]="saving()">Cancel</button>
      <button
        mat-flat-button color="primary"
        type="submit"
        form="create-task-form"
        [disabled]="form.invalid || saving()"
      >
        {{ saving() ? 'Creating…' : 'Create' }}
      </button>
    </mat-dialog-actions>
  `,
})
export class CreateTaskDialogComponent {
  private taskSvc   = inject(TaskService);
  private dialogRef = inject(MatDialogRef<CreateTaskDialogComponent>);
  private data      = inject<{ workspaceId: string }>(MAT_DIALOG_DATA);
  private fb        = inject(FormBuilder);

  readonly saving = signal(false);
  readonly error  = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    title:   ['', [Validators.required, Validators.maxLength(500)]],
    priority: ['medium'],
    dueDate:  [''],
  });

  submit(): void {
    if (this.form.invalid) return;
    const { title, priority, dueDate } = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    this.taskSvc.create(this.data.workspaceId, title, {
      priority: priority as TaskPriority,
      dueDate:  dueDate || undefined,
    }).subscribe({
      next:  () => { this.saving.set(false); this.dialogRef.close(true); },
      error: (err: AppError) => {
        this.saving.set(false);
        this.error.set(err.message ?? 'Failed to create task');
      },
    });
  }
}
