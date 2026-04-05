/**
 * Unit tests for src/modules/auth/services/saml.service.ts
 *
 * Covers:
 * 1. Happy-path SAML callback returns token pair
 * 2. Throws FEATURE_NOT_ENABLED when SSO feature flag is disabled
 * 3. Throws SAML_NOT_CONFIGURED when org has no SAML config
 * 4. Throws SAML_ASSERTION_REPLAYED when assertion already used
 * 5. Throws SAML_VALIDATION_FAILED when SAML response is invalid
 * 6. Creates a new user when no user found by email
 * 7. Reuses an existing user found by email
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
    set: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
    hget: jest.fn().mockResolvedValue(null),
    hset: jest.fn(),
    hdel: jest.fn(),
    publish: jest.fn(),
    pipeline: jest.fn().mockReturnValue({
      hset: jest.fn(),
      exec: jest.fn().mockResolvedValue([]),
    }),
  },
  redisPubSubClient: {
    subscribe: jest.fn(),
    on: jest.fn(),
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

// Factory mock: passport-saml creates `saml` at call time (not module level),
// but we expose validatePostResponseAsync so we can control it per-test.
jest.mock('passport-saml', () => {
  const validatePostResponseAsync = jest.fn();
  return {
    SAML: jest.fn().mockImplementation(() => ({ validatePostResponseAsync })),
    __samlMocks: { validatePostResponseAsync },
  };
});

jest.mock('../../../src/shared/database/pool', () => ({
  queryPrimary: jest.fn(),
  queryReplica: jest.fn(),
}));

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

jest.mock('../../../src/modules/feature-flag/feature-flag.service', () => ({
  isEnabled: jest.fn(),
}));

jest.mock('../../../src/modules/auth/services/jwt.service', () => ({
  issueTokenPair: jest.fn().mockResolvedValue({
    accessToken: 'at',
    refreshToken: 'rt',
    expiresIn: 900,
  }),
}));

jest.mock('../../../src/modules/audit/workers/audit.worker', () => ({
  persistAuditLog: jest.fn().mockResolvedValue(undefined),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────────

import { handleCallback } from '../../../src/modules/auth/services/saml.service';
import { isEnabled } from '../../../src/modules/feature-flag/feature-flag.service';
import { queryPrimary, queryReplica } from '../../../src/shared/database/pool';

// ── Pull shared mock references ────────────────────────────────────────────────

const { __samlMocks } = jest.requireMock('passport-saml') as {
  __samlMocks: { validatePostResponseAsync: jest.Mock };
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

const mockIsEnabled = isEnabled as jest.Mock;
const mockQueryPrimary = queryPrimary as jest.Mock;
const mockQueryReplica = queryReplica as jest.Mock;

// ── Constants shared across tests ─────────────────────────────────────────────

const ORG_ID = 'org-saml-1';
const SAML_RESPONSE = 'base64-encoded-saml-response';

const VALID_ORG_CONFIG = {
  saml_enabled: true,
  saml_metadata_url: JSON.stringify({
    entryPoint: 'https://idp.example.com/sso',
    issuer: 'test-issuer',
    cert: 'MIIC...',
  }),
};

const VALID_PROFILE = {
  ID: 'assertion-uuid-1',
  email: 'user@example.com',
  displayName: 'Test User',
};

function makeUserRow(overrides: Partial<{
  id: string;
  email: string;
  email_verified: boolean;
}> = {}) {
  return {
    id: 'user-saml-1',
    email: 'user@example.com',
    email_verified: true,
    name: 'Test User',
    ...overrides,
  };
}

/**
 * Sets up a "fully passing" happy-path scenario with an existing auth provider.
 * - queryReplica: 1st call returns org config, 2nd call returns membership row
 * - queryPrimary: 1st call returns no existing assertion (replay check), 2nd is INSERT
 */
function setupHappyPath(userId = 'user-saml-1'): void {
  mockIsEnabled.mockResolvedValue(true);

  // queryReplica is called twice:
  //   1st: getOrgSamlConfig — SELECT from organizations
  //   2nd: membership check — SELECT role FROM org_memberships
  mockQueryReplica
    .mockResolvedValueOnce({ rows: [VALID_ORG_CONFIG] })
    .mockResolvedValueOnce({ rows: [{ role: 'member' }] });

  // queryPrimary is called twice:
  //   1st: replay presence check — SELECT 1 FROM saml_used_assertions (empty = not replayed)
  //   2nd: INSERT INTO saml_used_assertions
  mockQueryPrimary
    .mockResolvedValueOnce({ rows: [] })        // no existing assertion
    .mockResolvedValueOnce({ rows: [] });        // INSERT

  __samlMocks.validatePostResponseAsync.mockResolvedValue({
    profile: VALID_PROFILE,
  });

  __repoMocks.findAuthProvider.mockResolvedValue({ user_id: userId });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('handleCallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Test 1: happy path ───────────────────────────────────────────────────────

  it('returns a token pair on a successful SAML callback (happy path)', async () => {
    setupHappyPath();

    const result = await handleCallback(ORG_ID, SAML_RESPONSE);

    expect(result).toEqual({ accessToken: 'at', refreshToken: 'rt', expiresIn: 900 });
    expect(mockIsEnabled).toHaveBeenCalledWith(ORG_ID, 'feature.sso');
    expect(__samlMocks.validatePostResponseAsync).toHaveBeenCalledWith({
      SAMLResponse: SAML_RESPONSE,
    });
  });

  // ── Test 2: SSO feature flag disabled ────────────────────────────────────────

  it('throws FEATURE_NOT_ENABLED when SSO feature flag is disabled', async () => {
    mockIsEnabled.mockResolvedValue(false);

    await expect(handleCallback(ORG_ID, SAML_RESPONSE)).rejects.toMatchObject({
      code: 'FEATURE_NOT_ENABLED',
      statusCode: 403,
    });

    // Should short-circuit before querying org config
    expect(mockQueryReplica).not.toHaveBeenCalled();
  });

  // ── Test 3: SAML not configured for org ──────────────────────────────────────

  it('throws SAML_NOT_CONFIGURED when org has no SAML config', async () => {
    mockIsEnabled.mockResolvedValue(true);
    // org row not found
    mockQueryReplica.mockResolvedValueOnce({ rows: [] });

    await expect(handleCallback(ORG_ID, SAML_RESPONSE)).rejects.toMatchObject({
      code: 'SAML_NOT_CONFIGURED',
      statusCode: 401,
    });
  });

  it('throws SAML_NOT_CONFIGURED when org row has saml_enabled = false', async () => {
    mockIsEnabled.mockResolvedValue(true);
    mockQueryReplica.mockResolvedValueOnce({
      rows: [{ saml_enabled: false, saml_metadata_url: '{}' }],
    });

    await expect(handleCallback(ORG_ID, SAML_RESPONSE)).rejects.toMatchObject({
      code: 'SAML_NOT_CONFIGURED',
    });
  });

  // ── Test 4: assertion replay ──────────────────────────────────────────────────

  it('throws SAML_ASSERTION_REPLAYED when assertion ID was already used', async () => {
    mockIsEnabled.mockResolvedValue(true);
    mockQueryReplica.mockResolvedValueOnce({ rows: [VALID_ORG_CONFIG] });

    __samlMocks.validatePostResponseAsync.mockResolvedValue({
      profile: VALID_PROFILE,
    });

    // Replay check SELECT returns an existing row
    mockQueryPrimary.mockResolvedValueOnce({ rows: [{ 1: 1 }] });

    await expect(handleCallback(ORG_ID, SAML_RESPONSE)).rejects.toMatchObject({
      code: 'SAML_ASSERTION_REPLAYED',
      statusCode: 401,
    });
  });

  // ── Test 5: SAML validation failure ──────────────────────────────────────────

  it('throws SAML_VALIDATION_FAILED when passport-saml rejects the response', async () => {
    mockIsEnabled.mockResolvedValue(true);
    mockQueryReplica.mockResolvedValueOnce({ rows: [VALID_ORG_CONFIG] });

    __samlMocks.validatePostResponseAsync.mockRejectedValue(
      new Error('Signature verification failed')
    );

    await expect(handleCallback(ORG_ID, SAML_RESPONSE)).rejects.toMatchObject({
      code: 'SAML_VALIDATION_FAILED',
      statusCode: 401,
    });
  });

  // ── Test 6: creates a new user when not found by email ───────────────────────

  it('creates a new user when no existing user is found by email', async () => {
    mockIsEnabled.mockResolvedValue(true);
    mockQueryReplica
      .mockResolvedValueOnce({ rows: [VALID_ORG_CONFIG] })    // org config
      .mockResolvedValueOnce({ rows: [{ role: 'member' }] }); // membership

    mockQueryPrimary
      .mockResolvedValueOnce({ rows: [] })   // no replay
      .mockResolvedValueOnce({ rows: [] });  // INSERT assertion

    __samlMocks.validatePostResponseAsync.mockResolvedValue({
      profile: VALID_PROFILE,
    });

    // No existing provider — forces findUserByEmail path
    __repoMocks.findAuthProvider.mockResolvedValue(null);
    __repoMocks.findUserByEmail.mockResolvedValue(null);

    const createdUser = makeUserRow({ id: 'brand-new-user' });
    __repoMocks.createUser.mockResolvedValue(createdUser);
    __repoMocks.createUserPreferences.mockResolvedValue(undefined);
    __repoMocks.createAuthProvider.mockResolvedValue({});

    const result = await handleCallback(ORG_ID, SAML_RESPONSE);

    expect(result).toEqual({ accessToken: 'at', refreshToken: 'rt', expiresIn: 900 });
    expect(__repoMocks.createUser).toHaveBeenCalledTimes(1);
    expect(__repoMocks.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'user@example.com', email_verified: true })
    );
    expect(__repoMocks.createUserPreferences).toHaveBeenCalledWith('brand-new-user');
    expect(__repoMocks.createAuthProvider).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'saml', user_id: 'brand-new-user' })
    );
  });

  // ── Test 7: reuses existing user found by email ───────────────────────────────

  it('reuses an existing user found by email without creating a new one', async () => {
    mockIsEnabled.mockResolvedValue(true);
    mockQueryReplica
      .mockResolvedValueOnce({ rows: [VALID_ORG_CONFIG] })
      .mockResolvedValueOnce({ rows: [{ role: 'admin' }] });

    mockQueryPrimary
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    __samlMocks.validatePostResponseAsync.mockResolvedValue({
      profile: VALID_PROFILE,
    });

    __repoMocks.findAuthProvider.mockResolvedValue(null);
    const existingUser = makeUserRow({ id: 'existing-saml-user', email_verified: true });
    __repoMocks.findUserByEmail.mockResolvedValue(existingUser);
    __repoMocks.createAuthProvider.mockResolvedValue({});

    const result = await handleCallback(ORG_ID, SAML_RESPONSE);

    expect(result).toEqual({ accessToken: 'at', refreshToken: 'rt', expiresIn: 900 });
    // Should NOT create a new user
    expect(__repoMocks.createUser).not.toHaveBeenCalled();
    expect(__repoMocks.createUserPreferences).not.toHaveBeenCalled();
    // Should still create the auth provider linking to the existing user
    expect(__repoMocks.createAuthProvider).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'saml', user_id: 'existing-saml-user' })
    );
  });
});
