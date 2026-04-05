import { AuthRepository } from '../repositories/auth.repository';
import { generateMagicLinkToken, hashToken } from '../utils/token';
import { issueTokenPair, TokenPair } from './jwt.service';
import { queryPrimary } from '../../../shared/database/pool';
import { redisClient } from '../../../shared/redis/clients';
import { UnauthorizedError } from '../../../shared/errors/app-errors';

const repo = new AuthRepository();

async function writeOutboxEvent(
  eventType: string,
  entityId: string,
  payload: Record<string, unknown>
): Promise<void> {
  await queryPrimary(
    `INSERT INTO outbox_events (event_type, entity_type, entity_id, actor_user_id, payload, occurred_at)
     VALUES ($1, 'user', $2, $3, $4::jsonb, NOW())`,
    [eventType, entityId, entityId, JSON.stringify(payload)]
  );
}

export async function requestLink(email: string, orgId?: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  const user = await repo.findUserByEmail(normalizedEmail);

  // Always succeed — no enumeration
  if (!user) return;

  const { hash: tokenHash, expiresAt } = generateMagicLinkToken();

  await redisClient.set(
    `magic:${tokenHash}`,
    JSON.stringify({ userId: user.id, orgId: orgId ?? null }),
    'EX',
    900
  );

  await writeOutboxEvent(
    'user.magic_link_requested',
    user.id,
    { userId: user.id, email: normalizedEmail, tokenHash, expiresAt, orgId: orgId ?? null }
  );
}

export async function verifyLink(token: string): Promise<TokenPair> {
  const hash = hashToken(token);
  const key = `magic:${hash}`;

  const raw = await redisClient.get(key);
  if (!raw) {
    throw new UnauthorizedError('INVALID_OR_EXPIRED_TOKEN', 'Magic link token is invalid or has expired');
  }

  const { userId, orgId } = JSON.parse(raw) as { userId: string; orgId: string | null };

  // One-time use: delete immediately
  await redisClient.del(key);

  const user = await repo.findUserById(userId);
  if (!user) {
    throw new UnauthorizedError('USER_NOT_FOUND', 'User not found');
  }

  // Mark email verified via magic link
  if (!user.email_verified) {
    await repo.updateUser(userId, { email_verified: true, email_verified_at: new Date() });
  }

  return issueTokenPair(userId, orgId ?? '', 'member', user.is_platform_admin);
}
