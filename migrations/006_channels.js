exports.up = async (pgm) => {
  await pgm.db.query(`
    CREATE TABLE channels (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id),
      type VARCHAR(10) NOT NULL CHECK (type IN ('direct','group')),
      name VARCHAR(255),
      created_by UUID NOT NULL REFERENCES users(id),
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgm.db.query(`CREATE INDEX idx_channels_org_id ON channels(org_id)`);
  await pgm.db.query(`CREATE INDEX idx_channels_deleted_at ON channels(deleted_at)`);
  await pgm.db.query(`CREATE TRIGGER trg_channels_updated_at BEFORE UPDATE ON channels FOR EACH ROW EXECUTE FUNCTION set_updated_at()`);

  await pgm.db.query(`
    CREATE TABLE channel_members (
      channel_id UUID NOT NULL REFERENCES channels(id),
      user_id UUID NOT NULL REFERENCES users(id),
      org_id UUID NOT NULL REFERENCES organizations(id),
      last_read_sequence BIGINT NOT NULL DEFAULT 0,
      last_read_at TIMESTAMPTZ,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      removed_at TIMESTAMPTZ,
      PRIMARY KEY (channel_id, user_id)
    )
  `);
  await pgm.db.query(`CREATE INDEX idx_channel_members_org_id ON channel_members(org_id)`);
  await pgm.db.query(`CREATE INDEX idx_channel_members_user_id ON channel_members(user_id)`);

  // CRITICAL (COMPLETENESS-008 fix): Enforce one direct channel per user pair per org
  await pgm.db.query(`
    CREATE TABLE direct_channel_pairs (
      org_id UUID NOT NULL REFERENCES organizations(id),
      user_a_id UUID NOT NULL REFERENCES users(id),
      user_b_id UUID NOT NULL REFERENCES users(id),
      channel_id UUID NOT NULL UNIQUE REFERENCES channels(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (org_id, user_a_id, user_b_id),
      CHECK (user_a_id < user_b_id)
    )
  `);
  await pgm.db.query(`CREATE INDEX idx_dcp_org ON direct_channel_pairs(org_id)`);
};

exports.down = async (pgm) => {
  await pgm.db.query(`DROP TABLE IF EXISTS direct_channel_pairs CASCADE`);
  await pgm.db.query(`DROP TABLE IF EXISTS channel_members CASCADE`);
  await pgm.db.query(`DROP TABLE IF EXISTS channels CASCADE`);
};
