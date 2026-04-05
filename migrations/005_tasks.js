exports.up = async (pgm) => {
  await pgm.db.query(`
    CREATE TABLE tasks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id),
      workspace_id UUID NOT NULL REFERENCES workspaces(id),
      board_id UUID REFERENCES boards(id),
      parent_task_id UUID REFERENCES tasks(id),
      depth INTEGER NOT NULL DEFAULT 0 CHECK (depth >= 0 AND depth <= 2),
      title VARCHAR(500) NOT NULL,
      description JSONB,
      status VARCHAR(20) NOT NULL DEFAULT 'todo'
        CHECK (status IN ('todo','in_progress','in_review','done','cancelled')),
      priority VARCHAR(10) NOT NULL DEFAULT 'medium'
        CHECK (priority IN ('low','medium','high','urgent')),
      creator_id UUID NOT NULL REFERENCES users(id),
      due_date TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
      recurrence_rule TEXT,
      recurrence_parent_id UUID REFERENCES tasks(id),
      template_id UUID,
      labels TEXT[] NOT NULL DEFAULT '{}',
      attachments_count INTEGER NOT NULL DEFAULT 0,
      search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('english',
          coalesce(title,'') || ' ' ||
          jsonb_to_search_text(coalesce(description,'{}'::jsonb))
        )
      ) STORED,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      version INTEGER NOT NULL DEFAULT 1
    )
  `);
  await pgm.db.query(`CREATE INDEX idx_tasks_org_id ON tasks(org_id)`);
  await pgm.db.query(`CREATE INDEX idx_tasks_workspace_id ON tasks(workspace_id)`);
  await pgm.db.query(`CREATE INDEX idx_tasks_board_id ON tasks(board_id)`);
  await pgm.db.query(`CREATE INDEX idx_tasks_parent_task_id ON tasks(parent_task_id)`);
  await pgm.db.query(`CREATE INDEX idx_tasks_due_date ON tasks(due_date)`);
  await pgm.db.query(`CREATE INDEX idx_tasks_deleted_at ON tasks(deleted_at)`);
  await pgm.db.query(`CREATE INDEX idx_tasks_created_at ON tasks(created_at)`);
  await pgm.db.query(`CREATE INDEX idx_tasks_labels ON tasks USING GIN(labels)`);
  await pgm.db.query(`CREATE INDEX idx_tasks_search_vector ON tasks USING GIN(search_vector)`);

  // CRITICAL (COMPLETENESS-007 fix): Recurring task dedup index — MUST be partial
  // IMMUTABLE wrapper needed because TIMESTAMPTZ::date depends on timezone GUC
  await pgm.db.query(`
    CREATE OR REPLACE FUNCTION timestamptz_to_date_utc(ts TIMESTAMPTZ)
    RETURNS DATE LANGUAGE sql IMMUTABLE STRICT AS $$
      SELECT (ts AT TIME ZONE 'UTC')::date
    $$
  `);
  await pgm.db.query(`
    CREATE UNIQUE INDEX idx_tasks_recurrence_dedup
      ON tasks(recurrence_parent_id, timestamptz_to_date_utc(due_date))
      WHERE recurrence_parent_id IS NOT NULL AND deleted_at IS NULL
  `);
  await pgm.db.query(`CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at()`);

  await pgm.db.query(`
    CREATE TABLE task_assignees (
      task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id),
      org_id UUID NOT NULL REFERENCES organizations(id),
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      assigned_by UUID NOT NULL REFERENCES users(id),
      PRIMARY KEY (task_id, user_id)
    )
  `);
  await pgm.db.query(`CREATE INDEX idx_task_assignees_org_id ON task_assignees(org_id)`);
  await pgm.db.query(`CREATE INDEX idx_task_assignees_user_id ON task_assignees(user_id)`);

  await pgm.db.query(`
    CREATE TABLE task_dependencies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id),
      blocking_task_id UUID NOT NULL REFERENCES tasks(id),
      blocked_task_id UUID NOT NULL REFERENCES tasks(id),
      created_by UUID NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (blocking_task_id != blocked_task_id)
    )
  `);
  await pgm.db.query(`CREATE INDEX idx_task_deps_blocking ON task_dependencies(blocking_task_id)`);
  await pgm.db.query(`CREATE INDEX idx_task_deps_blocked ON task_dependencies(blocked_task_id)`);

  await pgm.db.query(`
    CREATE TABLE task_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id),
      name VARCHAR(255) NOT NULL,
      default_title VARCHAR(500),
      default_description JSONB,
      default_priority VARCHAR(10) CHECK (default_priority IN ('low','medium','high','urgent')),
      default_labels TEXT[] NOT NULL DEFAULT '{}',
      created_by UUID NOT NULL REFERENCES users(id),
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgm.db.query(`CREATE INDEX idx_task_templates_org_id ON task_templates(org_id)`);

  await pgm.db.query(`
    CREATE TABLE comments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id),
      task_id UUID NOT NULL REFERENCES tasks(id),
      author_id UUID NOT NULL REFERENCES users(id),
      parent_comment_id UUID REFERENCES comments(id),
      body JSONB NOT NULL,
      is_edited BOOLEAN NOT NULL DEFAULT FALSE,
      edited_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgm.db.query(`CREATE INDEX idx_comments_org_id ON comments(org_id)`);
  await pgm.db.query(`CREATE INDEX idx_comments_task_id ON comments(task_id)`);
  await pgm.db.query(`CREATE TRIGGER trg_comments_updated_at BEFORE UPDATE ON comments FOR EACH ROW EXECUTE FUNCTION set_updated_at()`);
};

exports.down = async (pgm) => {
  await pgm.db.query(`DROP TABLE IF EXISTS comments CASCADE`);
  await pgm.db.query(`DROP TABLE IF EXISTS task_templates CASCADE`);
  await pgm.db.query(`DROP TABLE IF EXISTS task_dependencies CASCADE`);
  await pgm.db.query(`DROP TABLE IF EXISTS task_assignees CASCADE`);
  await pgm.db.query(`DROP TABLE IF EXISTS tasks CASCADE`);
  await pgm.db.query(`DROP FUNCTION IF EXISTS timestamptz_to_date_utc(TIMESTAMPTZ)`);
};
