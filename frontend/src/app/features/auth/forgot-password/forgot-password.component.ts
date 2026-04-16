// frontend/src/app/features/auth/forgot-password/forgot-password.component.ts
import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AppError, ApiResponse } from '../../../core/models/api-response.model';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  template: `
    <div style="text-align:center;margin-bottom:1.5rem;">
      <h1 class="auth-title">Reset password</h1>
      <p class="auth-subtitle">Enter your email and we'll send a reset link</p>
    </div>

    @if (error()) { <div class="auth-error">{{ error() }}</div> }

    @if (sent()) {
      <div class="auth-success">
        ✓ Check your email for a password reset link.
      </div>
      <div class="auth-footer" style="margin-top:1rem;">
        <a routerLink="/auth/login">Back to sign in</a>
      </div>
    } @else {
      <form [formGroup]="form" (ngSubmit)="submit()">
        <label class="auth-label">Email</label>
        <input type="email" class="auth-input" style="margin-bottom:1.25rem;"
          formControlName="email" placeholder="you@company.com" />
        <button type="submit" class="auth-btn-primary" [disabled]="form.invalid || loading()">
          {{ loading() ? 'Sending…' : 'Send reset link' }}
        </button>
      </form>
      <div class="auth-footer"><a routerLink="/auth/login">← Back to sign in</a></div>
    }
  `,
  styles: [`.auth-title{color:#f1f5f9;font-size:22px;font-weight:700;margin:8px 0 4px}.auth-subtitle{color:#94a3b8;font-size:13px;margin:0 0 1.25rem}`],
})
export class ForgotPasswordComponent {
  readonly error   = signal<string | null>(null);
  readonly loading = signal(false);
  readonly sent    = signal(false);

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });

  constructor(private fb: FormBuilder, private http: HttpClient) {}

  submit(): void {
    if (this.form.invalid) return;
    this.error.set(null);
    this.loading.set(true);
    this.http.post<ApiResponse<void>>('/api/v1/auth/forgot-password', this.form.getRawValue())
      .subscribe({
        next:  () => { this.loading.set(false); this.sent.set(true); },
        error: (err: AppError) => {
          this.loading.set(false);
          this.error.set(err.message ?? 'Failed to send reset email.');
        },
      });
  }
}
