exports.up = async (pgm) => {
  await pgm.db.query(`
    CREATE TABLE organizations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(100) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','offboarding','deleted')),
      plan_tier VARCHAR(20) NOT NULL DEFAULT 'free' CHECK (plan_tier IN ('free','pro','business','enterprise')),
      plan_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      plan_expires_at TIMESTAMPTZ,
      grace_period_ends_at TIMESTAMPTZ,
      offboarding_started_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ,
      max_members INTEGER NOT NULL DEFAULT 5,
      storage_quota_bytes BIGINT NOT NULL DEFAULT 1073741824,
      storage_used_bytes BIGINT NOT NULL DEFAULT 0,
      saml_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      saml_metadata_url TEXT,
      mfa_required BOOLEAN NOT NULL DEFAULT FALSE,
      account_lockout_attempts INTEGER NOT NULL DEFAULT 5,
      retention_audit_days INTEGER NOT NULL DEFAULT 365 CHECK (retention_audit_days >= 365),
      retention_chat_days INTEGER,
      timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
      locale VARCHAR(16) NOT NULL DEFAULT 'en-US',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      version INTEGER NOT NULL DEFAULT 1
    )
  `);
  await pgm.db.query(`CREATE UNIQUE INDEX idx_organizations_slug ON organizations(slug)`);
  await pgm.db.query(`CREATE INDEX idx_organizations_status ON organizations(status)`);
  await pgm.db.query(`CREATE INDEX idx_organizations_deleted_at ON organizations(deleted_at)`);
  await pgm.db.query(`CREATE TRIGGER trg_organizations_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION set_updated_at()`);

  await pgm.db.query(`
    CREATE TABLE org_memberships (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id),
      user_id UUID NOT NULL REFERENCES users(id),
      role VARCHAR(20) NOT NULL CHECK (role IN ('org_owner','org_admin','member','guest')),
      status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','removed')),
      invited_by UUID REFERENCES users(id),
      joined_at TIMESTAMPTZ,
      removed_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // CRITICAL: Partial unique index (NOT table-level UNIQUE) to allow re-adding removed users
  await pgm.db.query(`
    CREATE UNIQUE INDEX idx_memberships_org_user_active
      ON org_memberships(org_id, user_id) WHERE deleted_at IS NULL
  `);
  await pgm.db.query(`CREATE INDEX idx_memberships_org_id ON org_memberships(org_id)`);
  await pgm.db.query(`CREATE INDEX idx_memberships_user_id ON org_memberships(user_id)`);
  await pgm.db.query(`CREATE TRIGGER trg_org_memberships_updated_at BEFORE UPDATE ON org_memberships FOR EACH ROW EXECUTE FUNCTION set_updated_at()`);

  await pgm.db.query(`
    CREATE TABLE invitations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id),
      invited_by UUID NOT NULL REFERENCES users(id),
      email VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL CHECK (role IN ('org_admin','member','guest')),
      token_hash VARCHAR(255) NOT NULL UNIQUE,
      status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','expired','revoked')),
      expires_at TIMESTAMPTZ NOT NULL,
      accepted_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgm.db.query(`CREATE INDEX idx_invitations_org_id ON invitations(org_id)`);
  await pgm.db.query(`CREATE INDEX idx_invitations_email ON invitations(email)`);
  await pgm.db.query(`CREATE INDEX idx_invitations_status ON invitations(status)`);
};

exports.down = async (pgm) => {
  await pgm.db.query(`DROP TABLE IF EXISTS invitations CASCADE`);
  await pgm.db.query(`DROP TABLE IF EXISTS org_memberships CASCADE`);
  await pgm.db.query(`DROP TABLE IF EXISTS organizations CASCADE`);
};
