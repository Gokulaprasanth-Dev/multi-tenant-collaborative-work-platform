// frontend/src/app/core/services/theme.service.spec.ts
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ThemeService } from './theme.service';
import { UserService } from './user.service';

describe('ThemeService', () => {
  let service: ThemeService;
  let userService: { savePreferences: jest.Mock };

  beforeEach(() => {
    userService = { savePreferences: jest.fn().mockReturnValue({ subscribe: jest.fn() }) };
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');

    TestBed.configureTestingModule({
      providers: [{ provide: UserService, useValue: userService }],
    });
    service = TestBed.inject(ThemeService);
  });

  it('theme signal defaults to dark', () => {
    expect(service.theme()).toBe('dark');
  });

  it('applyStored() reads from localStorage', () => {
    localStorage.setItem('theme', 'light');
    service.applyStored();
    expect(service.theme()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('applyStored() defaults to dark when localStorage is empty', () => {
    service.applyStored();
    expect(service.theme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('apply() sets signal, DOM attribute and localStorage', () => {
    service.apply('light');
    expect(service.theme()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('apply("system") resolves to dark or light on DOM based on OS preference', () => {
    service.apply('system');
    expect(service.theme()).toBe('system');
    const attr = document.documentElement.getAttribute('data-theme');
    expect(['dark', 'light']).toContain(attr);
  });

  it('apply() calls userService.savePreferences after 1000ms', fakeAsync(() => {
    service.apply('light');
    expect(userService.savePreferences).not.toHaveBeenCalled();
    tick(1000);
    expect(userService.savePreferences).toHaveBeenCalledWith({ theme: 'light' });
  }));

  it('rapid apply() calls debounce — only last call triggers savePreferences', fakeAsync(() => {
    service.apply('light');
    tick(500);
    service.apply('dark');
    tick(1000);
    expect(userService.savePreferences).toHaveBeenCalledTimes(1);
    expect(userService.savePreferences).toHaveBeenCalledWith({ theme: 'dark' });
  }));
});
