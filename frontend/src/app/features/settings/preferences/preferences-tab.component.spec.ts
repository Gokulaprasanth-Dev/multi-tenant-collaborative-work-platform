// frontend/src/app/features/settings/preferences/preferences-tab.component.spec.ts
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { PreferencesTabComponent } from './preferences-tab.component';
import { UserService } from '../../../core/services/user.service';
import { ThemeService } from '../../../core/services/theme.service';
import { AuthService } from '../../../core/services/auth.service';
import { User, defaultPreferences } from '../../../core/models/user.model';

const USER: User = {
  id: 'u-1', email: 'a@b.com', name: 'Alice', bio: null, avatarUrl: null,
  emailVerified: true, mfaEnabled: false, role: 'member',
  preferences: { timezone: 'UTC', locale: 'en-US', theme: 'dark', dateFormat: 'DD/MM/YYYY' },
  createdAt: '2024-01-01T00:00:00.000Z',
};

describe('PreferencesTabComponent', () => {
  let fixture: ComponentFixture<PreferencesTabComponent>;
  let userService: { savePreferences: jest.Mock };
  let themeService: { apply: jest.Mock; theme: ReturnType<typeof signal<'dark' | 'light' | 'system'>> };
  let authService: { currentUser: ReturnType<typeof signal<User | null>> };

  beforeEach(async () => {
    userService  = { savePreferences: jest.fn().mockReturnValue(of(defaultPreferences())) };
    themeService = { apply: jest.fn(), theme: signal<'dark' | 'light' | 'system'>('dark') };
    authService  = { currentUser: signal<User | null>(USER) };

    await TestBed.configureTestingModule({
      imports: [PreferencesTabComponent],
      providers: [
        { provide: UserService,  useValue: userService },
        { provide: ThemeService, useValue: themeService },
        { provide: AuthService,  useValue: authService },
        provideAnimations(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PreferencesTabComponent);
    fixture.detectChanges();
  });

  it('initialises form from current user preferences', () => {
    expect(fixture.componentInstance.form.value.timezone).toBe('UTC');
    expect(fixture.componentInstance.form.value.locale).toBe('en-US');
    expect(fixture.componentInstance.form.value.theme).toBe('dark');
    expect(fixture.componentInstance.form.value.dateFormat).toBe('DD/MM/YYYY');
  });

  it('calls userService.savePreferences after 1000ms debounce on change', fakeAsync(() => {
    fixture.componentInstance.form.patchValue({ locale: 'en-GB' });
    tick(999);
    expect(userService.savePreferences).not.toHaveBeenCalled();
    tick(1);
    expect(userService.savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ locale: 'en-GB' }),
    );
  }));

  it('calls themeService.apply() immediately when theme changes', fakeAsync(() => {
    fixture.componentInstance.form.patchValue({ theme: 'light' });
    tick(0);
    expect(themeService.apply).toHaveBeenCalledWith('light');
    tick(1000); // drain debounceTime
  }));

  it('does not call themeService.apply() for non-theme changes', fakeAsync(() => {
    fixture.componentInstance.form.patchValue({ locale: 'en-GB' });
    tick(0);
    expect(themeService.apply).not.toHaveBeenCalled();
    tick(1000); // drain debounceTime
  }));
});
