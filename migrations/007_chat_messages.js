exports.up = async (pgm) => {
  await pgm.db.query(`
    CREATE TABLE chat_messages (
      id UUID NOT NULL,
      org_id UUID NOT NULL,
      channel_id UUID NOT NULL REFERENCES channels(id),
      sender_id UUID NOT NULL REFERENCES users(id),
      client_message_id UUID NOT NULL,
      sequence_number BIGINT NOT NULL,
      body TEXT NOT NULL,
      body_parsed JSONB,
      parent_message_id UUID,
      is_edited BOOLEAN NOT NULL DEFAULT FALSE,
      edit_history JSONB[] NOT NULL DEFAULT '{}',
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL,
      search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('english', coalesce(body,''))
      ) STORED,
      PRIMARY KEY (id, created_at)
    ) PARTITION BY RANGE (created_at)
  `);

  // Default partition MUST exist — inserts fail without it if no matching range partition
  await pgm.db.query(`CREATE TABLE chat_messages_default PARTITION OF chat_messages DEFAULT`);
  await pgm.db.query(`CREATE INDEX idx_cm_default_ch_seq ON chat_messages_default(channel_id, sequence_number)`);
  await pgm.db.query(`CREATE INDEX idx_cm_default_ch_client ON chat_messages_default(channel_id, client_message_id)`);
  await pgm.db.query(`CREATE INDEX idx_cm_default_org ON chat_messages_default(org_id)`);
  await pgm.db.query(`CREATE INDEX idx_cm_default_del ON chat_messages_default(deleted_at)`);
  await pgm.db.query(`CREATE INDEX idx_cm_default_sv ON chat_messages_default USING GIN(search_vector)`);

  // Pre-create current month + next 3 months (4 total)
  const now = new Date();
  for (let i = 0; i <= 3; i++) {
    const start = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + i + 1, 1);
    const label = `${start.getFullYear()}_${String(start.getMonth() + 1).padStart(2, '0')}`;
    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];
    await pgm.db.query(`CREATE TABLE chat_messages_${label} PARTITION OF chat_messages FOR VALUES FROM ('${startStr}') TO ('${endStr}')`);
    await pgm.db.query(`CREATE INDEX idx_cm_${label}_ch_seq ON chat_messages_${label}(channel_id, sequence_number)`);
    await pgm.db.query(`CREATE INDEX idx_cm_${label}_ch_client ON chat_messages_${label}(channel_id, client_message_id)`);
    await pgm.db.query(`CREATE INDEX idx_cm_${label}_org ON chat_messages_${label}(org_id)`);
    await pgm.db.query(`CREATE INDEX idx_cm_${label}_del ON chat_messages_${label}(deleted_at)`);
    await pgm.db.query(`CREATE INDEX idx_cm_${label}_sv ON chat_messages_${label} USING GIN(search_vector)`);
  }
};

exports.down = async (pgm) => {
  await pgm.db.query(`DROP TABLE IF EXISTS chat_messages CASCADE`);
};
