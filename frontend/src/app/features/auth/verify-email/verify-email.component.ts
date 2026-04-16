// frontend/src/app/features/auth/verify-email/verify-email.component.ts
import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div style="text-align:center;padding:1rem 0;">
      @if (status() === 'loading') {
        <div style="color:#94a3b8;font-size:14px;">Verifying your email…</div>
      }
      @if (status() === 'success') {
        <div class="auth-success" style="text-align:left;">
          ✓ Email verified successfully! You can now sign in.
        </div>
        <a routerLink="/auth/login" class="auth-btn-primary"
          style="display:block;text-align:center;text-decoration:none;line-height:42px;margin-top:1rem;">
          Go to sign in
        </a>
      }
      @if (status() === 'error') {
        <div class="auth-error" style="text-align:left;">
          {{ error() }}
        </div>
        <a routerLink="/auth/login" class="auth-btn-primary"
          style="display:block;text-align:center;text-decoration:none;line-height:42px;margin-top:1rem;">
          Back to sign in
        </a>
      }
      @if (status() === 'missing') {
        <div class="auth-error" style="text-align:left;">
          Invalid verification link. Please request a new one.
        </div>
      }
    </div>
  `,
})
export class VerifyEmailComponent implements OnInit {
  readonly status = signal<'loading' | 'success' | 'error' | 'missing'>('loading');
  readonly error  = signal<string | null>(null);

  constructor(private route: ActivatedRoute, private auth: AuthService) {}

  ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (!token) { this.status.set('missing'); return; }

    this.auth.verifyEmail(token).subscribe({
      next:  () => this.status.set('success'),
      error: (err: { message?: string }) => {
        this.error.set(err.message ?? 'Verification failed.');
        this.status.set('error');
      },
    });
  }
}
