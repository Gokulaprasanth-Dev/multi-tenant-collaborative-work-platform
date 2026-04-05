exports.up = async (pgm) => {
  // Add missing last_seen_at column to users table (used by Socket.IO presence tracking)
  await pgm.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ`);
  await pgm.db.query(`CREATE INDEX IF NOT EXISTS idx_users_last_seen_at ON users(last_seen_at)`);
};

exports.down = async (pgm) => {
  await pgm.db.query(`ALTER TABLE users DROP COLUMN IF EXISTS last_seen_at`);
};
