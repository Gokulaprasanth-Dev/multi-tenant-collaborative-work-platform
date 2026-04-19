// frontend/src/app/features/settings/security/security-tab.component.spec.ts
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideAnimations } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { SecurityTabComponent } from './security-tab.component';
import { UserService } from '../../../core/services/user.service';
import { Session, MfaStatus } from '../../../core/models/user.model';

const SESSION_A: Session = { id: 's-1', deviceInfo: 'Chrome / macOS', ipAddress: '1.2.3.4', lastActive: '2024-01-01T00:00:00.000Z', isCurrent: true };
const SESSION_B: Session = { id: 's-2', deviceInfo: 'Firefox / Win', ipAddress: '5.6.7.8',  lastActive: '2024-01-02T00:00:00.000Z', isCurrent: false };
const MFA_OFF: MfaStatus = { enabled: false, backupCodesRemaining: 0 };
const MFA_ON:  MfaStatus = { enabled: true,  backupCodesRemaining: 6 };

describe('SecurityTabComponent', () => {
  let fixture: ComponentFixture<SecurityTabComponent>;
  let userService: {
    changePassword: jest.Mock; getSessions: jest.Mock; revokeSession: jest.Mock;
    getMfaStatus: jest.Mock; setupMfa: jest.Mock; confirmMfa: jest.Mock;
    disableMfa: jest.Mock; regenBackupCodes: jest.Mock;
  };

  beforeEach(async () => {
    userService = {
      changePassword:   jest.fn().mockReturnValue(of(undefined)),
      getSessions:      jest.fn().mockReturnValue(of([SESSION_A, SESSION_B])),
      revokeSession:    jest.fn().mockReturnValue(of(undefined)),
      getMfaStatus:     jest.fn().mockReturnValue(of(MFA_OFF)),
      setupMfa:         jest.fn().mockReturnValue(of({ qrCodeUrl: 'otpauth://...', secret: 'SECRET' })),
      confirmMfa:       jest.fn().mockReturnValue(of({ backupCodes: ['aa', 'bb'] })),
      disableMfa:       jest.fn().mockReturnValue(of(undefined)),
      regenBackupCodes: jest.fn().mockReturnValue(of({ backupCodes: ['cc', 'dd'] })),
    };

    await TestBed.configureTestingModule({
      imports: [SecurityTabComponent],
      providers: [
        { provide: UserService, useValue: userService },
        provideAnimations(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SecurityTabComponent);
    fixture.detectChanges();
  });

  // ── Password ─────────────────────────────────────────────────────────────
  it('shows password mismatch error when passwords do not match', fakeAsync(() => {
    setInput(fixture, '[formControlName="newPassword"]', 'abc123');
    setInput(fixture, '[formControlName="confirmPassword"]', 'different');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Passwords do not match');
  }));

  it('calls changePassword on valid submit', fakeAsync(() => {
    setInput(fixture, '[formControlName="currentPassword"]', 'old12345');
    setInput(fixture, '[formControlName="newPassword"]', 'new12345');
    setInput(fixture, '[formControlName="confirmPassword"]', 'new12345');
    fixture.nativeElement.querySelector('button[data-testid="change-password-btn"]').click();
    tick();
    expect(userService.changePassword).toHaveBeenCalledWith('old12345', 'new12345');
  }));

  it('shows success after password change', fakeAsync(() => {
    setInput(fixture, '[formControlName="currentPassword"]', 'old12345');
    setInput(fixture, '[formControlName="newPassword"]', 'new12345');
    setInput(fixture, '[formControlName="confirmPassword"]', 'new12345');
    fixture.nativeElement.querySelector('button[data-testid="change-password-btn"]').click();
    tick();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Password updated');
  }));

  // ── Sessions ─────────────────────────────────────────────────────────────
  it('renders session list on init', fakeAsync(() => {
    tick();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Chrome / macOS');
    expect(fixture.nativeElement.textContent).toContain('Firefox / Win');
  }));

  it('marks current session with "(this device)"', fakeAsync(() => {
    tick();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('(this device)');
  }));

  it('calls revokeSession when Revoke is clicked on non-current session', fakeAsync(() => {
    tick();
    fixture.detectChanges();
    const revokeBtns: NodeListOf<HTMLButtonElement> =
      fixture.nativeElement.querySelectorAll('button[data-testid="revoke-btn"]');
    revokeBtns[0].click();
    tick();
    expect(userService.revokeSession).toHaveBeenCalledWith('s-2');
  }));

  // ── MFA ──────────────────────────────────────────────────────────────────
  it('shows Enable 2FA button when MFA is disabled', fakeAsync(() => {
    tick();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button[data-testid="enable-mfa-btn"]')).toBeTruthy();
  }));

  it('clicking Enable 2FA calls setupMfa and shows QR code', fakeAsync(() => {
    tick();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('button[data-testid="enable-mfa-btn"]').click();
    tick();
    fixture.detectChanges();
    expect(userService.setupMfa).toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('SECRET');
  }));

  it('shows Disable 2FA button when MFA is enabled', fakeAsync(() => {
    userService.getMfaStatus.mockReturnValue(of(MFA_ON));
    fixture = TestBed.createComponent(SecurityTabComponent);
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button[data-testid="disable-mfa-btn"]')).toBeTruthy();
  }));
});

function setInput(fixture: ComponentFixture<unknown>, selector: string, value: string): void {
  const el: HTMLInputElement = fixture.nativeElement.querySelector(selector);
  el.value = value;
  el.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}
