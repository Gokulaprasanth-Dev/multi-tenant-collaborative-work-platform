/**
 * TASK-102 — Seed load test data.
 * Creates 100 test users + 1 test org. Writes LOADTEST_ORG_ID and LOADTEST_USER_PREFIX to .env.loadtest.
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';

const USER_COUNT = 100;
const USER_PREFIX = `loadtest-user-${Date.now()}`;
const PASSWORD = 'LoadTest123!';
const ORG_NAME = `LoadTest Org ${Date.now()}`;
const ORG_SLUG = `loadtest-org-${Date.now()}`;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  let ownerId: string;

  // Insert owner
  {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO users (id, email, name, password_hash, status, is_platform_admin, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'active', false, NOW(), NOW())
       RETURNING id`,
      [`${USER_PREFIX}-owner@loadtest.invalid`, `${USER_PREFIX}-owner`, passwordHash]
    );
    ownerId = result.rows[0]!.id;
    console.log(`Owner: ${ownerId}`);
  }

  // Insert org
  const orgResult = await pool.query<{ id: string }>(
    `INSERT INTO organizations (id, name, slug, owner_id, status, plan, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, 'active', 'pro', NOW(), NOW())
     RETURNING id`,
    [ORG_NAME, ORG_SLUG, ownerId]
  );
  const orgId = orgResult.rows[0]!.id;

  // Add owner as member
  await pool.query(
    `INSERT INTO organization_members (org_id, user_id, role, joined_at)
     VALUES ($1, $2, 'org_owner', NOW())`,
    [orgId, ownerId]
  );

  // Insert 100 users
  for (let i = 0; i < USER_COUNT; i++) {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO users (id, email, name, password_hash, status, is_platform_admin, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'active', false, NOW(), NOW())
       RETURNING id`,
      [`${USER_PREFIX}-${i}@loadtest.invalid`, `${USER_PREFIX}-${i}`, passwordHash]
    );
    const userId = result.rows[0]!.id;

    await pool.query(
      `INSERT INTO organization_members (org_id, user_id, role, joined_at)
       VALUES ($1, $2, 'member', NOW())`,
      [orgId, userId]
    );

    if (i % 10 === 0) process.stdout.write(`  ${i + 1}/${USER_COUNT} users created\r`);
  }
  console.log(`\nCreated ${USER_COUNT} users in org ${orgId}`);

  await pool.end();

  // Write .env.loadtest
  const envPath = path.join(process.cwd(), '.env.loadtest');
  fs.writeFileSync(
    envPath,
    `LOADTEST_ORG_ID=${orgId}\nLOADTEST_USER_PREFIX=${USER_PREFIX}\nLOADTEST_PASSWORD=${PASSWORD}\n`
  );
  console.log(`.env.loadtest written to ${envPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
