// frontend/src/app/core/services/user.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map, tap } from 'rxjs';
import { User, UserDto, UserPreferences, Session, MfaStatus, toUser } from '../models/user.model';
import { ApiResponse } from '../models/api-response.model';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class UserService {
  constructor(
    private http: HttpClient,
    private auth: AuthService,
  ) {}

  updateProfile(name: string, bio: string | null): Observable<User> {
    return this.http
      .patch<ApiResponse<UserDto>>('/api/v1/me', { name, bio })
      .pipe(map(r => toUser(r.data)), tap(u => this.auth.updateCurrentUser(u)));
  }

  uploadAvatar(file: File): Observable<User> {
    const fd = new FormData();
    fd.append('avatar', file);
    return this.http
      .post<ApiResponse<UserDto>>('/api/v1/me/avatar', fd)
      .pipe(map(r => toUser(r.data)), tap(u => this.auth.updateCurrentUser(u)));
  }

  changePassword(currentPassword: string, newPassword: string): Observable<void> {
    return this.http
      .patch<ApiResponse<null>>('/api/v1/me/password', { currentPassword, newPassword })
      .pipe(map(() => void 0));
  }

  getSessions(): Observable<Session[]> {
    return this.http
      .get<ApiResponse<Session[]>>('/api/v1/me/sessions')
      .pipe(map(r => r.data));
  }

  revokeSession(sessionId: string): Observable<void> {
    return this.http
      .delete<ApiResponse<null>>(`/api/v1/me/sessions/${sessionId}`)
      .pipe(map(() => void 0));
  }

  getMfaStatus(): Observable<MfaStatus> {
    return this.http
      .get<ApiResponse<MfaStatus>>('/api/v1/me/mfa')
      .pipe(map(r => r.data));
  }

  setupMfa(): Observable<{ qrCodeUrl: string; secret: string }> {
    return this.http
      .post<ApiResponse<{ qrCodeUrl: string; secret: string }>>('/api/v1/me/mfa/setup', {})
      .pipe(map(r => r.data));
  }

  confirmMfa(code: string): Observable<{ backupCodes: string[] }> {
    return this.http
      .post<ApiResponse<{ backupCodes: string[] }>>('/api/v1/me/mfa/confirm', { code })
      .pipe(map(r => r.data));
  }

  disableMfa(password: string): Observable<void> {
    return this.http
      .delete<ApiResponse<null>>('/api/v1/me/mfa', { body: { password } })
      .pipe(map(() => void 0));
  }

  regenBackupCodes(): Observable<{ backupCodes: string[] }> {
    return this.http
      .post<ApiResponse<{ backupCodes: string[] }>>('/api/v1/me/mfa/backup-codes', {})
      .pipe(map(r => r.data));
  }

  savePreferences(prefs: Partial<UserPreferences>): Observable<UserPreferences> {
    return this.http
      .patch<ApiResponse<UserPreferences>>('/api/v1/me/preferences', prefs)
      .pipe(
        map(r => r.data),
        tap(updated => {
          const current = this.auth.currentUser();
          if (current) this.auth.updateCurrentUser({ ...current, preferences: updated });
        }),
      );
  }
}
