/**
 * Regression tests for SEC-NEW-001: token invalidation after password change
 *
 * The JWT middleware rejects access tokens whose iat (issued-at) timestamp
 * is earlier than the user's password_changed_at timestamp.
 *
 * This ensures that tokens issued before a password reset cannot be reused.
 */

import request from 'supertest';
import { app } from '../../../src/app';
import { seedUser, seedOrg } from '../../helpers/db';
import { queryPrimary } from '../../../src/shared/database/pool';
import { redisClient } from '../../../src/shared/redis/clients';
import { generateAccessToken } from '../../../src/modules/auth/utils/token';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

maybeDescribe('SEC-NEW-001: token invalidation after password change', () => {
  it('rejects an access token issued before password_changed_at', async () => {
    const { userId } = await seedUser();
    const { orgId } = await seedOrg({ ownerId: userId });

    // Step 1: Generate access token (iat = Math.floor(Date.now() / 1000))
    const token = generateAccessToken({ sub: userId, orgId, role: 'org_owner', isPlatformAdmin: false });

    // Step 2: Set password_changed_at to a time after the token's iat
    // Using NOW() + 2 seconds guarantees it's strictly after the token iat
    await queryPrimary(
      `UPDATE users SET password_changed_at = NOW() + INTERVAL '2 seconds' WHERE id = $1`,
      [userId]
    );

    // Step 3: Evict user cache so JWT middleware reads fresh password_changed_at
    await redisClient.del(`user:cache:${userId}`);

    // Step 4: Use the old token — should be rejected
    const res = await request(app)
      .get(`/api/v1/orgs/${orgId}/tasks`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-ID', orgId);

    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe('SESSION_INVALIDATED');
  });

  it('allows a token issued AFTER password_changed_at', async () => {
    const { userId } = await seedUser();
    const { orgId } = await seedOrg({ ownerId: userId });

    // Step 1: Set password_changed_at to 60 seconds ago
    await queryPrimary(
      `UPDATE users SET password_changed_at = NOW() - INTERVAL '60 seconds' WHERE id = $1`,
      [userId]
    );

    // Step 2: Evict cache
    await redisClient.del(`user:cache:${userId}`);

    // Step 3: Generate token now (iat > password_changed_at)
    const token = generateAccessToken({ sub: userId, orgId, role: 'org_owner', isPlatformAdmin: false });

    // Step 4: Use the token — should be allowed
    const res = await request(app)
      .get(`/api/v1/orgs/${orgId}/tasks`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-ID', orgId);

    expect(res.status).toBe(200);
  });

  it('allows a token when user has no password_changed_at (never reset)', async () => {
    const { userId } = await seedUser();
    const { orgId } = await seedOrg({ ownerId: userId });

    // Ensure password_changed_at is NULL
    await queryPrimary(
      `UPDATE users SET password_changed_at = NULL WHERE id = $1`,
      [userId]
    );
    await redisClient.del(`user:cache:${userId}`);

    const token = generateAccessToken({ sub: userId, orgId, role: 'org_owner', isPlatformAdmin: false });

    const res = await request(app)
      .get(`/api/v1/orgs/${orgId}/tasks`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-ID', orgId);

    expect(res.status).toBe(200);
  });
});
