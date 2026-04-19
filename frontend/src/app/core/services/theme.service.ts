// frontend/src/app/core/services/theme.service.ts
import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { UserService } from './user.service';

type Theme = 'dark' | 'light' | 'system';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>('dark');
  private apply$ = new Subject<Theme>();

  constructor(private userService: UserService) {
    this.apply$.pipe(debounceTime(1000)).subscribe(t => {
      this.userService.savePreferences({ theme: t }).subscribe();
    });
  }

  applyStored(): void {
    const stored = (localStorage.getItem('theme') as Theme | null) ?? 'dark';
    this.apply(stored, false);
  }

  apply(theme: Theme, syncBackend = true): void {
    this.theme.set(theme);
    localStorage.setItem('theme', theme);
    const resolved = theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;
    document.documentElement.setAttribute('data-theme', resolved);
    if (syncBackend) this.apply$.next(theme);
  }
}
