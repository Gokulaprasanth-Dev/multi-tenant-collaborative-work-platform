import { PoolClient } from 'pg';
import { queryPrimary, queryReplica } from '../../shared/database/pool';

export interface ChannelRow {
  id: string;
  org_id: string;
  type: 'direct' | 'group';
  name: string | null;
  created_by: string;
  workspace_id: string | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ChannelMemberRow {
  channel_id: string;
  user_id: string;
  org_id: string;
  last_read_sequence: string; // bigint as string
  last_read_at: Date | null;
  joined_at: Date;
  removed_at: Date | null;
}

export interface DirectChannelPairRow {
  org_id: string;
  user_a_id: string;
  user_b_id: string;
  channel_id: string;
  created_at: Date;
}

export class ChannelRepository {
  async findById(id: string, client?: PoolClient): Promise<ChannelRow | null> {
    const sql = `SELECT * FROM channels WHERE id = $1 AND deleted_at IS NULL LIMIT 1`;
    const result = client
      ? await client.query(sql, [id])
      : await queryReplica(sql, [id]);
    return (result.rows[0] as unknown as ChannelRow) ?? null;
  }

  async findByOrg(orgId: string, workspaceId?: string): Promise<ChannelRow[]> {
    if (workspaceId) {
      const result = await queryReplica(
        `SELECT * FROM channels
         WHERE org_id = $1 AND workspace_id = $2 AND deleted_at IS NULL
         ORDER BY created_at ASC`,
        [orgId, workspaceId]
      );
      return result.rows as unknown as ChannelRow[];
    }
    const result = await queryReplica(
      `SELECT * FROM channels WHERE org_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC`,
      [orgId]
    );
    return result.rows as unknown as ChannelRow[];
  }

  async create(
    orgId: string,
    type: 'direct' | 'group',
    createdBy: string,
    name: string | null,
    client: PoolClient,
    workspaceId?: string | null,
  ): Promise<ChannelRow> {
    const result = await client.query(
      `INSERT INTO channels (org_id, type, name, created_by, workspace_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [orgId, type, name, createdBy, workspaceId ?? null]
    );
    return result.rows[0] as unknown as ChannelRow;
  }

  async addMember(
    channelId: string,
    userId: string,
    orgId: string,
    client: PoolClient
  ): Promise<void> {
    await client.query(
      `INSERT INTO channel_members (channel_id, user_id, org_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (channel_id, user_id) DO NOTHING`,
      [channelId, userId, orgId]
    );
  }

  async isMember(channelId: string, userId: string): Promise<boolean> {
    const result = await queryReplica(
      `SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2 AND removed_at IS NULL LIMIT 1`,
      [channelId, userId]
    );
    return result.rows.length > 0;
  }

  async getMembers(channelId: string): Promise<ChannelMemberRow[]> {
    const result = await queryReplica(
      `SELECT * FROM channel_members WHERE channel_id = $1 AND removed_at IS NULL`,
      [channelId]
    );
    return result.rows as unknown as ChannelMemberRow[];
  }

  async insertDirectPair(
    orgId: string,
    userAId: string,
    userBId: string,
    channelId: string,
    client: PoolClient
  ): Promise<void> {
    await client.query(
      `INSERT INTO direct_channel_pairs (org_id, user_a_id, user_b_id, channel_id)
       VALUES ($1, $2, $3, $4)`,
      [orgId, userAId, userBId, channelId]
    );
  }

  async findDirectChannel(
    orgId: string,
    userAId: string,
    userBId: string
  ): Promise<ChannelRow | null> {
    // canonical ordering: a < b
    const a = userAId < userBId ? userAId : userBId;
    const b = userAId < userBId ? userBId : userAId;
    const result = await queryPrimary(
      `SELECT c.* FROM channels c
       JOIN direct_channel_pairs dcp ON dcp.channel_id = c.id
       WHERE dcp.org_id = $1 AND dcp.user_a_id = $2 AND dcp.user_b_id = $3
         AND c.deleted_at IS NULL
       LIMIT 1`,
      [orgId, a, b]
    );
    return (result.rows[0] as unknown as ChannelRow) ?? null;
  }

  async updateLastRead(channelId: string, userId: string, sequence: bigint): Promise<void> {
    await queryPrimary(
      `UPDATE channel_members SET last_read_sequence = $1, last_read_at = NOW()
       WHERE channel_id = $2 AND user_id = $3`,
      [sequence.toString(), channelId, userId]
    );
  }
}
