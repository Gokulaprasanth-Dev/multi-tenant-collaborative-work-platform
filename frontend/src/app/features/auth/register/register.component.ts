// frontend/src/app/features/auth/register/register.component.ts
import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, AbstractControl } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { AppError } from '../../../core/models/api-response.model';

function passwordMatch(control: AbstractControl) {
  const pw  = control.get('password')?.value;
  const cpw = control.get('confirmPassword')?.value;
  return pw === cpw ? null : { mismatch: true };
}

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  template: `
    <div style="text-align:center;margin-bottom:1.5rem;">
      <div style="width:44px;height:44px;background:linear-gradient(135deg,#a855f7,#06b6d4);border-radius:12px;margin:0 auto 10px;"></div>
      <h1 class="auth-title">Create account</h1>
      <p class="auth-subtitle">Start your free workspace</p>
    </div>

    @if (error()) { <div class="auth-error">{{ error() }}</div> }
    @if (success()) {
      <div class="auth-success">
        ✓ Account created! Check your email to verify your address.
      </div>
    }

    @if (!success()) {
      <form [formGroup]="form" (ngSubmit)="submit()">
        <label class="auth-label">Full name</label>
        <input type="text" class="auth-input" style="margin-bottom:1rem;"
          formControlName="name" placeholder="Alice Smith" />

        <label class="auth-label">Email</label>
        <input type="email" class="auth-input" style="margin-bottom:1rem;"
          formControlName="email" placeholder="you@company.com" />

        <label class="auth-label">Password</label>
        <input type="password" class="auth-input" style="margin-bottom:1rem;"
          formControlName="password" placeholder="Min 8 characters" />

        <label class="auth-label">Confirm password</label>
        <input type="password" class="auth-input" style="margin-bottom:1.25rem;"
          formControlName="confirmPassword" placeholder="••••••••" />

        @if (form.errors?.['mismatch'] && form.get('confirmPassword')?.dirty) {
          <p style="color:#fca5a5;font-size:12px;margin:-0.75rem 0 0.75rem;">Passwords do not match.</p>
        }

        <button type="submit" class="auth-btn-primary" [disabled]="form.invalid || loading()">
          {{ loading() ? 'Creating account…' : 'Create account' }}
        </button>
      </form>
    }

    <div class="auth-footer">
      Already have an account? <a routerLink="/auth/login">Sign in</a>
    </div>
  `,
  styles: [`.auth-title{color:#f1f5f9;font-size:22px;font-weight:700;margin:8px 0 4px}.auth-subtitle{color:#94a3b8;font-size:13px;margin:0 0 1.25rem}`],
})
export class RegisterComponent {
  readonly error   = signal<string | null>(null);
  readonly loading = signal(false);
  readonly success = signal(false);

  readonly form = this.fb.nonNullable.group({
    name:            ['', [Validators.required, Validators.minLength(2)]],
    email:           ['', [Validators.required, Validators.email]],
    password:        ['', [Validators.required, Validators.minLength(8)]],
    confirmPassword: ['', Validators.required],
  }, { validators: passwordMatch });

  constructor(private fb: FormBuilder, private auth: AuthService) {}

  submit(): void {
    if (this.form.invalid) return;
    this.error.set(null);
    this.loading.set(true);
    const { name, email, password } = this.form.getRawValue();

    this.auth.register(name, email, password).subscribe({
      next: () => { this.loading.set(false); this.success.set(true); },
      error: (err: AppError) => {
        this.loading.set(false);
        this.error.set(err.message ?? 'Registration failed. Please try again.');
      },
    });
  }
}
