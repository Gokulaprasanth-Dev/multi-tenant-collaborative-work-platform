import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { redisClient } from '../redis/clients';
import { primaryPool } from '../database/pool';
import { logger } from '../observability/logger';
import { UnauthorizedError } from '../errors/app-errors';
import { getPublicKey } from './key-store';

interface JwtPayload {
  sub: string;
  orgId: string;
  role: string;
  isPlatformAdmin?: boolean;
  jti: string;
  exp: number;
  iat?: number;
  authTime?: number;
  mfaVerifiedAt?: number;
  kid?: string;
}

interface CachedUser {
  id: string;
  status: string;
  password_changed_at: string | null;
}

const USER_CACHE_TTL = 60; // seconds

async function resolveUser(userId: string): Promise<CachedUser> {
  const cacheKey = `user:cache:${userId}`;
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return JSON.parse(cached) as CachedUser;
  } catch {
    // Redis failure — fall through to DB
  }

  const result = await primaryPool.query<CachedUser>(
    'SELECT id, status, password_changed_at FROM users WHERE id = $1',
    [userId]
  );
  if (result.rows.length === 0) throw new UnauthorizedError('USER_NOT_FOUND', 'User not found');

  const user = result.rows[0];
  try {
    await redisClient.setex(cacheKey, USER_CACHE_TTL, JSON.stringify(user));
  } catch {
    // Redis failure — proceed without caching
  }
  return user;
}

async function verifyToken(token: string): Promise<JwtPayload> {
  // Decode header first to get kid for key lookup
  const decoded = jwt.decode(token, { complete: true });
  const kid = (decoded?.header as { kid?: string })?.kid;
  const publicKey = getPublicKey(kid);

  return new Promise((resolve, reject) => {
    jwt.verify(token, publicKey, { algorithms: ['RS256'] }, (err, payload) => {
      if (err) reject(err);
      else resolve(payload as JwtPayload);
    });
  });
}

async function authenticate(req: Request): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new UnauthorizedError('MISSING_TOKEN', 'Authorization header missing or malformed');
  }

  const token = authHeader.slice(7);
  let payload: JwtPayload;
  try {
    payload = await verifyToken(token);
  } catch {
    throw new UnauthorizedError('INVALID_TOKEN', 'Token is invalid or expired');
  }

  // Check jti blacklist — fail-open on Redis failure
  try {
    const blacklisted = await redisClient.get(`blacklist:token:${payload.jti}`);
    if (blacklisted) throw new UnauthorizedError('TOKEN_BLACKLISTED', 'Token has been revoked');
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    logger.warn({ err, jti: payload.jti }, 'Redis unavailable for blacklist check — failing open');
  }

  // Resolve user (cache → DB)
  const user = await resolveUser(payload.sub);
  if (user.status === 'deleted') {
    throw new UnauthorizedError('USER_DELETED', 'User account has been deleted');
  }

  // SEC-NEW-001: Invalidate tokens issued before password change
  if (
    payload.iat !== undefined &&
    user.password_changed_at !== null &&
    user.password_changed_at !== undefined
  ) {
    const passwordChangedTs = Math.floor(new Date(user.password_changed_at).getTime() / 1000);
    if (payload.iat < passwordChangedTs) {
      throw new UnauthorizedError('SESSION_INVALIDATED', 'Session invalidated by password change');
    }
  }

  req.user = {
    userId: payload.sub,
    orgId: payload.orgId,
    role: payload.role,
    isPlatformAdmin: payload.isPlatformAdmin ?? false,
    jti: payload.jti,
    exp: payload.exp,
    authTime: payload.authTime,
    mfaVerifiedAt: payload.mfaVerifiedAt,
  };
}

export async function jwtMiddleware(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    await authenticate(req);
    next();
  } catch (err) {
    next(err);
  }
}

export async function optionalJwtMiddleware(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next();
  }
  try {
    await authenticate(req);
  } catch {
    // Optional — ignore auth failures
  }
  next();
}
