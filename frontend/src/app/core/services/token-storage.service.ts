// frontend/src/app/core/services/token-storage.service.ts
import { Injectable } from '@angular/core';

const ACCESS_KEY  = 'platform_access_token';
const REFRESH_KEY = 'platform_refresh_token';

@Injectable({ providedIn: 'root' })
export class TokenStorageService {
  getAccessToken(): string | null  { return localStorage.getItem(ACCESS_KEY); }
  setAccessToken(token: string): void { localStorage.setItem(ACCESS_KEY, token); }

  getRefreshToken(): string | null { return localStorage.getItem(REFRESH_KEY); }
  setRefreshToken(token: string): void { localStorage.setItem(REFRESH_KEY, token); }

  clear(): void {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  }
}
