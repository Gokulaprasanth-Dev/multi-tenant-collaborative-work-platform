exports.up = async (pgm) => {
  await pgm.db.query(`
    CREATE TABLE workspaces (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id),
      name VARCHAR(255) NOT NULL,
      description TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
      owner_user_id UUID NOT NULL REFERENCES users(id),
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      version INTEGER NOT NULL DEFAULT 1
    )
  `);
  await pgm.db.query(`CREATE INDEX idx_workspaces_org_id ON workspaces(org_id)`);
  await pgm.db.query(`CREATE INDEX idx_workspaces_deleted_at ON workspaces(deleted_at)`);
  await pgm.db.query(`CREATE TRIGGER trg_workspaces_updated_at BEFORE UPDATE ON workspaces FOR EACH ROW EXECUTE FUNCTION set_updated_at()`);

  await pgm.db.query(`
    CREATE TABLE boards (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id),
      workspace_id UUID NOT NULL REFERENCES workspaces(id),
      name VARCHAR(255) NOT NULL,
      type VARCHAR(10) NOT NULL CHECK (type IN ('board','sprint')),
      status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','archived')),
      start_date DATE,
      end_date DATE,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      version INTEGER NOT NULL DEFAULT 1
    )
  `);
  await pgm.db.query(`CREATE INDEX idx_boards_org_id ON boards(org_id)`);
  await pgm.db.query(`CREATE INDEX idx_boards_workspace_id ON boards(workspace_id)`);
  await pgm.db.query(`CREATE TRIGGER trg_boards_updated_at BEFORE UPDATE ON boards FOR EACH ROW EXECUTE FUNCTION set_updated_at()`);
};

exports.down = async (pgm) => {
  await pgm.db.query(`DROP TABLE IF EXISTS boards CASCADE`);
  await pgm.db.query(`DROP TABLE IF EXISTS workspaces CASCADE`);
};
