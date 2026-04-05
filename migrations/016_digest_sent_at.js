exports.up = async (pgm) => {
  // Add digest_sent_at to notifications table (used by daily digest worker TASK-110)
  await pgm.db.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS digest_sent_at TIMESTAMPTZ`);
  await pgm.db.query(`CREATE INDEX IF NOT EXISTS idx_notifications_digest_sent ON notifications(user_id, digest_sent_at) WHERE digest_sent_at IS NULL`);
};

exports.down = async (pgm) => {
  await pgm.db.query(`DROP INDEX IF EXISTS idx_notifications_digest_sent`);
  await pgm.db.query(`ALTER TABLE notifications DROP COLUMN IF EXISTS digest_sent_at`);
};
