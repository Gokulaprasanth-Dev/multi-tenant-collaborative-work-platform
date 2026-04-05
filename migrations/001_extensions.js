exports.up = async (pgm) => {
  await pgm.db.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
  await pgm.db.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
  await pgm.db.query(`CREATE EXTENSION IF NOT EXISTS "pg_trgm"`);

  // Shared updated_at trigger — applied to all mutable tables in their respective migrations
  await pgm.db.query(`
    CREATE OR REPLACE FUNCTION set_updated_at()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
    BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$
  `);

  // ProseMirror recursive text extractor with depth limit (BUG-NEW-001 fix)
  // Depth limit of 20 prevents runaway recursion on malformed documents
  await pgm.db.query(`
    CREATE OR REPLACE FUNCTION jsonb_to_search_text(j JSONB) RETURNS TEXT
    LANGUAGE sql IMMUTABLE AS $$
      WITH RECURSIVE nodes(node, depth) AS (
        SELECT j, 0
        UNION ALL
        SELECT child.val, nodes.depth + 1
        FROM nodes,
             LATERAL (
               SELECT elem AS val
               FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(nodes.node) = 'array' THEN nodes.node ELSE '[]'::jsonb END
               ) AS elem
               UNION ALL
               SELECT kv.val AS val
               FROM jsonb_each(
                 CASE WHEN jsonb_typeof(nodes.node) = 'object' THEN nodes.node ELSE '{}'::jsonb END
               ) AS kv(k, val)
             ) AS child(val)
        WHERE nodes.depth < 20
      )
      SELECT coalesce(
        string_agg(node #>> '{}', ' ') FILTER (WHERE jsonb_typeof(node) = 'string'), ''
      )
      FROM nodes
    $$
  `);
};

exports.down = async (pgm) => {
  await pgm.db.query(`DROP FUNCTION IF EXISTS jsonb_to_search_text(JSONB) CASCADE`);
  await pgm.db.query(`DROP FUNCTION IF EXISTS set_updated_at() CASCADE`);
};
