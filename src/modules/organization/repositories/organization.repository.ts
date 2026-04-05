import { PoolClient } from 'pg';
import { queryPrimary, queryReplica } from '../../../shared/database/pool';

export interface OrgRow {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'offboarding' | 'deleted';
  plan_tier: 'free' | 'pro' | 'business' | 'enterprise';
  plan_started_at: Date;
  plan_expires_at: Date | null;
  grace_period_ends_at: Date | null;
  offboarding_started_at: Date | null;
  deleted_at: Date | null;
  max_members: number;
  storage_quota_bytes: number;
  storage_used_bytes: number;
  saml_enabled: boolean;
  saml_metadata_url: string | null;
  mfa_required: boolean;
  account_lockout_attempts: number;
  retention_audit_days: number;
  retention_chat_days: number | null;
  timezone: string;
  locale: string;
  created_at: Date;
  updated_at: Date;
  version: number;
}

export interface CreateOrgData {
  name: string;
  slug: string;
  plan_tier?: 'free' | 'pro' | 'business' | 'enterprise';
  timezone?: string;
  locale?: string;
}

export interface UpdateOrgData {
  name?: string;
  slug?: string;
  timezone?: string;
  locale?: string;
  mfa_required?: boolean;
  account_lockout_attempts?: number;
  retention_chat_days?: number | null;
  saml_enabled?: boolean;
  saml_metadata_url?: string | null;
  max_members?: number;
}

export class OrganizationRepository {
  async findById(id: string, client?: PoolClient): Promise<OrgRow | null> {
    const result = client
      ? await client.query(`SELECT * FROM organizations WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [id])
      : await queryReplica(`SELECT * FROM organizations WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [id]);
    return (result.rows[0] as unknown as OrgRow) ?? null;
  }

  async findBySlug(slug: string): Promise<OrgRow | null> {
    const result = await queryReplica(
      `SELECT * FROM organizations WHERE slug = $1 AND deleted_at IS NULL LIMIT 1`,
      [slug]
    );
    return (result.rows[0] as unknown as OrgRow) ?? null;
  }

  async create(data: CreateOrgData, client?: PoolClient): Promise<OrgRow> {
    const sql = `
      INSERT INTO organizations (name, slug, plan_tier, timezone, locale)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *`;
    const params = [
      data.name,
      data.slug,
      data.plan_tier ?? 'free',
      data.timezone ?? 'UTC',
      data.locale ?? 'en-US',
    ];
    const result = client
      ? await client.query(sql, params)
      : await queryPrimary(sql, params);
    return result.rows[0] as unknown as OrgRow;
  }

  async update(
    orgId: string,
    data: UpdateOrgData,
    expectedVersion: number
  ): Promise<OrgRow | null> {
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (data.name !== undefined) { setClauses.push(`name = $${idx++}`); params.push(data.name); }
    if (data.slug !== undefined) { setClauses.push(`slug = $${idx++}`); params.push(data.slug); }
    if (data.timezone !== undefined) { setClauses.push(`timezone = $${idx++}`); params.push(data.timezone); }
    if (data.locale !== undefined) { setClauses.push(`locale = $${idx++}`); params.push(data.locale); }
    if (data.mfa_required !== undefined) { setClauses.push(`mfa_required = $${idx++}`); params.push(data.mfa_required); }
    if (data.account_lockout_attempts !== undefined) { setClauses.push(`account_lockout_attempts = $${idx++}`); params.push(data.account_lockout_attempts); }
    if (data.retention_chat_days !== undefined) { setClauses.push(`retention_chat_days = $${idx++}`); params.push(data.retention_chat_days); }
    if (data.saml_enabled !== undefined) { setClauses.push(`saml_enabled = $${idx++}`); params.push(data.saml_enabled); }
    if (data.saml_metadata_url !== undefined) { setClauses.push(`saml_metadata_url = $${idx++}`); params.push(data.saml_metadata_url); }
    if (data.max_members !== undefined) { setClauses.push(`max_members = $${idx++}`); params.push(data.max_members); }

    if (setClauses.length === 0) return this.findById(orgId);

    // Optimistic lock: version must match + increment on success
    setClauses.push(`version = version + 1`);
    params.push(orgId, expectedVersion);

    const result = await queryPrimary(
      `UPDATE organizations SET ${setClauses.join(', ')}
       WHERE id = $${idx++} AND version = $${idx++} AND deleted_at IS NULL
       RETURNING *`,
      params
    );
    return result.rows.length > 0 ? (result.rows[0] as unknown as OrgRow) : null;
  }

  async updateStatus(
    orgId: string,
    status: OrgRow['status'],
    extra?: Partial<Pick<OrgRow, 'offboarding_started_at' | 'deleted_at'>>,
    client?: PoolClient
  ): Promise<OrgRow | null> {
    const setClauses: string[] = ['status = $1'];
    const params: unknown[] = [status];
    let idx = 2;

    if (extra?.offboarding_started_at !== undefined) {
      setClauses.push(`offboarding_started_at = $${idx++}`);
      params.push(extra.offboarding_started_at);
    }
    if (extra?.deleted_at !== undefined) {
      setClauses.push(`deleted_at = $${idx++}`);
      params.push(extra.deleted_at);
    }
    params.push(orgId);

    const sql = `UPDATE organizations SET ${setClauses.join(', ')} WHERE id = $${idx} AND deleted_at IS NULL RETURNING *`;
    const result = client
      ? await client.query(sql, params)
      : await queryPrimary(sql, params);
    return result.rows.length > 0 ? (result.rows[0] as unknown as OrgRow) : null;
  }

  /** Atomically adds delta to storage_used_bytes if quota is not exceeded. Returns null if over quota. */
  async updateStorageUsed(orgId: string, delta: number): Promise<OrgRow | null> {
    const result = await queryPrimary(
      `UPDATE organizations
       SET storage_used_bytes = storage_used_bytes + $1
       WHERE id = $2 AND storage_used_bytes + $1 <= storage_quota_bytes
       RETURNING *`,
      [delta, orgId]
    );
    return result.rows.length > 0 ? (result.rows[0] as unknown as OrgRow) : null;
  }
}
