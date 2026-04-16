// frontend/src/app/features/auth/mfa/mfa.component.ts
import { Component, signal, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-mfa',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div style="text-align:center;margin-bottom:1.5rem;">
      <div style="font-size:32px;margin-bottom:8px;">🔐</div>
      <h1 class="auth-title">Two-factor auth</h1>
      <p class="auth-subtitle">Enter the 6-digit code from your authenticator app</p>
    </div>

    @if (error()) { <div class="auth-error">{{ error() }}</div> }

    <div style="display:flex;justify-content:center;margin-bottom:1.5rem;">
      <input
        #codeInput
        type="text"
        inputmode="numeric"
        maxlength="6"
        [ngModel]="code()"
        (ngModelChange)="onDigitInput($event)"
        style="
          width:180px;
          text-align:center;
          font-size:28px;
          letter-spacing:12px;
          font-weight:700;
          color:#f1f5f9;
          background:rgba(255,255,255,0.07);
          border:1px solid rgba(255,255,255,0.15);
          border-radius:12px;
          padding:12px 8px;
        "
        [disabled]="loading()"
        autocomplete="one-time-code"
      />
    </div>

    @if (loading()) {
      <div style="text-align:center;color:#94a3b8;font-size:13px;">Verifying…</div>
    }

    <div style="margin-top:1rem;display:flex;justify-content:space-between;align-items:center;">
      <a routerLink="/auth/login" style="color:#64748b;font-size:12px;">← Back to login</a>
      <button
        style="background:none;border:none;color:#a855f7;font-size:12px;cursor:pointer;"
        (click)="useBackupCode()"
      >Use backup code</button>
    </div>
  `,
  styles: [`.auth-title{color:#f1f5f9;font-size:22px;font-weight:700;margin:8px 0 4px}.auth-subtitle{color:#94a3b8;font-size:13px;margin:0}`],
})
export class MfaComponent implements AfterViewInit {
  @ViewChild('codeInput') codeInput!: ElementRef<HTMLInputElement>;

  readonly code    = signal('');
  readonly error   = signal<string | null>(null);
  readonly loading = signal(false);

  constructor(private auth: AuthService, private router: Router) {}

  ngAfterViewInit(): void {
    this.codeInput?.nativeElement.focus();
  }

  onDigitInput(value: string): void {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    this.code.set(digits);
    if (digits.length === 6) this.submitCode(digits);
  }

  private submitCode(code: string): void {
    this.error.set(null);
    this.loading.set(true);

    this.auth.submitMfa(code).subscribe({
      next: () => { this.loading.set(false); this.router.navigate(['/app']); },
      error: (err: { message?: string }) => {
        this.loading.set(false);
        this.error.set(err.message ?? 'Invalid code. Please try again.');
        this.code.set('');
        setTimeout(() => this.codeInput?.nativeElement.focus(), 50);
      },
    });
  }

  useBackupCode(): void {
    const code = prompt('Enter your backup code:');
    if (code) this.submitCode(code.trim());
  }
}
