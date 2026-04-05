import { QueryResult } from 'pg';
import { queryPrimary, queryReplica } from '../../../shared/database/pool';

export interface UserRow {
  id: string;
  email: string;
  email_verified: boolean;
  email_verified_at: Date | null;
  password_hash: string | null;
  name: string;
  avatar_url: string | null;
  phone: string | null;
  totp_secret: string | null;
  totp_enabled: boolean;
  mfa_backup_codes: string[];
  mfa_backup_codes_generated_at: Date | null;
  is_platform_admin: boolean;
  status: 'active' | 'suspended' | 'deleted';
  failed_login_attempts: number;
  locked_until: Date | null;
  last_login_at: Date | null;
  password_changed_at: Date | null;
  consent_tos_version: string | null;
  consent_tos_at: Date | null;
  privacy_policy_version: string | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateUserData {
  email: string;
  name: string;
  password_hash?: string | null;
  email_verified?: boolean;
  avatar_url?: string | null;
}

export interface UpdateUserData {
  email?: string;
  name?: string;
  password_hash?: string | null;
  email_verified?: boolean;
  email_verified_at?: Date | null;
  avatar_url?: string | null;
  totp_secret?: string | null;
  totp_enabled?: boolean;
  mfa_backup_codes?: string[];
  mfa_backup_codes_generated_at?: Date | null;
  status?: 'active' | 'suspended' | 'deleted';
  last_login_at?: Date | null;
  password_changed_at?: Date | null;
  consent_tos_version?: string | null;
  consent_tos_at?: Date | null;
  privacy_policy_version?: string | null;
  deleted_at?: Date | null;
  locked_until?: Date | null;
  failed_login_attempts?: number;
}

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  org_id: string | null;
  token_hash: string;
  family_id: string;
  last_access_token_jti: string | null;
  is_revoked: boolean;
  revoked_at: Date | null;
  expires_at: Date;
  created_at: Date;
}

export interface CreateRefreshTokenData {
  user_id: string;
  org_id?: string | null;
  token_hash: string;
  family_id: string;
  last_access_token_jti?: string | null;
  expires_at: Date;
}

export interface AuthProviderRow {
  id: string;
  user_id: string;
  provider: 'email' | 'google' | 'saml' | 'magic_link';
  provider_user_id: string;
  org_id: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export interface CreateAuthProviderData {
  user_id: string;
  provider: 'email' | 'google' | 'saml' | 'magic_link';
  provider_user_id: string;
  org_id?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UserPreferencesRow {
  user_id: string;
  timezone: string;
  locale: string;
  theme: string;
  updated_at: Date;
}

function firstRow<T>(result: QueryResult): T | null {
  return (result.rows[0] as unknown as T) ?? null;
}

export class AuthRepository {
  async findUserByEmail(email: string): Promise<UserRow | null> {
    const normalized = email.toLowerCase().trim();
    const result = await queryReplica(
      `SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL LIMIT 1`,
      [normalized]
    );
    return firstRow<UserRow>(result);
  }

  async findUserById(id: string): Promise<UserRow | null> {
    const result = await queryReplica(
      `SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [id]
    );
    return firstRow<UserRow>(result);
  }

  async createUser(data: CreateUserData): Promise<UserRow> {
    const result = await queryPrimary(
      `INSERT INTO users (email, name, password_hash, email_verified, avatar_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        data.email.toLowerCase().trim(),
        data.name,
        data.password_hash ?? null,
        data.email_verified ?? false,
        data.avatar_url ?? null,
      ]
    );
    return result.rows[0] as unknown as UserRow;
  }

  async updateUser(id: string, data: UpdateUserData): Promise<UserRow | null> {
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (data.email !== undefined) { setClauses.push(`email = $${idx++}`); params.push(data.email.toLowerCase().trim()); }
    if (data.name !== undefined) { setClauses.push(`name = $${idx++}`); params.push(data.name); }
    if (data.password_hash !== undefined) { setClauses.push(`password_hash = $${idx++}`); params.push(data.password_hash); }
    if (data.email_verified !== undefined) { setClauses.push(`email_verified = $${idx++}`); params.push(data.email_verified); }
    if (data.email_verified_at !== undefined) { setClauses.push(`email_verified_at = $${idx++}`); params.push(data.email_verified_at); }
    if (data.avatar_url !== undefined) { setClauses.push(`avatar_url = $${idx++}`); params.push(data.avatar_url); }
    if (data.totp_secret !== undefined) { setClauses.push(`totp_secret = $${idx++}`); params.push(data.totp_secret); }
    if (data.totp_enabled !== undefined) { setClauses.push(`totp_enabled = $${idx++}`); params.push(data.totp_enabled); }
    if (data.mfa_backup_codes !== undefined) { setClauses.push(`mfa_backup_codes = $${idx++}`); params.push(data.mfa_backup_codes); }
    if (data.mfa_backup_codes_generated_at !== undefined) { setClauses.push(`mfa_backup_codes_generated_at = $${idx++}`); params.push(data.mfa_backup_codes_generated_at); }
    if (data.status !== undefined) { setClauses.push(`status = $${idx++}`); params.push(data.status); }
    if (data.last_login_at !== undefined) { setClauses.push(`last_login_at = $${idx++}`); params.push(data.last_login_at); }
    if (data.password_changed_at !== undefined) { setClauses.push(`password_changed_at = $${idx++}`); params.push(data.password_changed_at); }
    if (data.consent_tos_version !== undefined) { setClauses.push(`consent_tos_version = $${idx++}`); params.push(data.consent_tos_version); }
    if (data.consent_tos_at !== undefined) { setClauses.push(`consent_tos_at = $${idx++}`); params.push(data.consent_tos_at); }
    if (data.privacy_policy_version !== undefined) { setClauses.push(`privacy_policy_version = $${idx++}`); params.push(data.privacy_policy_version); }
    if (data.deleted_at !== undefined) { setClauses.push(`deleted_at = $${idx++}`); params.push(data.deleted_at); }
    if (data.locked_until !== undefined) { setClauses.push(`locked_until = $${idx++}`); params.push(data.locked_until); }
    if (data.failed_login_attempts !== undefined) { setClauses.push(`failed_login_attempts = $${idx++}`); params.push(data.failed_login_attempts); }

    if (setClauses.length === 0) return this.findUserById(id);

    params.push(id);
    const result = await queryPrimary(
      `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${idx} AND deleted_at IS NULL RETURNING *`,
      params
    );
    return firstRow<UserRow>(result);
  }

  async incrementFailedLoginAttempts(userId: string): Promise<void> {
    await queryPrimary(
      `UPDATE users SET failed_login_attempts = failed_login_attempts + 1 WHERE id = $1`,
      [userId]
    );
  }

  async resetFailedLoginAttempts(userId: string): Promise<void> {
    await queryPrimary(
      `UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1`,
      [userId]
    );
  }

  async lockUser(userId: string, until: Date): Promise<void> {
    await queryPrimary(
      `UPDATE users SET locked_until = $1 WHERE id = $2`,
      [until, userId]
    );
  }

  async findRefreshToken(tokenHash: string): Promise<RefreshTokenRow | null> {
    const result = await queryPrimary(
      `SELECT * FROM refresh_tokens WHERE token_hash = $1 LIMIT 1`,
      [tokenHash]
    );
    return firstRow<RefreshTokenRow>(result);
  }

  async createRefreshToken(data: CreateRefreshTokenData): Promise<RefreshTokenRow> {
    const result = await queryPrimary(
      `INSERT INTO refresh_tokens (user_id, org_id, token_hash, family_id, last_access_token_jti, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        data.user_id,
        data.org_id ?? null,
        data.token_hash,
        data.family_id,
        data.last_access_token_jti ?? null,
        data.expires_at,
      ]
    );
    return result.rows[0] as unknown as RefreshTokenRow;
  }

  async updateRefreshTokenJti(id: string, jti: string): Promise<void> {
    await queryPrimary(
      `UPDATE refresh_tokens SET last_access_token_jti = $1 WHERE id = $2`,
      [jti, id]
    );
  }

  async revokeRefreshToken(id: string): Promise<void> {
    await queryPrimary(
      `UPDATE refresh_tokens SET is_revoked = TRUE, revoked_at = NOW() WHERE id = $1`,
      [id]
    );
  }

  async revokeTokenFamily(familyId: string): Promise<void> {
    await queryPrimary(
      `UPDATE refresh_tokens SET is_revoked = TRUE, revoked_at = NOW() WHERE family_id = $1`,
      [familyId]
    );
  }

  async revokeAllUserTokens(userId: string): Promise<void> {
    await queryPrimary(
      `UPDATE refresh_tokens SET is_revoked = TRUE, revoked_at = NOW() WHERE user_id = $1 AND is_revoked = FALSE`,
      [userId]
    );
  }

  async findAuthProvider(provider: string, providerUserId: string): Promise<AuthProviderRow | null> {
    const result = await queryReplica(
      `SELECT * FROM auth_providers WHERE provider = $1 AND provider_user_id = $2 LIMIT 1`,
      [provider, providerUserId]
    );
    return firstRow<AuthProviderRow>(result);
  }

  async createAuthProvider(data: CreateAuthProviderData): Promise<AuthProviderRow> {
    const result = await queryPrimary(
      `INSERT INTO auth_providers (user_id, provider, provider_user_id, org_id, metadata)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        data.user_id,
        data.provider,
        data.provider_user_id,
        data.org_id ?? null,
        JSON.stringify(data.metadata ?? {}),
      ]
    );
    return result.rows[0] as unknown as AuthProviderRow;
  }

  async getUserPreferences(userId: string): Promise<UserPreferencesRow | null> {
    const result = await queryReplica(
      `SELECT * FROM user_preferences WHERE user_id = $1 LIMIT 1`,
      [userId]
    );
    return firstRow<UserPreferencesRow>(result);
  }

  async createUserPreferences(userId: string): Promise<UserPreferencesRow> {
    const result = await queryPrimary(
      `INSERT INTO user_preferences (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
       RETURNING *`,
      [userId]
    );
    return result.rows[0] as unknown as UserPreferencesRow;
  }
}
