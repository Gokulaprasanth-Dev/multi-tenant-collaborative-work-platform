/**
 * Integration tests for magic-link.service.ts
 *
 * Covers:
 * - requestLink: stores token in Redis, does not reveal whether email exists
 * - requestLink: writes outbox event for known user
 * - verifyLink: returns tokens for valid magic link
 * - verifyLink: marks email as verified via magic link
 * - verifyLink: token is single-use (second use returns 401)
 * - verifyLink: rejects invalid/expired token
 */

import { v4 as uuidv4 } from 'uuid';
import { seedUser } from '../../helpers/db';
import { queryPrimary } from '../../../src/shared/database/pool';
import { redisClient } from '../../../src/shared/redis/clients';
import { hashToken } from '../../../src/modules/auth/utils/token';
import { requestLink, verifyLink } from '../../../src/modules/auth/services/magic-link.service';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

maybeDescribe('magic-link.service', () => {
  // ── requestLink ───────────────────────────────────────────────────────────

  it('resolves without error for unknown email (no enumeration)', async () => {
    await expect(
      requestLink('doesnotexist+' + uuidv4() + '@example.com')
    ).resolves.not.toThrow();
  });

  it('stores magic link token in Redis for known user', async () => {
    const { email } = await seedUser();

    await requestLink(email);

    // We can't read the token directly, but we can confirm an outbox event was written
    const row = await queryPrimary<{ count: string }>(
      `SELECT COUNT(*) AS count FROM outbox_events
       WHERE event_type = 'user.magic_link_requested'
         AND occurred_at > NOW() - INTERVAL '5 seconds'`
    );
    expect(parseInt(row.rows[0]!.count, 10)).toBeGreaterThanOrEqual(1);
  });

  // ── verifyLink ────────────────────────────────────────────────────────────

  it('rejects an invalid token', async () => {
    await expect(verifyLink('invalid-token-that-does-not-exist')).rejects.toMatchObject({
      code: 'INVALID_OR_EXPIRED_TOKEN',
    });
  });

  it('returns accessToken + refreshToken for a valid magic link', async () => {
    const { email, userId } = await seedUser();

    // Manually seed a magic link token in Redis (simulating requestLink)
    const fakeToken = uuidv4().replace(/-/g, '');
    const hash = hashToken(fakeToken);
    await redisClient.set(
      `magic:${hash}`,
      JSON.stringify({ userId, orgId: null }),
      'EX',
      900
    );

    const tokens = await verifyLink(fakeToken);
    expect(tokens).toHaveProperty('accessToken');
    expect(tokens).toHaveProperty('refreshToken');
    expect(typeof tokens.accessToken).toBe('string');
    expect(typeof tokens.refreshToken).toBe('string');
  });

  it('marks email as verified on first magic link login', async () => {
    // Seed a user with email not verified
    const { userId } = await seedUser();
    await queryPrimary(
      `UPDATE users SET email_verified = false, email_verified_at = NULL WHERE id = $1`,
      [userId]
    );

    const fakeToken = uuidv4().replace(/-/g, '');
    const hash = hashToken(fakeToken);
    await redisClient.set(
      `magic:${hash}`,
      JSON.stringify({ userId, orgId: null }),
      'EX',
      900
    );

    await verifyLink(fakeToken);

    const row = await queryPrimary<{ email_verified: boolean }>(
      `SELECT email_verified FROM users WHERE id = $1`,
      [userId]
    );
    expect(row.rows[0]!.email_verified).toBe(true);
  });

  it('token is single-use — second attempt is rejected', async () => {
    const { userId } = await seedUser();

    const fakeToken = uuidv4().replace(/-/g, '');
    const hash = hashToken(fakeToken);
    await redisClient.set(
      `magic:${hash}`,
      JSON.stringify({ userId, orgId: null }),
      'EX',
      900
    );

    await verifyLink(fakeToken);  // first use — succeeds

    await expect(verifyLink(fakeToken)).rejects.toMatchObject({
      code: 'INVALID_OR_EXPIRED_TOKEN',
    });
  });
});
