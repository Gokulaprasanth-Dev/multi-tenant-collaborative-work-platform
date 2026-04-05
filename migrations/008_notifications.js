exports.up = async (pgm) => {
  await pgm.db.query(`
    CREATE TABLE notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id),
      user_id UUID NOT NULL REFERENCES users(id),
      type VARCHAR(100) NOT NULL,
      entity_type VARCHAR(50) NOT NULL,
      entity_id UUID NOT NULL,
      actor_id UUID REFERENCES users(id),
      payload JSONB NOT NULL DEFAULT '{}',
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgm.db.query(`CREATE INDEX idx_notifications_user_read ON notifications(org_id, user_id, is_read, created_at DESC)`);
  await pgm.db.query(`CREATE INDEX idx_notifications_entity_id ON notifications(entity_id)`);

  await pgm.db.query(`
    CREATE TABLE notification_preferences (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id),
      user_id UUID NOT NULL REFERENCES users(id),
      event_type VARCHAR(100) NOT NULL,
      channel_inapp BOOLEAN NOT NULL DEFAULT TRUE,
      channel_email BOOLEAN NOT NULL DEFAULT TRUE,
      channel_push BOOLEAN NOT NULL DEFAULT FALSE,
      digest_mode VARCHAR(20) NOT NULL DEFAULT 'realtime'
        CHECK (digest_mode IN ('realtime','daily_digest')),
      quiet_hours_start TIME,
      quiet_hours_end TIME,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgm.db.query(`CREATE UNIQUE INDEX idx_notif_prefs_unique ON notification_preferences(org_id, user_id, event_type)`);
  await pgm.db.query(`CREATE INDEX idx_notif_prefs_user ON notification_preferences(org_id, user_id)`);
  await pgm.db.query(`CREATE TRIGGER trg_notification_preferences_updated_at BEFORE UPDATE ON notification_preferences FOR EACH ROW EXECUTE FUNCTION set_updated_at()`);
};

exports.down = async (pgm) => {
  await pgm.db.query(`DROP TABLE IF EXISTS notification_preferences CASCADE`);
  await pgm.db.query(`DROP TABLE IF EXISTS notifications CASCADE`);
};
