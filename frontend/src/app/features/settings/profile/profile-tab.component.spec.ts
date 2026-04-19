// frontend/src/app/features/settings/profile/profile-tab.component.spec.ts
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { ProfileTabComponent } from './profile-tab.component';
import { UserService } from '../../../core/services/user.service';
import { AuthService } from '../../../core/services/auth.service';
import { User, defaultPreferences } from '../../../core/models/user.model';

const USER: User = {
  id: 'u-1', email: 'a@b.com', name: 'Alice', bio: 'Hello', avatarUrl: null,
  emailVerified: true, mfaEnabled: false, role: 'member',
  preferences: defaultPreferences(), createdAt: '2024-01-01T00:00:00.000Z',
};

describe('ProfileTabComponent', () => {
  let fixture: ComponentFixture<ProfileTabComponent>;
  let userService: { updateProfile: jest.Mock; uploadAvatar: jest.Mock };
  let authService: { currentUser: ReturnType<typeof signal<User | null>> };

  beforeEach(async () => {
    userService = {
      updateProfile: jest.fn().mockReturnValue(of(USER)),
      uploadAvatar:  jest.fn().mockReturnValue(of(USER)),
    };
    authService = { currentUser: signal<User | null>(USER) };

    await TestBed.configureTestingModule({
      imports: [ProfileTabComponent],
      providers: [
        { provide: UserService, useValue: userService },
        { provide: AuthService, useValue: authService },
        provideAnimations(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProfileTabComponent);
    fixture.detectChanges();
  });

  it('initialises form with current user name and bio', () => {
    const nameInput: HTMLInputElement = fixture.nativeElement.querySelector('input[formControlName="name"]');
    const bioInput:  HTMLTextAreaElement = fixture.nativeElement.querySelector('textarea[formControlName="bio"]');
    expect(nameInput.value).toBe('Alice');
    expect(bioInput.value).toBe('Hello');
  });

  it('shows initials avatar when avatarUrl is null', () => {
    const avatar = fixture.nativeElement.querySelector('[data-testid="avatar-initials"]');
    expect(avatar).toBeTruthy();
    expect(avatar.textContent.trim()).toBe('A');
  });

  it('shows img when avatarUrl is set', fakeAsync(() => {
    authService.currentUser.set({ ...USER, avatarUrl: 'https://cdn/av.png' });
    fixture.detectChanges();
    const img = fixture.nativeElement.querySelector('img[data-testid="avatar-img"]');
    expect(img).toBeTruthy();
    expect(img.src).toContain('https://cdn/av.png');
  }));

  it('save button is disabled when name is empty', () => {
    const nameInput: HTMLInputElement = fixture.nativeElement.querySelector('input[formControlName="name"]');
    nameInput.value = '';
    nameInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('button[data-testid="save-btn"]');
    expect(btn.disabled).toBe(true);
  });

  it('submit() calls userService.updateProfile with form values', fakeAsync(() => {
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('button[data-testid="save-btn"]');
    btn.click();
    tick();
    expect(userService.updateProfile).toHaveBeenCalledWith('Alice', 'Hello');
  }));

  it('shows success message after save', fakeAsync(() => {
    fixture.nativeElement.querySelector('button[data-testid="save-btn"]').click();
    tick();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Profile updated');
  }));

  it('shows error message when updateProfile fails', fakeAsync(() => {
    userService.updateProfile.mockReturnValue(throwError(() => ({ message: 'Server error' })));
    fixture.nativeElement.querySelector('button[data-testid="save-btn"]').click();
    tick();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Server error');
  }));
});
