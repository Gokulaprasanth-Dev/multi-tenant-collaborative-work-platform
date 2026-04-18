// frontend/src/app/features/chat/create-channel-dialog/create-channel-dialog.component.ts
import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { MatDialogRef, MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ChannelService } from '../../../core/services/channel.service';
import { AppError } from '../../../core/models/api-response.model';

@Component({
  selector: 'app-create-channel-dialog',
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
    <h2 mat-dialog-title style="color:#f1f5f9;margin:0 0 1rem;">New channel</h2>

    <mat-dialog-content style="padding:0;min-width:300px;">
      @if (error()) {
        <div class="auth-error" style="margin-bottom:1rem;">{{ error() }}</div>
      }

      <form [formGroup]="form" (ngSubmit)="submit()" id="create-channel-form">
        <mat-form-field appearance="outline" style="width:100%;">
          <mat-label>Channel name</mat-label>
          <input matInput formControlName="name" placeholder="e.g. general" autocomplete="off" />
          @if (form.controls.name.errors?.['required'] && form.controls.name.touched) {
            <mat-error>Name is required</mat-error>
          }
        </mat-form-field>
      </form>
    </mat-dialog-content>

    <mat-dialog-actions align="end" style="padding-top:1rem;">
      <button mat-button mat-dialog-close [disabled]="saving()">Cancel</button>
      <button
        mat-flat-button color="primary"
        type="submit"
        form="create-channel-form"
        [disabled]="form.invalid || saving()"
      >
        {{ saving() ? 'Creating…' : 'Create' }}
      </button>
    </mat-dialog-actions>
  `,
})
export class CreateChannelDialogComponent {
  private chSvc     = inject(ChannelService);
  private dialogRef = inject(MatDialogRef<CreateChannelDialogComponent>);
  private data      = inject<{ workspaceId: string }>(MAT_DIALOG_DATA);
  private fb        = inject(FormBuilder);

  readonly saving = signal(false);
  readonly error  = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(255)]],
  });

  submit(): void {
    if (this.form.invalid) return;
    const { name } = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    this.chSvc.create(name, this.data.workspaceId).subscribe({
      next:  () => { this.saving.set(false); this.dialogRef.close(true); },
      error: (err: AppError) => {
        this.saving.set(false);
        this.error.set(err.message ?? 'Failed to create channel');
      },
    });
  }
}
