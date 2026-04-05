import { PoolClient } from 'pg';
import { queryPrimary, queryReplica } from '../../../shared/database/pool';

export interface MembershipRow {
  id: string;
  org_id: string;
  user_id: string;
  role: 'org_owner' | 'org_admin' | 'member' | 'guest';
  status: 'active' | 'suspended' | 'removed';
  invited_by: string | null;
  joined_at: Date | null;
  removed_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateMembershipData {
  org_id: string;
  user_id: string;
  role: MembershipRow['role'];
  invited_by?: string | null;
  joined_at?: Date | null;
}

export class MembershipRepository {
  async findMembership(orgId: string, userId: string, client?: PoolClient): Promise<MembershipRow | null> {
    const sql = `SELECT * FROM org_memberships WHERE org_id = $1 AND user_id = $2 AND deleted_at IS NULL LIMIT 1`;
    const params = [orgId, userId];
    const result = client
      ? await client.query(sql, params)
      : await queryReplica(sql, params);
    return (result.rows[0] as unknown as MembershipRow) ?? null;
  }

  async createMembership(data: CreateMembershipData, client?: PoolClient): Promise<MembershipRow> {
    const sql = `
      INSERT INTO org_memberships (org_id, user_id, role, invited_by, joined_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (org_id, user_id) WHERE deleted_at IS NULL
      DO UPDATE SET role = EXCLUDED.role, status = 'active', deleted_at = NULL, joined_at = EXCLUDED.joined_at
      RETURNING *`;
    const params = [
      data.org_id,
      data.user_id,
      data.role,
      data.invited_by ?? null,
      data.joined_at ?? new Date(),
    ];
    const result = client
      ? await client.query(sql, params)
      : await queryPrimary(sql, params);
    return result.rows[0] as unknown as MembershipRow;
  }

  async updateRole(orgId: string, userId: string, role: MembershipRow['role']): Promise<MembershipRow | null> {
    const result = await queryPrimary(
      `UPDATE org_memberships SET role = $1
       WHERE org_id = $2 AND user_id = $3 AND deleted_at IS NULL
       RETURNING *`,
      [role, orgId, userId]
    );
    return result.rows.length > 0 ? (result.rows[0] as unknown as MembershipRow) : null;
  }

  async removeMembership(orgId: string, userId: string): Promise<void> {
    await queryPrimary(
      `UPDATE org_memberships
       SET status = 'removed', deleted_at = NOW(), removed_at = NOW()
       WHERE org_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [orgId, userId]
    );
  }

  async countActiveMembers(orgId: string, client?: PoolClient): Promise<number> {
    const sql = `SELECT COUNT(*) AS cnt FROM org_memberships WHERE org_id = $1 AND status = 'active' AND deleted_at IS NULL`;
    const result = client
      ? await client.query(sql, [orgId])
      : await queryReplica(sql, [orgId]);
    return parseInt((result.rows[0] as { cnt: string }).cnt, 10);
  }

  async findMembersByOrg(orgId: string): Promise<MembershipRow[]> {
    const result = await queryReplica(
      `SELECT * FROM org_memberships WHERE org_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC`,
      [orgId]
    );
    return result.rows as unknown as MembershipRow[];
  }
}
