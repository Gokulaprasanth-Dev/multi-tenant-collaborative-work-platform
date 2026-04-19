// frontend/src/app/core/services/user.service.spec.ts
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { UserService } from './user.service';
import { AuthService } from './auth.service';
import { User, UserDto, MfaStatus, Session, defaultPreferences } from '../models/user.model';

const BASE_USER: User = {
  id: 'u-1', email: 'a@b.com', name: 'Alice', bio: null, avatarUrl: null,
  emailVerified: true, mfaEnabled: false, role: 'member',
  preferences: defaultPreferences(), createdAt: '2024-01-01T00:00:00.000Z',
};

const BASE_DTO: UserDto = {
  id: 'u-1', email: 'a@b.com', name: 'Alice', bio: null, avatar_url: null,
  email_verified: true, mfa_enabled: false, role: 'member',
  preferences: defaultPreferences(), created_at: '2024-01-01T00:00:00.000Z',
};

describe('UserService', () => {
  let service: UserService;
  let ctrl: HttpTestingController;
  let auth: { updateCurrentUser: jest.Mock; currentUser: () => User | null };

  beforeEach(() => {
    auth = { updateCurrentUser: jest.fn(), currentUser: jest.fn().mockReturnValue(BASE_USER) };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: auth },
      ],
    });
    service = TestBed.inject(UserService);
    ctrl    = TestBed.inject(HttpTestingController);
  });

  afterEach(() => ctrl.verify());

  it('updateProfile() PATCHes /api/v1/me and calls updateCurrentUser', fakeAsync(() => {
    service.updateProfile('Bob', 'Hello').subscribe();
    const req = ctrl.expectOne('/api/v1/me');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ name: 'Bob', bio: 'Hello' });
    req.flush({ data: { ...BASE_DTO, name: 'Bob', bio: 'Hello' }, error: null, meta: {} });
    tick();
    expect(auth.updateCurrentUser).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Bob', bio: 'Hello' }),
    );
  }));

  it('uploadAvatar() POSTs FormData to /api/v1/me/avatar', fakeAsync(() => {
    const file = new File(['x'], 'avatar.png', { type: 'image/png' });
    service.uploadAvatar(file).subscribe();
    const req = ctrl.expectOne('/api/v1/me/avatar');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toBeInstanceOf(FormData);
    req.flush({ data: { ...BASE_DTO, avatar_url: 'https://cdn/av.png' }, error: null, meta: {} });
    tick();
    expect(auth.updateCurrentUser).toHaveBeenCalledWith(
      expect.objectContaining({ avatarUrl: 'https://cdn/av.png' }),
    );
  }));

  it('changePassword() PATCHes /api/v1/me/password', fakeAsync(() => {
    let done = false;
    service.changePassword('old', 'new123').subscribe(() => (done = true));
    const req = ctrl.expectOne('/api/v1/me/password');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ currentPassword: 'old', newPassword: 'new123' });
    req.flush({ data: null, error: null, meta: {} });
    tick();
    expect(done).toBe(true);
  }));

  it('getSessions() GETs /api/v1/me/sessions and returns Session[]', fakeAsync(() => {
    const SESSION: Session = { id: 's-1', deviceInfo: 'Chrome', ipAddress: '1.2.3.4', lastActive: '2024-01-01T00:00:00.000Z', isCurrent: true };
    let result: Session[] = [];
    service.getSessions().subscribe(s => (result = s));
    ctrl.expectOne('/api/v1/me/sessions').flush({ data: [SESSION], error: null, meta: {} });
    tick();
    expect(result.length).toBe(1);
    expect(result[0].isCurrent).toBe(true);
  }));

  it('revokeSession() DELETEs /api/v1/me/sessions/:id', fakeAsync(() => {
    let done = false;
    service.revokeSession('s-1').subscribe(() => (done = true));
    const req = ctrl.expectOne('/api/v1/me/sessions/s-1');
    expect(req.request.method).toBe('DELETE');
    req.flush({ data: null, error: null, meta: {} });
    tick();
    expect(done).toBe(true);
  }));

  it('getMfaStatus() GETs /api/v1/me/mfa', fakeAsync(() => {
    const STATUS: MfaStatus = { enabled: false, backupCodesRemaining: 0 };
    let result: MfaStatus | null = null;
    service.getMfaStatus().subscribe(s => (result = s));
    ctrl.expectOne('/api/v1/me/mfa').flush({ data: STATUS, error: null, meta: {} });
    tick();
    expect(result).toEqual(STATUS);
  }));

  it('setupMfa() POSTs /api/v1/me/mfa/setup', fakeAsync(() => {
    let result: { qrCodeUrl: string; secret: string } | undefined;
    service.setupMfa().subscribe(r => (result = r));
    ctrl.expectOne('/api/v1/me/mfa/setup').flush({ data: { qrCodeUrl: 'otpauth://...', secret: 'ABC' }, error: null, meta: {} });
    tick();
    expect(result!.secret).toBe('ABC');
  }));

  it('confirmMfa() POSTs /api/v1/me/mfa/confirm with code', fakeAsync(() => {
    let codes: string[] = [];
    service.confirmMfa('123456').subscribe(r => (codes = r.backupCodes));
    const req = ctrl.expectOne('/api/v1/me/mfa/confirm');
    expect(req.request.body).toEqual({ code: '123456' });
    req.flush({ data: { backupCodes: ['aaa', 'bbb'] }, error: null, meta: {} });
    tick();
    expect(codes).toEqual(['aaa', 'bbb']);
  }));

  it('disableMfa() DELETEs /api/v1/me/mfa with password in body', fakeAsync(() => {
    let done = false;
    service.disableMfa('mypassword').subscribe(() => (done = true));
    const req = ctrl.expectOne('/api/v1/me/mfa');
    expect(req.request.method).toBe('DELETE');
    expect(req.request.body).toEqual({ password: 'mypassword' });
    req.flush({ data: null, error: null, meta: {} });
    tick();
    expect(done).toBe(true);
  }));

  it('regenBackupCodes() POSTs /api/v1/me/mfa/backup-codes', fakeAsync(() => {
    let codes: string[] = [];
    service.regenBackupCodes().subscribe(r => (codes = r.backupCodes));
    ctrl.expectOne('/api/v1/me/mfa/backup-codes')
      .flush({ data: { backupCodes: ['x1', 'x2'] }, error: null, meta: {} });
    tick();
    expect(codes).toEqual(['x1', 'x2']);
  }));

  it('savePreferences() PATCHes /api/v1/me/preferences and updates user signal', fakeAsync(() => {
    service.savePreferences({ theme: 'light' }).subscribe();
    const req = ctrl.expectOne('/api/v1/me/preferences');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ theme: 'light' });
    req.flush({ data: { ...defaultPreferences(), theme: 'light' }, error: null, meta: {} });
    tick();
    expect(auth.updateCurrentUser).toHaveBeenCalledWith(
      expect.objectContaining({ preferences: expect.objectContaining({ theme: 'light' }) }),
    );
  }));
});
