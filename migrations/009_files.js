exports.up = async (pgm) => {
  await pgm.db.query(`
    CREATE TABLE files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id),
      uploader_id UUID NOT NULL REFERENCES users(id),
      filename VARCHAR(500) NOT NULL,
      mime_type VARCHAR(255) NOT NULL,
      size_bytes BIGINT NOT NULL,
      storage_key UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
      storage_provider VARCHAR(10) NOT NULL DEFAULT 'local'
        CHECK (storage_provider IN ('local','s3')),
      status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','confirmed','quarantined','deleted')),
      scan_status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (scan_status IN ('pending','clean','infected')),
      scan_completed_at TIMESTAMPTZ,
      linked_entity_type VARCHAR(50),
      linked_entity_id UUID,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgm.db.query(`CREATE INDEX idx_files_org_id ON files(org_id)`);
  await pgm.db.query(`CREATE INDEX idx_files_uploader ON files(uploader_id)`);
  await pgm.db.query(`CREATE INDEX idx_files_status ON files(status)`);
  await pgm.db.query(`CREATE INDEX idx_files_scan_status ON files(scan_status)`);
  await pgm.db.query(`CREATE INDEX idx_files_deleted ON files(deleted_at)`);
};

exports.down = async (pgm) => { await pgm.db.query(`DROP TABLE IF EXISTS files CASCADE`); };
