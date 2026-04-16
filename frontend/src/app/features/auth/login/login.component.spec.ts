// frontend/src/app/features/auth/login/login.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { LoginComponent } from './login.component';
import { AuthService } from '../../../core/services/auth.service';
import { AppError } from '../../../core/models/api-response.model';

describe('LoginComponent', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let component: LoginComponent;
  let authService: { login: jest.Mock; isLoading: { set: jest.Mock } };
  let router: Router;

  beforeEach(async () => {
    authService = { login: jest.fn(), isLoading: { set: jest.fn() } };

    await TestBed.configureTestingModule({
      imports: [LoginComponent, ReactiveFormsModule],
      providers: [
        { provide: AuthService, useValue: authService },
        provideRouter([]),
      ],
    }).compileComponents();

    fixture   = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    router    = TestBed.inject(Router);
    fixture.detectChanges();
  });

  it('submit button is disabled when form is invalid', () => {
    const btn = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(btn.disabled).toBe(true);
  });

  it('calls authService.login with form values on submit', () => {
    authService.login.mockReturnValue(of({ user: { id: 'u1' } }));
    component.form.setValue({ email: 'a@b.com', password: 'password123' });
    fixture.detectChanges();
    component.submit();
    expect(authService.login).toHaveBeenCalledWith('a@b.com', 'password123');
  });

  it('navigates to /auth/mfa when backend returns mfaRequired', () => {
    const navigateSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    authService.login.mockReturnValue(of({ mfaRequired: true }));
    component.form.setValue({ email: 'a@b.com', password: 'password123' });
    component.submit();
    expect(navigateSpy).toHaveBeenCalledWith(['/auth/mfa']);
  });

  it('shows error message on login failure', () => {
    authService.login.mockReturnValue(
      throwError(() => new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401))
    );
    component.form.setValue({ email: 'a@b.com', password: 'wrongpass' });
    component.submit();
    fixture.detectChanges();
    expect(component.error()).toBe('Invalid email or password');
  });
});
