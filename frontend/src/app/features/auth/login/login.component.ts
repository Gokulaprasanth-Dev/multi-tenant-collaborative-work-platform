// frontend/src/app/features/auth/login/login.component.ts
import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { AppError } from '../../../core/models/api-response.model';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  template: `
    <div style="text-align:center;margin-bottom:1.5rem;">
      <div class="auth-logo">
        <div class="auth-logo-icon"></div>
      </div>
      <h1 class="auth-title">WorkSpace</h1>
      <p class="auth-subtitle">Sign in to your account</p>
    </div>

    <!-- SSO buttons -->
    <div style="display:flex;gap:8px;margin-bottom:1rem;">
      <button class="auth-btn-sso" (click)="loginWithGoogle()">🔵 Google</button>
      <button class="auth-btn-sso" (click)="loginWithSaml()">🏢 SSO</button>
    </div>

    <!-- Divider -->
    <div class="auth-divider">
      <span class="auth-divider__line"></span>
      <span class="auth-divider__text">or continue with email</span>
      <span class="auth-divider__line"></span>
    </div>

    <!-- Error -->
    @if (error()) {
      <div class="auth-error">{{ error() }}</div>
    }

    <!-- Form -->
    <form [formGroup]="form" (ngSubmit)="submit()">
      <label class="auth-label" for="email">Email</label>
      <input
        id="email"
        type="email"
        class="auth-input"
        style="margin-bottom:1rem;"
        formControlName="email"
        placeholder="you@company.com"
        autocomplete="email"
      />

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <label class="auth-label" style="margin:0" for="password">Password</label>
        <a routerLink="/auth/forgot" style="color:#a855f7;font-size:12px;">Forgot password?</a>
      </div>
      <input
        id="password"
        type="password"
        class="auth-input"
        style="margin-bottom:1.25rem;"
        formControlName="password"
        placeholder="••••••••"
        autocomplete="current-password"
      />

      <button
        type="submit"
        class="auth-btn-primary"
        [disabled]="form.invalid || loading()"
      >
        {{ loading() ? 'Signing in…' : 'Sign in' }}
      </button>
    </form>

    <div class="auth-footer">
      No account? <a routerLink="/auth/register">Create one</a>
    </div>
  `,
  styles: [`
    .auth-logo { text-align:center;margin-bottom:10px; }
    .auth-logo-icon {
      width:44px;height:44px;
      background:linear-gradient(135deg,#a855f7,#06b6d4);
      border-radius:12px;margin:0 auto;
    }
    .auth-title { color:#f1f5f9;font-size:22px;font-weight:700;margin:8px 0 4px; }
    .auth-subtitle { color:#94a3b8;font-size:13px;margin:0 0 1.25rem; }
  `],
})
export class LoginComponent {
  readonly error   = signal<string | null>(null);
  readonly loading = signal(false);

  readonly form = this.fb.nonNullable.group({
    email:    ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  constructor(
    private fb:   FormBuilder,
    private auth: AuthService,
    private router: Router,
  ) {}

  loginWithGoogle(): void {
    window.location.href = '/api/v1/auth/google';
  }

  loginWithSaml(): void {
    window.location.href = '/api/v1/auth/saml/login';
  }

  submit(): void {
    if (this.form.invalid) return;
    this.error.set(null);
    this.loading.set(true);
    const { email, password } = this.form.getRawValue();

    this.auth.login(email, password).subscribe({
      next: (result: import('../../../core/services/auth.service').LoginResult) => {
        this.loading.set(false);
        if ('mfaRequired' in result) {
          this.router.navigate(['/auth/mfa']);
        } else {
          this.router.navigate(['/app']);
        }
      },
      error: (err: AppError) => {
        this.loading.set(false);
        this.error.set(err.message ?? 'Login failed. Please try again.');
      },
    });
  }
}
