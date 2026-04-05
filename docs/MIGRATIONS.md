# Migration Procedure (Expand-Contract Pattern)

This project uses `node-pg-migrate` for database migrations. All migrations are in the `migrations/` directory.

## Expand-Contract Pattern

For zero-downtime schema changes, always follow the expand-contract pattern:

### Phase 1: Expand (non-breaking)
- Add new columns as nullable (no DEFAULT required)
- Add new tables, indexes, or constraints
- Add new enum values
- Do NOT rename or drop existing columns/tables

```javascript
// migrations/XXX_add_new_column.js
exports.up = (pgm) => {
  pgm.addColumn('users', {
    new_field: { type: 'text', notNull: false }, // nullable first
  });
};
```

### Phase 2: Migrate data (backfill)
- Backfill new columns with data from old columns
- Run as a separate migration, not mixed with DDL

```javascript
exports.up = (pgm) => {
  pgm.sql(`UPDATE users SET new_field = old_field WHERE new_field IS NULL`);
};
```

### Phase 3: Constrain (tighten)
- After all application code uses the new column, add NOT NULL constraint
- Add CHECK constraints, unique constraints, etc.

```javascript
exports.up = (pgm) => {
  pgm.alterColumn('users', 'new_field', { notNull: true });
};
```

### Phase 4: Contract (remove old)
- Only after the new column is fully adopted and old column is no longer read/written
- Drop the old column

```javascript
exports.up = (pgm) => {
  pgm.dropColumn('users', 'old_field');
};
```

## Running Migrations

```bash
# Apply all pending migrations
npm run migrate:up

# Roll back last migration
npm run migrate:down

# Apply to a specific test database
TEST_DATABASE_URL=postgresql://... npm run migrate:test
```

## Migration File Conventions

- Files are JS (not TS) to avoid transpilation requirements at deployment time
- Format: `NNN_description.js` (e.g., `001_initial_schema.js`)
- Always implement both `exports.up` and `exports.down`
- `exports.down` should be a complete reversal of `exports.up`

## Index Creation (Production)

For large tables, create indexes concurrently to avoid locking:

```javascript
exports.up = (pgm) => {
  pgm.sql(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_org_id ON tasks(org_id)`);
};
exports.down = (pgm) => {
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS idx_tasks_org_id`);
};
```

Note: `CREATE INDEX CONCURRENTLY` cannot run inside a transaction. `node-pg-migrate` runs each migration in a transaction by default. To disable: set `exports.shorthands = { ... }; exports.up.disableTransaction = true;`.

## Audit Log Partition Cleanup

**Never use `DELETE FROM audit_logs`**. Drop monthly partitions instead:

```sql
-- Safe (O(1)):
DROP TABLE IF EXISTS audit_logs_2024_01;

-- WRONG (O(n), scans default partition):
-- DELETE FROM audit_logs WHERE occurred_at < '2024-02-01';
```

The cleanup worker handles partition dropping automatically based on org retention settings.
