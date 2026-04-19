// frontend/src/app/features/settings/security/security-tab.component.ts
import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { UserService } from '../../../core/services/user.service';
import { Session, MfaStatus } from '../../../core/models/user.model';
import { AppError } from '../../../core/models/api-response.model';

function passwordsMatch(control: AbstractControl): ValidationErrors | null {
  const parent = control.parent;
  if (!parent) return null;
  return parent.get('newPassword')?.value === control.value ? null : { mismatch: true };
}

@Component({
  selector: 'app-security-tab',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <h2 style="color:#f1f5f9;font-size:18px;font-weight:700;margin:0 0 1.5rem;">Account Security</h2>

    <!-- ── Change password ───────────────────────────────────────── -->
    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:1.25rem;margin-bottom:1.5rem;">
      <h3 style="color:#f1f5f9;font-size:14px;font-weight:600;margin:0 0 1rem;">Change password</h3>

      @if (pwSuccess()) {
        <div style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);border-radius:8px;padding:8px 12px;color:#86efac;font-size:13px;margin-bottom:1rem;">
          Password updated
        </div>
      }
      @if (pwError()) {
        <div style="background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.3);border-radius:8px;padding:8px 12px;color:#fca5a5;font-size:13px;margin-bottom:1rem;">
          {{ pwError() }}
        </div>
      }

      <form [formGroup]="pwForm" (ngSubmit)="submitPassword()">
        <mat-form-field appearance="outline" style="width:100%;margin-bottom:0.5rem;">
          <mat-label>Current password</mat-label>
          <input matInput type="password" formControlName="currentPassword" autocomplete="current-password" />
        </mat-form-field>
        <mat-form-field appearance="outline" style="width:100%;margin-bottom:0.5rem;">
          <mat-label>New password</mat-label>
          <input matInput type="password" formControlName="newPassword" autocomplete="new-password" />
        </mat-form-field>
        <mat-form-field appearance="outline" style="width:100%;">
          <mat-label>Confirm new password</mat-label>
          <input matInput type="password" formControlName="confirmPassword" autocomplete="new-password" />
        </mat-form-field>
        @if (pwForm.controls.confirmPassword.errors?.['mismatch']) {
          <div style="color:#f87171;font-size:12px;margin:-0.5rem 0 0.75rem;">Passwords do not match</div>
        }
        <button mat-flat-button color="primary" type="submit"
                data-testid="change-password-btn"
                [disabled]="pwForm.invalid || pwSaving()">
          {{ pwSaving() ? 'Updating…' : 'Update password' }}
        </button>
      </form>
    </div>

    <!-- ── MFA ───────────────────────────────────────────────────── -->
    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:1.25rem;margin-bottom:1.5rem;">
      <h3 style="color:#f1f5f9;font-size:14px;font-weight:600;margin:0 0 0.75rem;">Two-factor authentication</h3>

      @if (mfaStatus() === null) {
        <div style="color:#64748b;font-size:13px;">Loading…</div>
      } @else if (setupData()) {
        <!-- Setup flow -->
        <p style="color:#94a3b8;font-size:13px;margin:0 0 0.75rem;">Scan this QR code with your authenticator app, then enter the 6-digit code to confirm.</p>
        <img [src]="setupData()!.qrCodeUrl" alt="QR code" style="width:160px;height:160px;border-radius:8px;margin-bottom:0.75rem;display:block;" />
        <p style="color:#64748b;font-size:12px;font-family:monospace;margin:0 0 1rem;">Manual: {{ setupData()!.secret }}</p>
        <form [formGroup]="mfaForm" (ngSubmit)="confirmMfa()">
          <mat-form-field appearance="outline" style="width:200px;margin-bottom:1rem;">
            <mat-label>6-digit code</mat-label>
            <input matInput formControlName="code" maxlength="6" autocomplete="one-time-code" />
          </mat-form-field>
          <div style="display:flex;gap:8px;">
            <button mat-flat-button color="primary" type="submit" [disabled]="mfaForm.invalid">Verify &amp; enable</button>
            <button mat-button type="button" (click)="cancelSetup()">Cancel</button>
          </div>
        </form>
      } @else if (backupCodes()) {
        <!-- Backup codes reveal -->
        <p style="color:#86efac;font-size:13px;margin:0 0 0.75rem;">2FA enabled. Save these backup codes in a safe place — each can be used once.</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-family:monospace;font-size:13px;margin-bottom:1rem;">
          @for (c of backupCodes()!; track c) {
            <span style="color:#f1f5f9;background:rgba(255,255,255,0.06);padding:4px 8px;border-radius:4px;">{{ c }}</span>
          }
        </div>
        <button mat-flat-button color="primary" (click)="backupCodes.set(null)">Done</button>
      } @else if (mfaStatus()!.enabled) {
        <!-- Enabled state -->
        <p style="color:#86efac;font-size:13px;margin:0 0 0.5rem;">2FA is <strong>enabled</strong>. Backup codes remaining: {{ mfaStatus()!.backupCodesRemaining }}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button mat-stroked-button data-testid="disable-mfa-btn" (click)="disableMfaConfirm.set(true)">Disable 2FA</button>
          <button mat-stroked-button (click)="regenCodes()">Regenerate backup codes</button>
        </div>
        @if (disableMfaConfirm()) {
          <form [formGroup]="disableForm" (ngSubmit)="disableMfa()" style="margin-top:1rem;">
            <mat-form-field appearance="outline" style="width:100%;max-width:280px;">
              <mat-label>Confirm with your password</mat-label>
              <input matInput type="password" formControlName="password" />
            </mat-form-field>
            <div style="display:flex;gap:8px;margin-top:0.5rem;">
              <button mat-flat-button color="warn" type="submit" [disabled]="disableForm.invalid">Disable</button>
              <button mat-button type="button" (click)="disableMfaConfirm.set(false)">Cancel</button>
            </div>
          </form>
        }
      } @else {
        <!-- Disabled state -->
        <p style="color:#94a3b8;font-size:13px;margin:0 0 0.75rem;">2FA is not enabled. Add an extra layer of security to your account.</p>
        <button mat-flat-button color="primary" data-testid="enable-mfa-btn" (click)="enableMfa()">Enable 2FA</button>
      }
    </div>

    <!-- ── Active sessions ────────────────────────────────────────── -->
    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:1.25rem;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;">
        <h3 style="color:#f1f5f9;font-size:14px;font-weight:600;margin:0;">Active sessions</h3>
        <button mat-stroked-button style="font-size:12px;" (click)="revokeOthers()">Sign out everywhere else</button>
      </div>
      @for (s of sessions(); track s.id) {
        <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
          <div style="flex:1;">
            <div style="color:#f1f5f9;font-size:13px;font-weight:500;">
              {{ s.deviceInfo }}
              @if (s.isCurrent) { <span style="color:#22c55e;font-size:11px;margin-left:6px;">(this device)</span> }
            </div>
            <div style="color:#64748b;font-size:12px;">{{ s.ipAddress }} · Last active {{ s.lastActive | date:'mediumDate' }}</div>
          </div>
          @if (!s.isCurrent) {
            <button mat-stroked-button data-testid="revoke-btn" (click)="revokeSession(s.id)" style="font-size:12px;">Revoke</button>
          }
        </div>
      }
    </div>
  `,
})
export class SecurityTabComponent implements OnInit {
  private userService = inject(UserService);
  private fb          = inject(FormBuilder);

  readonly sessions          = signal<Session[]>([]);
  readonly mfaStatus         = signal<MfaStatus | null>(null);
  readonly setupData         = signal<{ qrCodeUrl: string; secret: string } | null>(null);
  readonly backupCodes       = signal<string[] | null>(null);
  readonly disableMfaConfirm = signal(false);
  readonly pwSaving          = signal(false);
  readonly pwSuccess         = signal(false);
  readonly pwError           = signal<string | null>(null);

  readonly pwForm = this.fb.nonNullable.group({
    currentPassword: ['', Validators.required],
    newPassword:     ['', [Validators.required, Validators.minLength(8)]],
    confirmPassword: ['', [Validators.required, passwordsMatch]],
  });

  readonly mfaForm = this.fb.nonNullable.group({
    code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });

  readonly disableForm = this.fb.nonNullable.group({
    password: ['', Validators.required],
  });

  ngOnInit(): void {
    this.userService.getSessions().subscribe(s => this.sessions.set(s));
    this.userService.getMfaStatus().subscribe(s => this.mfaStatus.set(s));
    this.pwForm.controls.newPassword.valueChanges.subscribe(() => {
      this.pwForm.controls.confirmPassword.updateValueAndValidity();
    });
  }

  submitPassword(): void {
    if (this.pwForm.invalid) return;
    const { currentPassword, newPassword } = this.pwForm.getRawValue();
    this.pwSaving.set(true);
    this.pwError.set(null);
    this.userService.changePassword(currentPassword, newPassword).subscribe({
      next:  () => { this.pwSaving.set(false); this.pwSuccess.set(true); this.pwForm.reset(); },
      error: (err: AppError) => { this.pwSaving.set(false); this.pwError.set(err.message ?? 'Failed'); },
    });
  }

  enableMfa(): void {
    this.userService.setupMfa().subscribe(data => this.setupData.set(data));
  }

  cancelSetup(): void {
    this.setupData.set(null);
    this.mfaForm.reset();
  }

  confirmMfa(): void {
    const { code } = this.mfaForm.getRawValue();
    this.userService.confirmMfa(code).subscribe(r => {
      this.setupData.set(null);
      this.backupCodes.set(r.backupCodes);
      this.mfaStatus.set({ enabled: true, backupCodesRemaining: r.backupCodes.length });
    });
  }

  disableMfa(): void {
    const { password } = this.disableForm.getRawValue();
    this.userService.disableMfa(password).subscribe(() => {
      this.mfaStatus.set({ enabled: false, backupCodesRemaining: 0 });
      this.disableMfaConfirm.set(false);
      this.disableForm.reset();
    });
  }

  regenCodes(): void {
    this.userService.regenBackupCodes().subscribe(r => this.backupCodes.set(r.backupCodes));
  }

  revokeSession(id: string): void {
    this.userService.revokeSession(id).subscribe(() =>
      this.sessions.update(s => s.filter(x => x.id !== id)),
    );
  }

  revokeOthers(): void {
    this.sessions()
      .filter(s => !s.isCurrent)
      .forEach(s => this.revokeSession(s.id));
  }
}
