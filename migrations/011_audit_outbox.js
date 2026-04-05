exports.up = async (pgm) => {
  await pgm.db.query(`
    CREATE TABLE audit_logs (
      id UUID NOT NULL DEFAULT gen_random_uuid(),
      org_id UUID,
      actor_id UUID,
      actor_type VARCHAR(20) NOT NULL CHECK (actor_type IN ('user','system','platform_admin')),
      event_type VARCHAR(150) NOT NULL,
      entity_type VARCHAR(50),
      entity_id UUID,
      ip_address INET,
      user_agent TEXT,
      payload JSONB NOT NULL DEFAULT '{}',
      correlation_id UUID,
      occurred_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (id, occurred_at)
    ) PARTITION BY RANGE (occurred_at)
  `);

  // Default partition — MUST exist
  await pgm.db.query(`CREATE TABLE audit_logs_default PARTITION OF audit_logs DEFAULT`);
  await pgm.db.query(`CREATE INDEX idx_al_default_org ON audit_logs_default(org_id)`);
  await pgm.db.query(`CREATE INDEX idx_al_default_occurred ON audit_logs_default(occurred_at)`);
  await pgm.db.query(`CREATE INDEX idx_al_default_actor ON audit_logs_default(actor_id)`);
  await pgm.db.query(`CREATE INDEX idx_al_default_event ON audit_logs_default(event_type)`);

  // Pre-create 12 months of partitions
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const start = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + i + 1, 1);
    const label = `${start.getFullYear()}_${String(start.getMonth() + 1).padStart(2, '0')}`;
    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];
    await pgm.db.query(`CREATE TABLE audit_logs_${label} PARTITION OF audit_logs FOR VALUES FROM ('${startStr}') TO ('${endStr}')`);
    await pgm.db.query(`CREATE INDEX idx_al_${label}_org ON audit_logs_${label}(org_id)`);
    await pgm.db.query(`CREATE INDEX idx_al_${label}_occurred ON audit_logs_${label}(occurred_at)`);
    await pgm.db.query(`CREATE INDEX idx_al_${label}_actor ON audit_logs_${label}(actor_id)`);
    await pgm.db.query(`CREATE INDEX idx_al_${label}_event ON audit_logs_${label}(event_type)`);
  }

  // CRITICAL (COMPLETENESS-005 fix): RLS — audit_logs is INSERT-only for app_user
  await pgm.db.query(`ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY`);
  await pgm.db.query(`
    CREATE POLICY audit_insert_only ON audit_logs
      FOR INSERT TO app_user WITH CHECK (true)
  `);
  await pgm.db.query(`REVOKE UPDATE ON audit_logs FROM app_user`);
  await pgm.db.query(`REVOKE DELETE ON audit_logs FROM app_user`);

  await pgm.db.query(`
    CREATE TABLE outbox_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID,
      event_type VARCHAR(150) NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      entity_type VARCHAR(50),
      entity_id UUID,
      actor_user_id UUID,
      correlation_id UUID,
      payload JSONB NOT NULL DEFAULT '{}',
      status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','published','failed')),
      occurred_at TIMESTAMPTZ NOT NULL,
      published_at TIMESTAMPTZ,
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgm.db.query(`CREATE INDEX idx_outbox_status_created ON outbox_events(status, created_at)`);
  await pgm.db.query(`CREATE INDEX idx_outbox_entity_id ON outbox_events(entity_id)`);
};

exports.down = async (pgm) => {
  await pgm.db.query(`DROP TABLE IF EXISTS outbox_events CASCADE`);
  await pgm.db.query(`DROP TABLE IF EXISTS audit_logs CASCADE`);
};
