exports.up = async (pgm) => {
  // Per-channel sequence creation function
  await pgm.db.query(`
    CREATE OR REPLACE FUNCTION create_channel_sequence(channel_id UUID) RETURNS VOID AS $$
    BEGIN
      EXECUTE format('CREATE SEQUENCE IF NOT EXISTS channel_seq_%s',
        replace(channel_id::text, '-', '_'));
    END;
    $$ LANGUAGE plpgsql
  `);

  // Table-level grants for app_user (audit issue 2.5 fix)
  await pgm.db.query(`GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_user`);
  await pgm.db.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user`);

  // audit_logs: explicitly revoke DELETE (belt-and-suspenders, RLS already blocks it)
  await pgm.db.query(`REVOKE DELETE ON audit_logs FROM app_user`);
  await pgm.db.query(`REVOKE UPDATE ON audit_logs FROM app_user`);

  // Tables where hard DELETE is needed by cleanup worker:
  await pgm.db.query(`GRANT DELETE ON outbox_events TO app_user`);
  await pgm.db.query(`GRANT DELETE ON idempotency_keys TO app_user`);
  await pgm.db.query(`GRANT DELETE ON saml_used_assertions TO app_user`);
  await pgm.db.query(`GRANT DELETE ON refresh_tokens TO app_user`);
};

exports.down = async (pgm) => {
  await pgm.db.query(`DROP FUNCTION IF EXISTS create_channel_sequence(UUID) CASCADE`);
};
