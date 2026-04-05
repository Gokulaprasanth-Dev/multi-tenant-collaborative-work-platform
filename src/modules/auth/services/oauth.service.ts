import { OAuth2Client } from 'google-auth-library';
import { AuthRepository } from '../repositories/auth.repository';
import { issueTokenPair, TokenPair } from './jwt.service';
import { persistAuditLog } from '../../audit/workers/audit.worker';
import { queryPrimary } from '../../../shared/database/pool';
import { UnauthorizedError } from '../../../shared/errors/app-errors';

const client = new OAuth2Client();
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

export async function loginWithGoogle(idToken: string): Promise<TokenPair> {
  let googleUserId: string;
  let email: string;
  let name: string;
  let pictureUrl: string | undefined;

  try {
    const ticket = await client.verifyIdToken({ idToken });
    const payload = ticket.getPayload();
    if (!payload || !payload.sub || !payload.email) {
      throw new Error('Invalid token payload');
    }
    googleUserId = payload.sub;
    email = payload.email.toLowerCase().trim();
    name = payload.name ?? email;
    pictureUrl = payload.picture;
  } catch {
    throw new UnauthorizedError('INVALID_GOOGLE_TOKEN', 'Google ID token is invalid');
  }

  // Find or create user via auth_provider lookup
  let userId: string;
  const existingProvider = await repo.findAuthProvider('google', googleUserId);

  if (existingProvider) {
    userId = existingProvider.user_id;
  } else {
    // Check if user exists by email (link provider to existing account)
    let user = await repo.findUserByEmail(email);
    if (!user) {
      user = await repo.createUser({
        email,
        name,
        avatar_url: pictureUrl ?? null,
        email_verified: true,
      });
      await repo.createUserPreferences(user.id);
    } else {
      // Mark email verified if not already
      if (!user.email_verified) {
        await repo.updateUser(user.id, { email_verified: true, email_verified_at: new Date() });
      }
    }
    userId = user.id;

    await repo.createAuthProvider({
      user_id: userId,
      provider: 'google',
      provider_user_id: googleUserId,
      metadata: { email, name, picture: pictureUrl },
    });

    await writeOutboxEvent('user.oauth_linked', userId, { provider: 'google', userId });
  }

  await persistAuditLog({
    actorId: userId,
    actorType: 'user',
    eventType: 'user.login_google',
    entityType: 'user',
    entityId: userId,
  });

  return issueTokenPair(userId, '', 'member', false);
}
