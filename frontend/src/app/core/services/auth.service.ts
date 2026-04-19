// frontend/src/app/core/services/auth.service.ts
import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, BehaviorSubject, throwError } from 'rxjs';
import { map, switchMap, catchError, tap, filter, take } from 'rxjs';
import { User, defaultPreferences } from '../models/user.model';
import { ApiResponse } from '../models/api-response.model';
import { TokenStorageService } from './token-storage.service';

export type LoginResult = { user: User } | { mfaRequired: true };

@Injectable({ providedIn: 'root' })
export class AuthService {
  // Expose signals publicly as readonly
  private currentUserSignal = signal<User | null>(null);
  readonly currentUser      = this.currentUserSignal.asReadonly();
  readonly isLoggedIn       = computed(() => !!this.currentUserSignal());
  readonly isLoading        = signal(false);

  // Refresh token queue — prevents multiple concurrent refresh calls
  private refreshing$     = new BehaviorSubject<boolean>(false);
  private refreshToken$?: Observable<string>;

  constructor(
    private http:    HttpClient,
    private storage: TokenStorageService,
    private router:  Router,
  ) {}

  login(email: string, password: string): Observable<LoginResult> {
    this.isLoading.set(true);
    return this.http
      .post<ApiResponse<any>>('/api/v1/auth/login', { email, password })
      .pipe(
        map((res: ApiResponse<any>) => {
          if (res.data.mfa_required) return { mfaRequired: true as const };
          this.currentUserSignal.set(res.data.user);
          this.storage.setAccessToken(res.data.accessToken);
          this.storage.setRefreshToken(res.data.refreshToken);
          return { user: res.data.user };
        }),
        tap(() => this.isLoading.set(false)),
        catchError((err: unknown) => { this.isLoading.set(false); return throwError(() => err); }),
      );
  }

  register(name: string, email: string, password: string): Observable<void> {
    return this.http
      .post<ApiResponse<void>>('/api/v1/auth/register', { name, email, password })
      .pipe(map(() => void 0));
  }

  verifyEmail(token: string): Observable<void> {
    return this.http
      .post<ApiResponse<void>>('/api/v1/auth/verify-email', { token })
      .pipe(map(() => void 0));
  }

  submitMfa(code: string): Observable<{ user: User }> {
    return this.http
      .post<ApiResponse<{ user: User; accessToken: string; refreshToken: string }>>('/api/v1/auth/mfa/verify', { code })
      .pipe(
        map((res: ApiResponse<{ user: User; accessToken: string; refreshToken: string }>) => {
          this.currentUserSignal.set(res.data.user);
          this.storage.setAccessToken(res.data.accessToken);
          this.storage.setRefreshToken(res.data.refreshToken);
          return { user: res.data.user };
        }),
      );
  }

  refreshToken(): Observable<string> {
    // Queue concurrent calls — only one HTTP request fires
    if (!this.refreshing$.value) {
      this.refreshing$.next(true);
      this.refreshToken$ = this.http
        .post<ApiResponse<{ accessToken: string }>>('/api/v1/auth/refresh', {
          refreshToken: this.storage.getRefreshToken(),
        })
        .pipe(
          map((res: ApiResponse<{ accessToken: string }>) => {
            this.storage.setAccessToken(res.data.accessToken);
            this.refreshing$.next(false);
            return res.data.accessToken;
          }),
          catchError((err: unknown) => {
            this.refreshing$.next(false);
            this.logout();
            return throwError(() => err);
          }),
        );
    }
    return this.refreshing$.pipe(
      filter((r: boolean) => !r),
      take(1),
      switchMap(() => new Observable<string>((obs: import('rxjs').Observer<string>) => {
        const t = this.storage.getAccessToken();
        if (t) { obs.next(t); obs.complete(); }
        else obs.error(new Error('No token after refresh'));
      })),
    );
  }

  handleSsoToken(token: string): void {
    // Backend sends a pre-signed JWT; decode payload for user info
    const payload = JSON.parse(atob(token.split('.')[1]));
    this.storage.setAccessToken(token);
    if (payload.refreshToken) this.storage.setRefreshToken(payload.refreshToken);
    this.currentUserSignal.set({
      id:            payload.sub,
      email:         payload.email,
      name:          payload.name ?? payload.email,
      bio:           null,
      avatarUrl:     null,
      emailVerified: true,
      mfaEnabled:    payload.mfaEnabled ?? false,
      role:          payload.role ?? 'member',
      preferences:   defaultPreferences(),
      createdAt:     payload.iat ? new Date(payload.iat * 1000).toISOString() : '',
    });
  }

  /** Called by UserService after profile/preferences mutations. */
  updateCurrentUser(user: User): void {
    this.currentUserSignal.set(user);
  }

  logout(): void {
    this.currentUserSignal.set(null);
    this.storage.clear();
    this.router.navigate(['/auth/login']);
  }
}
