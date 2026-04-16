// frontend/src/app/features/workspace/create-workspace-dialog/create-workspace-dialog.component.ts
import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { WorkspaceService } from '../../../core/services/workspace.service';

@Component({
  selector: 'app-create-workspace-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <h2 mat-dialog-title style="color:#f1f5f9;margin:0 0 1rem;">New workspace</h2>

    <mat-dialog-content style="padding:0;min-width:320px;">
      @if (error()) {
        <div class="auth-error" style="margin-bottom:1rem;">{{ error() }}</div>
      }

      <form [formGroup]="form" (ngSubmit)="submit()" id="create-ws-form">
        <mat-form-field appearance="outline" style="width:100%;margin-bottom:0.5rem;">
          <mat-label>Workspace name</mat-label>
          <input matInput formControlName="name" placeholder="e.g. Product" autocomplete="off" />
          @if (form.controls.name.errors?.['required'] && form.controls.name.touched) {
            <mat-error>Name is required</mat-error>
          }
        </mat-form-field>

        <mat-form-field appearance="outline" style="width:100%;">
          <mat-label>Description (optional)</mat-label>
          <textarea matInput formControlName="description" rows="3" placeholder="What is this workspace for?"></textarea>
        </mat-form-field>
      </form>
    </mat-dialog-content>

    <mat-dialog-actions align="end" style="padding-top:1rem;">
      <button mat-button mat-dialog-close [disabled]="saving()">Cancel</button>
      <button
        mat-flat-button color="primary"
        type="submit"
        form="create-ws-form"
        [disabled]="form.invalid || saving()"
      >
        {{ saving() ? 'Creating…' : 'Create' }}
      </button>
    </mat-dialog-actions>
  `,
})
export class CreateWorkspaceDialogComponent {
  private wsService  = inject(WorkspaceService);
  private dialogRef  = inject(MatDialogRef<CreateWorkspaceDialogComponent>);
  private fb         = inject(FormBuilder);

  readonly saving = signal(false);
  readonly error  = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    name:        ['', [Validators.required, Validators.maxLength(255)]],
    description: [''],
  });

  submit(): void {
    if (this.form.invalid) return;
    const { name, description } = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    this.wsService.create(name, description || undefined).subscribe({
      next:  () => { this.saving.set(false); this.dialogRef.close(true); },
      error: (err: unknown) => {
        this.saving.set(false);
        const msg = (err as { message?: string })?.message;
        this.error.set(msg ?? 'Failed to create workspace');
      },
    });
  }
}
