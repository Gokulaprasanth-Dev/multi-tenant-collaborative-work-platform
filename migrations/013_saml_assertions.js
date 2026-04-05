exports.up = async (pgm) => {
  await pgm.db.query(`
    CREATE TABLE saml_used_assertions (
      assertion_id VARCHAR(255) NOT NULL,
      org_id UUID NOT NULL REFERENCES organizations(id),
      not_on_or_after TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (assertion_id, org_id)
    )
  `);
  await pgm.db.query(`CREATE INDEX idx_saml_expiry ON saml_used_assertions(not_on_or_after)`);

  // VideoCall domain model (C-07 fix — was missing from original)
  await pgm.db.query(`
    CREATE TABLE video_calls (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id),
      channel_id UUID REFERENCES channels(id),
      initiator_id UUID NOT NULL REFERENCES users(id),
      state VARCHAR(20) NOT NULL DEFAULT 'ringing'
        CHECK (state IN ('ringing','active','ended')),
      started_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgm.db.query(`CREATE INDEX idx_video_calls_org_id ON video_calls(org_id)`);
  await pgm.db.query(`CREATE INDEX idx_video_calls_state ON video_calls(state)`);

  await pgm.db.query(`
    CREATE TABLE task_activity_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id),
      task_id UUID NOT NULL REFERENCES tasks(id),
      actor_id UUID NOT NULL REFERENCES users(id),
      event_type VARCHAR(100) NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgm.db.query(`CREATE INDEX idx_task_activity_task_id ON task_activity_log(task_id)`);
  await pgm.db.query(`CREATE INDEX idx_task_activity_org_id ON task_activity_log(org_id)`);
};

exports.down = async (pgm) => {
  await pgm.db.query(`DROP TABLE IF EXISTS task_activity_log CASCADE`);
  await pgm.db.query(`DROP TABLE IF EXISTS video_calls CASCADE`);
  await pgm.db.query(`DROP TABLE IF EXISTS saml_used_assertions CASCADE`);
};
