/**
 * Unit tests for src/modules/auth/services/oauth.service.ts
 *
 * Covers:
 * 1. Returns token pair for a brand-new user (no existing provider, no existing email)
 * 2. Returns token pair for a returning user (existing auth provider found)
 * 3. Links Google provider to existing email account (no provider, but email exists)
 * 4. Marks email as verified when linking to an unverified existing email account
 * 5. Throws INVALID_GOOGLE_TOKEN when verifyIdToken throws
 * 6. Throws INVALID_GOOGLE_TOKEN when getPayload() returns null
 */

// ── Hoist all mocks before imports ────────────────────────────────────────────

jest.mock('../../../src/shared/config', () => ({
  config: {
    encryptionKey: 'a'.repeat(64),
    jwtPrivateKey: require('crypto')
      .generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ type: 'pkcs1', format: 'pem' }),
    jwtPublicKey: '',
    jwtAccessTokenTtl: 900,
    inviteSecret: 'x'.repeat(32),
    metricsToken: 'x'.repeat(16),
  },
}));

jest.mock('../../../src/shared/redis/clients', () => ({
  redisClient: {
    set: jest.fn().mockResolvedValue('OK'),
    get: jest.fn(),
    del: jest.fn(),
  },
}));

jest.mock('../../../src/shared/observability/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

// Factory mock: google-auth-library creates `client` at module level,
// so we expose `verifyIdToken` via __googleMocks to control it per-test.
jest.mock('google-auth-library', () => {
  const verifyIdToken = jest.fn();
  return {
    OAuth2Client: jest.fn().mockImplementation(() => ({ verifyIdToken })),
    __googleMocks: { verifyIdToken },
  };
});

// Factory mock: AuthRepository is instantiated at module level as `repo`
jest.mock('../../../src/modules/auth/repositories/auth.repository', () => {
  const findAuthProvider = jest.fn();
  const findUserByEmail = jest.fn();
  const createUser = jest.fn();
  const createUserPreferences = jest.fn();
  const updateUser = jest.fn();
  const createAuthProvider = jest.fn();
  return {
    AuthRepository: jest.fn().mockImplementation(() => ({
      findAuthProvider,
      findUserByEmail,
      createUser,
      createUserPreferences,
      updateUser,
      createAuthProvider,
    })),
    __repoMocks: {
      findAuthProvider,
      findUserByEmail,
      createUser,
      createUserPreferences,
      updateUser,
      createAuthProvider,
    },
  };
});

jest.mock('../../../src/shared/database/pool', () => ({
  queryPrimary: jest.fn().mockResolvedValue({ rows: [] }),
  queryReplica: jest.fn().mockResolvedValue({ rows: [] }),
}));

jest.mock('../../../src/modules/audit/workers/audit.worker', () => ({
  persistAuditLog: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/modules/auth/services/jwt.service', () => ({
  issueTokenPair: jest.fn().mockResolvedValue({
    accessToken: 'at',
    refreshToken: 'rt',
    expiresIn: 900,
  }),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────────

import { loginWithGoogle } from '../../../src/modules/auth/services/oauth.service';

// Pull shared mock references from the factory mocks
const { __googleMocks } = jest.requireMock('google-auth-library') as {
  __googleMocks: { verifyIdToken: jest.Mock };
};

const { __repoMocks } = jest.requireMock(
  '../../../src/modules/auth/repositories/auth.repository'
) as {
  __repoMocks: {
    findAuthProvider: jest.Mock;
    findUserByEmail: jest.Mock;
    createUser: jest.Mock;
    createUserPreferences: jest.Mock;
    updateUser: jest.Mock;
    createAuthProvider: jest.Mock;
  };
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeGooglePayload(overrides: Partial<{
  sub: string;
  email: string;
  name: string;
  picture: string;
}> = {}) {
  return {
    sub: 'google-sub-123',
    email: 'test@example.com',
    name: 'Test User',
    picture: 'https://pic.example.com/photo.jpg',
    ...overrides,
  };
}

function makeUserRow(overrides: Partial<{
  id: string;
  email: string;
  email_verified: boolean;
}> = {}) {
  return {
    id: 'user-1',
    email: 'test@example.com',
    email_verified: true,
    name: 'Test User',
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('loginWithGoogle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a token pair for a brand-new user (no existing provider, no existing email)', async () => {
    const payload = makeGooglePayload();
    __googleMocks.verifyIdToken.mockResolvedValue({ getPayload: () => payload });

    __repoMocks.findAuthProvider.mockResolvedValue(null);
    __repoMocks.findUserByEmail.mockResolvedValue(null);

    const newUser = makeUserRow({ id: 'new-user-1' });
    __repoMocks.createUser.mockResolvedValue(newUser);
    __repoMocks.createUserPreferences.mockResolvedValue(undefined);
    __repoMocks.createAuthProvider.mockResolvedValue({});

    const result = await loginWithGoogle('valid-id-token');

    expect(result).toEqual({ accessToken: 'at', refreshToken: 'rt', expiresIn: 900 });
    expect(__repoMocks.createUser).toHaveBeenCalledTimes(1);
    expect(__repoMocks.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'test@example.com', email_verified: true })
    );
    expect(__repoMocks.createUserPreferences).toHaveBeenCalledWith('new-user-1');
    expect(__repoMocks.createAuthProvider).toHaveBeenCalledTimes(1);
  });

  it('returns a token pair for a returning user (existing auth provider found)', async () => {
    const payload = makeGooglePayload();
    __googleMocks.verifyIdToken.mockResolvedValue({ getPayload: () => payload });

    const existingProvider = { user_id: 'returning-user-99' };
    __repoMocks.findAuthProvider.mockResolvedValue(existingProvider);

    const result = await loginWithGoogle('valid-id-token');

    expect(result).toEqual({ accessToken: 'at', refreshToken: 'rt', expiresIn: 900 });
    // Should not attempt to create user when provider already exists
    expect(__repoMocks.findUserByEmail).not.toHaveBeenCalled();
    expect(__repoMocks.createUser).not.toHaveBeenCalled();
  });

  it('links Google provider to an existing email account when no provider found', async () => {
    const payload = makeGooglePayload();
    __googleMocks.verifyIdToken.mockResolvedValue({ getPayload: () => payload });

    __repoMocks.findAuthProvider.mockResolvedValue(null);
    const existingUser = makeUserRow({ id: 'existing-user-5', email_verified: true });
    __repoMocks.findUserByEmail.mockResolvedValue(existingUser);
    __repoMocks.createAuthProvider.mockResolvedValue({});

    const result = await loginWithGoogle('valid-id-token');

    expect(result).toEqual({ accessToken: 'at', refreshToken: 'rt', expiresIn: 900 });
    // Should NOT create a new user — only link the provider
    expect(__repoMocks.createUser).not.toHaveBeenCalled();
    expect(__repoMocks.createAuthProvider).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'google', user_id: 'existing-user-5' })
    );
  });

  it('marks email as verified when linking to an unverified existing email account', async () => {
    const payload = makeGooglePayload();
    __googleMocks.verifyIdToken.mockResolvedValue({ getPayload: () => payload });

    __repoMocks.findAuthProvider.mockResolvedValue(null);
    const unverifiedUser = makeUserRow({ id: 'unverified-user-7', email_verified: false });
    __repoMocks.findUserByEmail.mockResolvedValue(unverifiedUser);
    __repoMocks.updateUser.mockResolvedValue({ ...unverifiedUser, email_verified: true });
    __repoMocks.createAuthProvider.mockResolvedValue({});

    await loginWithGoogle('valid-id-token');

    expect(__repoMocks.updateUser).toHaveBeenCalledWith(
      'unverified-user-7',
      expect.objectContaining({ email_verified: true })
    );
  });

  it('throws INVALID_GOOGLE_TOKEN when verifyIdToken throws', async () => {
    __googleMocks.verifyIdToken.mockRejectedValue(new Error('Token signature invalid'));

    await expect(loginWithGoogle('bad-token')).rejects.toMatchObject({
      code: 'INVALID_GOOGLE_TOKEN',
    });
  });

  it('throws INVALID_GOOGLE_TOKEN when getPayload() returns null', async () => {
    __googleMocks.verifyIdToken.mockResolvedValue({ getPayload: () => null });

    await expect(loginWithGoogle('bad-token')).rejects.toMatchObject({
      code: 'INVALID_GOOGLE_TOKEN',
    });
  });
});
