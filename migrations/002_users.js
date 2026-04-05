exports.up = async (pgm) => {
  await pgm.db.query(`
    CREATE TABLE users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) NOT NULL,
      email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      email_verified_at TIMESTAMPTZ,
      password_hash VARCHAR(255),
      name VARCHAR(255) NOT NULL,
      avatar_url TEXT,
      phone VARCHAR(30),
      totp_secret TEXT,
      totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      mfa_backup_codes TEXT[] NOT NULL DEFAULT '{}',
      mfa_backup_codes_generated_at TIMESTAMPTZ,
      is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE,
      status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
      failed_login_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TIMESTAMPTZ,
      last_login_at TIMESTAMPTZ,
      password_changed_at TIMESTAMPTZ,
      consent_tos_version VARCHAR(20),
      consent_tos_at TIMESTAMPTZ,
      privacy_policy_version VARCHAR(20),
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgm.db.query(`CREATE UNIQUE INDEX idx_users_email ON users(email) WHERE deleted_at IS NULL`);
  await pgm.db.query(`CREATE INDEX idx_users_status ON users(status)`);
  await pgm.db.query(`CREATE INDEX idx_users_deleted_at ON users(deleted_at)`);
  await pgm.db.query(`CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at()`);

  await pgm.db.query(`
    CREATE TABLE auth_providers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider VARCHAR(20) NOT NULL CHECK (provider IN ('email','google','saml','magic_link')),
      provider_user_id VARCHAR(255) NOT NULL,
      org_id UUID,
      metadata JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgm.db.query(`CREATE UNIQUE INDEX idx_auth_providers_unique ON auth_providers(provider, provider_user_id)`);
  await pgm.db.query(`CREATE INDEX idx_auth_providers_user_id ON auth_providers(user_id)`);

  await pgm.db.query(`
    CREATE TABLE user_preferences (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
      locale VARCHAR(16) NOT NULL DEFAULT 'en-US',
      theme VARCHAR(20) NOT NULL DEFAULT 'system',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgm.db.query(`CREATE TRIGGER trg_user_preferences_updated_at BEFORE UPDATE ON user_preferences FOR EACH ROW EXECUTE FUNCTION set_updated_at()`);

  // last_access_token_jti: stores jti of most recent access token issued for this refresh token
  // Required by token family revocation to blacklist in-flight access tokens (audit issue 3.3 fix)
  await pgm.db.query(`
    CREATE TABLE refresh_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      org_id UUID,
      token_hash VARCHAR(255) NOT NULL UNIQUE,
      family_id UUID NOT NULL,
      last_access_token_jti VARCHAR(255),
      is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
      revoked_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgm.db.query(`CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id)`);
  await pgm.db.query(`CREATE INDEX idx_refresh_tokens_family_id ON refresh_tokens(family_id)`);
  await pgm.db.query(`CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at)`);
};

exports.down = async (pgm) => {
  await pgm.db.query(`DROP TABLE IF EXISTS refresh_tokens CASCADE`);
  await pgm.db.query(`DROP TABLE IF EXISTS user_preferences CASCADE`);
  await pgm.db.query(`DROP TABLE IF EXISTS auth_providers CASCADE`);
  await pgm.db.query(`DROP TABLE IF EXISTS users CASCADE`);
};
