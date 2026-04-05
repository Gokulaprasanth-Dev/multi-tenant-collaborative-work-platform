import { AuthRepository, UserRow } from '../repositories/auth.repository';
import { hashPassword, verifyPassword } from '../utils/password';
import { generateEmailVerificationToken, generatePasswordResetToken, hashToken } from '../utils/token';
import { issueTokenPair, refreshTokenPair, revokeTokens, TokenPair } from './jwt.service';
import { persistAuditLog } from '../../audit/workers/audit.worker';
import { queryPrimary, queryReplica } from '../../../shared/database/pool';
import { redisClient } from '../../../shared/redis/clients';
import { ConflictError, ForbiddenError, UnauthorizedError } from '../../../shared/errors/app-errors';

const repo = new AuthRepository();

const LOCK_DURATION_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_LOCKOUT_ATTEMPTS = 5;

export interface SafeUser {
  id: string;
  email: string;
  email_verified: boolean;
  name: string;
  avatar_url: string | null;
  is_platform_admin: boolean;
  status: string;
  created_at: Date;
  updated_at: Date;
}

function sanitizeUser(user: UserRow): SafeUser {
  return {
    id: user.id,
    email: user.email,
    email_verified: user.email_verified,
    name: user.name,
    avatar_url: user.avatar_url,
    is_platform_admin: user.is_platform_admin,
    status: user.status,
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

async function writeOutboxEvent(
  eventType: string,
  entityType: string,
  entityId: string,
  actorUserId: string | null,
  payload: Record<string, unknown>
): Promise<void> {
  await queryPrimary(
    `INSERT INTO outbox_events (event_type, entity_type, entity_id, actor_user_id, payload, occurred_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, NOW())`,
    [eventType, entityType, entityId, actorUserId, JSON.stringify(payload)]
  );
}

export async function register(
  email: string,
  password: string,
  name: string
): Promise<SafeUser> {
  const normalizedEmail = email.toLowerCase().trim();

  // Check duplicate — unique index enforces this but check early for clean 409
  const existing = await repo.findUserByEmail(normalizedEmail);
  if (existing) {
    throw new ConflictError('EMAIL_ALREADY_EXISTS', 'An account with this email already exists');
  }

  const passwordHash = await hashPassword(password);

  const user = await repo.createUser({
    email: normalizedEmail,
    name,
    password_hash: passwordHash,
    email_verified: false,
  });

  await repo.createUserPreferences(user.id);

  await repo.createAuthProvider({
    user_id: user.id,
    provider: 'email',
    provider_user_id: normalizedEmail,
  });

  const { hash: tokenHash, expiresAt } = generateEmailVerificationToken();

  await writeOutboxEvent(
    'user.email_verification_requested',
    'user',
    user.id,
    user.id,
    { userId: user.id, email: normalizedEmail, tokenHash, expiresAt }
  );

  await redisClient.set(`email_verify:${tokenHash}`, user.id, 'EX', 86400);

  await persistAuditLog({
    actorType: 'system',
    eventType: 'user.registered',
    entityType: 'user',
    entityId: user.id,
  });

  return sanitizeUser(user);
}

export interface LoginResult {
  tokens: TokenPair;
  user: SafeUser;
}

export async function login(
  email: string,
  password: string,
  orgId?: string
): Promise<LoginResult> {
  const normalizedEmail = email.toLowerCase().trim();

  // Not found → generic 401 (no enumeration)
  const user = await repo.findUserByEmail(normalizedEmail);
  if (!user) {
    throw new UnauthorizedError('INVALID_CREDENTIALS', 'Invalid email or password');
  }

  if (!user.email_verified) {
    throw new ForbiddenError('EMAIL_NOT_VERIFIED', 'Email address has not been verified');
  }

  if (user.locked_until && user.locked_until > new Date()) {
    throw new ForbiddenError('ACCOUNT_LOCKED', 'Account is temporarily locked due to too many failed login attempts');
  }

  const passwordValid = user.password_hash
    ? await verifyPassword(password, user.password_hash)
    : false;

  if (!passwordValid) {
    // Determine lockout threshold — org-specific if orgId provided
    let lockoutAttempts = DEFAULT_LOCKOUT_ATTEMPTS;
    if (orgId) {
      const orgResult = await queryReplica(
        `SELECT account_lockout_attempts FROM organizations WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [orgId]
      );
      if (orgResult.rows.length > 0) {
        lockoutAttempts = (orgResult.rows[0] as { account_lockout_attempts: number }).account_lockout_attempts;
      }
    }

    const newCount = user.failed_login_attempts + 1;
    await repo.incrementFailedLoginAttempts(user.id);

    if (newCount >= lockoutAttempts) {
      const lockUntil = new Date(Date.now() + LOCK_DURATION_MS);
      await repo.lockUser(user.id, lockUntil);
      throw new ForbiddenError('ACCOUNT_LOCKED', 'Account is locked due to too many failed login attempts');
    }

    throw new UnauthorizedError('INVALID_CREDENTIALS', 'Invalid email or password');
  }

  // Successful auth — reset counters and update last login
  await repo.resetFailedLoginAttempts(user.id);
  await repo.updateUser(user.id, { last_login_at: new Date() });

  // Verify org membership and resolve role if orgId provided
  let role = 'member';
  if (orgId) {
    const memberResult = await queryReplica(
      `SELECT role FROM org_memberships WHERE user_id = $1 AND org_id = $2 AND status = 'active' LIMIT 1`,
      [user.id, orgId]
    );
    if (memberResult.rows.length === 0) {
      throw new ForbiddenError('NOT_ORG_MEMBER', 'User is not an active member of this organization');
    }
    role = (memberResult.rows[0] as { role: string }).role;
  }

  const tokens = await issueTokenPair(
    user.id,
    orgId ?? '',
    role,
    user.is_platform_admin
  );

  // Security-critical: audit log written synchronously before response
  await persistAuditLog({
    orgId: orgId ?? undefined,
    actorId: user.id,
    actorType: 'user',
    eventType: 'user.login',
    entityType: 'user',
    entityId: user.id,
  });

  return { tokens, user: sanitizeUser(user) };
}

export async function verifyEmail(token: string): Promise<void> {
  const hash = hashToken(token);
  const key = `email_verify:${hash}`;

  const userId = await redisClient.get(key);
  if (!userId) {
    throw new UnauthorizedError('INVALID_OR_EXPIRED_TOKEN', 'Email verification token is invalid or has expired');
  }

  await repo.updateUser(userId, {
    email_verified: true,
    email_verified_at: new Date(),
  });

  // One-time use: delete immediately after use
  await redisClient.del(key);

  await persistAuditLog({
    actorId: userId,
    actorType: 'user',
    eventType: 'user.email_verified',
    entityType: 'user',
    entityId: userId,
  });
}

/** Returns the user only if they exist and email is still unverified — used by resend route. */
export async function findUserByEmailForResend(email: string): Promise<{ id: string } | null> {
  const user = await repo.findUserByEmail(email.toLowerCase().trim());
  if (!user || user.email_verified) return null;
  return { id: user.id };
}

export async function resendVerificationEmail(userId: string): Promise<void> {
  const { hash: tokenHash, expiresAt } = generateEmailVerificationToken();

  await redisClient.set(`email_verify:${tokenHash}`, userId, 'EX', 86400);

  await writeOutboxEvent(
    'user.email_verification_requested',
    'user',
    userId,
    userId,
    { userId, tokenHash, expiresAt }
  );
}

// ─── TASK-039 additions ────────────────────────────────────────────────────

export async function requestPasswordReset(email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  const user = await repo.findUserByEmail(normalizedEmail);

  // Always succeed — no enumeration
  if (!user) return;

  const { hash: tokenHash, expiresAt } = generatePasswordResetToken();

  await redisClient.set(`pwd_reset:${tokenHash}`, user.id, 'EX', 3600);

  await writeOutboxEvent(
    'user.password_reset_requested',
    'user',
    user.id,
    user.id,
    { userId: user.id, email: normalizedEmail, tokenHash, expiresAt }
  );
}

export async function confirmPasswordReset(token: string, newPassword: string): Promise<void> {
  const hash = hashToken(token);
  const key = `pwd_reset:${hash}`;

  const userId = await redisClient.get(key);
  if (!userId) {
    throw new UnauthorizedError('INVALID_OR_EXPIRED_TOKEN', 'Password reset token is invalid or has expired');
  }

  const passwordHash = await hashPassword(newPassword);

  await repo.updateUser(userId, {
    password_hash: passwordHash,
    password_changed_at: new Date(),
  });

  // SEC-NEW-001 fix — CRITICAL: evict user cache so JWT middleware sees updated password_changed_at immediately
  await redisClient.del(`user:cache:${userId}`);

  await repo.revokeAllUserTokens(userId);

  await redisClient.del(key);

  await persistAuditLog({
    actorId: userId,
    actorType: 'user',
    eventType: 'user.password_reset',
    entityType: 'user',
    entityId: userId,
  });
}

export async function logout(
  rawRefreshToken: string,
  accessTokenJti: string,
  remainingTtl: number
): Promise<void> {
  await revokeTokens(rawRefreshToken, accessTokenJti, remainingTtl);
}

export { refreshTokenPair };
