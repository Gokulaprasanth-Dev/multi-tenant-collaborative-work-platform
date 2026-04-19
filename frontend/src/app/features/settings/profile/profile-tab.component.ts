// frontend/src/app/features/settings/profile/profile-tab.component.ts
import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { UserService } from '../../../core/services/user.service';
import { AuthService } from '../../../core/services/auth.service';
import { AppError } from '../../../core/models/api-response.model';

@Component({
  selector: 'app-profile-tab',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <h2 style="color:#f1f5f9;font-size:18px;font-weight:700;margin:0 0 1.5rem;">Profile</h2>

    <!-- Avatar -->
    <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem;">
      @if (user()?.avatarUrl) {
        <img data-testid="avatar-img" [src]="user()!.avatarUrl!" alt="Avatar"
             style="width:64px;height:64px;border-radius:50%;object-fit:cover;cursor:pointer;"
             (click)="fileInput.click()" />
      } @else {
        <div data-testid="avatar-initials"
             style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#a855f7,#06b6d4);display:flex;align-items:center;justify-content:center;color:white;font-size:22px;font-weight:700;cursor:pointer;"
             (click)="fileInput.click()">
          {{ initials() }}
        </div>
      }
      <div>
        <div style="color:#f1f5f9;font-size:13px;font-weight:500;margin-bottom:4px;">Profile photo</div>
        <div style="color:#64748b;font-size:12px;">Click avatar to upload. JPG or PNG, max 5 MB.</div>
        @if (avatarLoading()) {
          <div style="color:#a855f7;font-size:12px;margin-top:4px;">Uploading…</div>
        }
        @if (avatarError()) {
          <div style="color:#f87171;font-size:12px;margin-top:4px;">{{ avatarError() }}</div>
        }
      </div>
      <input #fileInput type="file" accept="image/*" style="display:none" (change)="onFileChange($event)" />
    </div>

    <!-- Feedback -->
    @if (success()) {
      <div style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);border-radius:8px;padding:10px 14px;color:#86efac;font-size:13px;margin-bottom:1rem;">
        Profile updated
      </div>
    }
    @if (error()) {
      <div style="background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.3);border-radius:8px;padding:10px 14px;color:#fca5a5;font-size:13px;margin-bottom:1rem;">
        {{ error() }}
      </div>
    }

    <form [formGroup]="form" (ngSubmit)="submit()">
      <mat-form-field appearance="outline" style="width:100%;margin-bottom:0.5rem;">
        <mat-label>Display name</mat-label>
        <input matInput formControlName="name" autocomplete="name" />
        @if (form.controls.name.errors?.['required'] && form.controls.name.touched) {
          <mat-error>Name is required</mat-error>
        }
      </mat-form-field>

      <mat-form-field appearance="outline" style="width:100%;margin-bottom:1rem;">
        <mat-label>Bio (optional)</mat-label>
        <textarea matInput formControlName="bio" rows="3" maxlength="500"
                  placeholder="A short bio about yourself"></textarea>
      </mat-form-field>

      <button mat-flat-button color="primary" type="submit"
              data-testid="save-btn"
              [disabled]="form.invalid || saving()">
        {{ saving() ? 'Saving…' : 'Save changes' }}
      </button>
    </form>
  `,
})
export class ProfileTabComponent implements OnInit {
  private userService = inject(UserService);
  private auth        = inject(AuthService);
  private fb          = inject(FormBuilder);

  readonly user    = this.auth.currentUser;
  readonly saving  = signal(false);
  readonly success = signal(false);
  readonly error   = signal<string | null>(null);
  readonly avatarLoading = signal(false);
  readonly avatarError   = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(255)]],
    bio:  [''],
  });

  ngOnInit(): void {
    const u = this.user();
    if (u) this.form.patchValue({ name: u.name, bio: u.bio ?? '' });
  }

  readonly initials = () => {
    const name = this.user()?.name ?? '';
    return name.split(' ').slice(0, 2).map((w: string) => w[0]).join('').toUpperCase() || '?';
  };

  onFileChange(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.avatarLoading.set(true);
    this.avatarError.set(null);
    this.userService.uploadAvatar(file).subscribe({
      next:  () => this.avatarLoading.set(false),
      error: (err: AppError) => { this.avatarLoading.set(false); this.avatarError.set(err.message ?? 'Upload failed'); },
    });
  }

  submit(): void {
    if (this.form.invalid) return;
    const { name, bio } = this.form.getRawValue();
    this.saving.set(true);
    this.success.set(false);
    this.error.set(null);
    this.userService.updateProfile(name, bio || null).subscribe({
      next:  () => { this.saving.set(false); this.success.set(true); },
      error: (err: AppError) => { this.saving.set(false); this.error.set(err.message ?? 'Failed to update profile'); },
    });
  }
}
