// frontend/src/app/core/services/token-storage.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { TokenStorageService } from './token-storage.service';

describe('TokenStorageService', () => {
  let service: TokenStorageService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TokenStorageService);
    localStorage.clear();
  });

  it('returns null when no access token stored', () => {
    expect(service.getAccessToken()).toBeNull();
  });

  it('stores and retrieves access token', () => {
    service.setAccessToken('tok-abc');
    expect(service.getAccessToken()).toBe('tok-abc');
  });

  it('stores and retrieves refresh token', () => {
    service.setRefreshToken('ref-xyz');
    expect(service.getRefreshToken()).toBe('ref-xyz');
  });

  it('clear() removes both tokens', () => {
    service.setAccessToken('tok-abc');
    service.setRefreshToken('ref-xyz');
    service.clear();
    expect(service.getAccessToken()).toBeNull();
    expect(service.getRefreshToken()).toBeNull();
  });
});
