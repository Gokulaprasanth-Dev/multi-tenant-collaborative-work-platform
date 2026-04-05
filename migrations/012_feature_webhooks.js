exports.up = async (pgm) => {
  await pgm.db.query(`
    CREATE TABLE feature_flags (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      key VARCHAR(100) NOT NULL UNIQUE,
      description TEXT,
      is_globally_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      rollout_percentage INTEGER NOT NULL DEFAULT 0 CHECK (rollout_percentage >= 0 AND rollout_percentage <= 100),
      enabled_org_ids UUID[] NOT NULL DEFAULT '{}',
      disabled_org_ids UUID[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT chk_enabled_org_ids_len CHECK (array_length(enabled_org_ids, 1) IS NULL OR array_length(enabled_org_ids, 1) < 10000),
      CONSTRAINT chk_disabled_org_ids_len CHECK (array_length(disabled_org_ids, 1) IS NULL OR array_length(disabled_org_ids, 1) < 10000)
    )
  `);
  await pgm.db.query(`CREATE INDEX idx_ff_enabled_orgs ON feature_flags USING GIN(enabled_org_ids)`);
  await pgm.db.query(`CREATE TRIGGER trg_feature_flags_updated_at BEFORE UPDATE ON feature_flags FOR EACH ROW EXECUTE FUNCTION set_updated_at()`);

  await pgm.db.query(`
    CREATE TABLE webhook_subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id),
      url TEXT NOT NULL,
      secret_hash TEXT NOT NULL,
      secret_encrypted TEXT NOT NULL,
      secret_key_version INTEGER NOT NULL DEFAULT 1,
      secret_preview VARCHAR(8) NOT NULL,
      event_types TEXT[] NOT NULL DEFAULT '{}',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by UUID NOT NULL REFERENCES users(id),
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgm.db.query(`CREATE INDEX idx_webhooks_org_id ON webhook_subscriptions(org_id)`);
  await pgm.db.query(`CREATE TRIGGER trg_webhook_subs_updated_at BEFORE UPDATE ON webhook_subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at()`);

  await pgm.db.query(`
    CREATE TABLE webhook_delivery_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      webhook_id UUID NOT NULL REFERENCES webhook_subscriptions(id),
      org_id UUID NOT NULL REFERENCES organizations(id),
      event_id UUID NOT NULL,
      event_type VARCHAR(150) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','delivered','failed','exhausted')),
      attempt_count INTEGER NOT NULL DEFAULT 0,
      response_status_code INTEGER,
      response_body TEXT,
      error_message TEXT,
      delivered_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(webhook_id, event_id)
    )
  `);
  await pgm.db.query(`CREATE TRIGGER trg_webhook_del_log_updated_at BEFORE UPDATE ON webhook_delivery_log FOR EACH ROW EXECUTE FUNCTION set_updated_at()`);
};

exports.down = async (pgm) => {
  await pgm.db.query(`DROP TABLE IF EXISTS webhook_delivery_log CASCADE`);
  await pgm.db.query(`DROP TABLE IF EXISTS webhook_subscriptions CASCADE`);
  await pgm.db.query(`DROP TABLE IF EXISTS feature_flags CASCADE`);
};
