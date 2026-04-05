import { queryPrimary } from '../../src/shared/database/pool';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { generateAccessToken } from '../../src/modules/auth/utils/token';

export async function truncateTables(tables: string[]): Promise<void> {
  for (const table of tables) {
    await queryPrimary(`TRUNCATE TABLE ${table} CASCADE`);
  }
}

export async function seedUser(opts: {
  email?: string;
  password?: string;
  name?: string;
  isPlatformAdmin?: boolean;
} = {}): Promise<{ userId: string; email: string; password: string }> {
  const email = opts.email ?? `test-${uuidv4()}@example.com`;
  const password = opts.password ?? 'Password123!';
  const name = opts.name ?? 'Test User';
  const passwordHash = await bcrypt.hash(password, 10);

  const result = await queryPrimary<{ id: string }>(
    `INSERT INTO users (id, email, name, password_hash, status, is_platform_admin, email_verified, email_verified_at, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, 'active', $4, true, NOW(), NOW(), NOW())
     RETURNING id`,
    [email, name, passwordHash, opts.isPlatformAdmin ?? false]
  );

  return { userId: result.rows[0]!.id, email, password };
}

export async function seedOrg(opts: {
  name?: string;
  slug?: string;
  ownerId: string;
} ): Promise<{ orgId: string }> {
  const name = opts.name ?? `Test Org ${uuidv4().slice(0, 8)}`;
  const slug = opts.slug ?? `test-org-${uuidv4().slice(0, 8)}`;

  const result = await queryPrimary<{ id: string }>(
    `INSERT INTO organizations (id, name, slug, status, plan_tier, plan_started_at, max_members, storage_quota_bytes, created_at, updated_at, version)
     VALUES (gen_random_uuid(), $1, $2, 'active', 'free', NOW(), 5, 1073741824, NOW(), NOW(), 1)
     RETURNING id`,
    [name, slug]
  );

  const orgId = result.rows[0]!.id;

  // Add owner as member
  await queryPrimary(
    `INSERT INTO org_memberships (org_id, user_id, role, status, joined_at, created_at, updated_at)
     VALUES ($1, $2, 'org_owner', 'active', NOW(), NOW(), NOW())`,
    [orgId, opts.ownerId]
  );

  // Create default workspace
  await queryPrimary(
    `INSERT INTO workspaces (org_id, name, status, owner_user_id, created_at, updated_at, version)
     VALUES ($1, 'Default Workspace', 'active', $2, NOW(), NOW(), 1)`,
    [orgId, opts.ownerId]
  );

  // Create default subscription
  await queryPrimary(
    `INSERT INTO subscriptions (org_id, plan_tier, status, cancel_at_period_end, metadata, created_at, updated_at)
     VALUES ($1, 'free', 'active', false, '{}', NOW(), NOW())
     ON CONFLICT DO NOTHING`,
    [orgId]
  );

  return { orgId };
}

export async function getTestJwt(email: string, _password: string, orgId?: string): Promise<string> {
  // Look up the user
  const userResult = await queryPrimary<{ id: string; is_platform_admin: boolean }>(
    `SELECT id, is_platform_admin FROM users WHERE email = $1 LIMIT 1`,
    [email]
  );
  if (userResult.rows.length === 0) throw new Error(`getTestJwt: user not found: ${email}`);
  const user = userResult.rows[0]!;

  // Look up org membership role if orgId provided
  let role = 'org_member';
  if (orgId) {
    const memberResult = await queryPrimary<{ role: string }>(
      `SELECT role FROM org_memberships WHERE user_id = $1 AND org_id = $2 AND status = 'active' LIMIT 1`,
      [user.id, orgId]
    );
    if (memberResult.rows.length > 0) role = memberResult.rows[0]!.role;
  }

  return generateAccessToken({
    sub: user.id,
    orgId: orgId ?? '',
    role,
    isPlatformAdmin: user.is_platform_admin,
  });
}
