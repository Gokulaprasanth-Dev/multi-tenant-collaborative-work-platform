// frontend/src/app/features/auth/mfa/mfa.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { MfaComponent } from './mfa.component';
import { AuthService } from '../../../core/services/auth.service';

describe('MfaComponent', () => {
  let fixture: ComponentFixture<MfaComponent>;
  let component: MfaComponent;
  let authService: { submitMfa: jest.Mock };
  let router: Router;

  beforeEach(async () => {
    authService = { submitMfa: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [MfaComponent],
      providers: [
        { provide: AuthService, useValue: authService },
        provideRouter([]),
      ],
    }).compileComponents();

    fixture   = TestBed.createComponent(MfaComponent);
    component = fixture.componentInstance;
    router    = TestBed.inject(Router);
    fixture.detectChanges();
  });

  it('does NOT submit when code length < 6', () => {
    component.onDigitInput('12345');
    expect(authService.submitMfa).not.toHaveBeenCalled();
  });

  it('auto-submits when code reaches 6 digits', () => {
    const navigateSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    authService.submitMfa.mockReturnValue(of({ user: { id: 'u1' } }));
    component.onDigitInput('123456');
    expect(authService.submitMfa).toHaveBeenCalledWith('123456');
    expect(navigateSpy).toHaveBeenCalledWith(['/app']);
  });

  it('shows error and clears code on wrong TOTP', () => {
    authService.submitMfa.mockReturnValue(
      throwError(() => ({ message: 'Invalid code', code: 'MFA_INVALID' }))
    );
    component.onDigitInput('999999');
    expect(component.error()).toBe('Invalid code');
    expect(component.code()).toBe('');
  });
});
