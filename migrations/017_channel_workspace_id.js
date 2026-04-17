exports.up = async (pgm) => {
  await pgm.db.query(`
    ALTER TABLE channels
    ADD COLUMN IF NOT EXISTS workspace_id UUID
      REFERENCES workspaces(id) ON DELETE SET NULL
  `);
  await pgm.db.query(`
    CREATE INDEX IF NOT EXISTS idx_channels_workspace_id
    ON channels(workspace_id)
    WHERE workspace_id IS NOT NULL
  `);
};

exports.down = async (pgm) => {
  await pgm.db.query(`DROP INDEX IF EXISTS idx_channels_workspace_id`);
  await pgm.db.query(`ALTER TABLE channels DROP COLUMN IF EXISTS workspace_id`);
};
