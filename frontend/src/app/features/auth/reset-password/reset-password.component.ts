// frontend/src/app/features/auth/reset-password/reset-password.component.ts
import { Component, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, AbstractControl } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AppError, ApiResponse } from '../../../core/models/api-response.model';

function passwordMatch(c: AbstractControl) {
  return c.get('password')?.value === c.get('confirmPassword')?.value ? null : { mismatch: true };
}

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  template: `
    <div style="text-align:center;margin-bottom:1.5rem;">
      <h1 class="auth-title">New password</h1>
      <p class="auth-subtitle">Choose a strong password for your account</p>
    </div>

    @if (error()) { <div class="auth-error">{{ error() }}</div> }
    @if (!token()) {
      <div class="auth-error">Invalid or expired reset link.</div>
      <div class="auth-footer"><a routerLink="/auth/forgot">Request a new link</a></div>
    } @else if (done()) {
      <div class="auth-success">✓ Password updated. You can now sign in.</div>
      <a routerLink="/auth/login" class="auth-btn-primary"
        style="display:block;text-align:center;text-decoration:none;line-height:42px;margin-top:1rem;">
        Sign in
      </a>
    } @else {
      <form [formGroup]="form" (ngSubmit)="submit()">
        <label class="auth-label">New password</label>
        <input type="password" class="auth-input" style="margin-bottom:1rem;"
          formControlName="password" placeholder="Min 8 characters" />
        <label class="auth-label">Confirm password</label>
        <input type="password" class="auth-input" style="margin-bottom:1.25rem;"
          formControlName="confirmPassword" placeholder="••••••••" />
        <button type="submit" class="auth-btn-primary" [disabled]="form.invalid || loading()">
          {{ loading() ? 'Updating…' : 'Update password' }}
        </button>
      </form>
    }
  `,
  styles: [`.auth-title{color:#f1f5f9;font-size:22px;font-weight:700;margin:8px 0 4px}.auth-subtitle{color:#94a3b8;font-size:13px;margin:0 0 1.25rem}`],
})
export class ResetPasswordComponent implements OnInit {
  readonly token   = signal<string | null>(null);
  readonly error   = signal<string | null>(null);
  readonly loading = signal(false);
  readonly done    = signal(false);

  readonly form = this.fb.nonNullable.group({
    password:        ['', [Validators.required, Validators.minLength(8)]],
    confirmPassword: ['', Validators.required],
  }, { validators: passwordMatch });

  constructor(
    private fb:    FormBuilder,
    private route: ActivatedRoute,
    private http:  HttpClient,
  ) {}

  ngOnInit(): void {
    this.token.set(this.route.snapshot.queryParamMap.get('token'));
  }

  submit(): void {
    if (this.form.invalid || !this.token()) return;
    this.error.set(null);
    this.loading.set(true);
    this.http.post<ApiResponse<void>>('/api/v1/auth/reset-password', {
      token:    this.token(),
      password: this.form.getRawValue().password,
    }).subscribe({
      next:  () => { this.loading.set(false); this.done.set(true); },
      error: (err: AppError) => {
        this.loading.set(false);
        this.error.set(err.message ?? 'Failed to reset password.');
      },
    });
  }
}
