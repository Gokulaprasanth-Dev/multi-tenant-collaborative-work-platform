import { PoolClient } from 'pg';
import { queryPrimary, queryReplica } from '../../shared/database/pool';

export interface ChatMessageRow {
  id: string;
  org_id: string;
  channel_id: string;
  sender_id: string;
  client_message_id: string;
  sequence_number: string; // bigint serialised as string
  body: string;
  body_parsed: Record<string, unknown> | null;
  parent_message_id: string | null;
  is_edited: boolean;
  edit_history: Record<string, unknown>[];
  deleted_at: Date | null;
  created_at: Date;
}

export interface CreateMessageData {
  org_id: string;
  channel_id: string;
  sender_id: string;
  client_message_id: string;
  sequence_number: bigint;
  body: string;
  body_parsed?: Record<string, unknown> | null;
  parent_message_id?: string | null;
}

export class MessageRepository {
  /**
   * Idempotency check — look up by (channel_id, client_message_id).
   * Uses PRIMARY to avoid replica lag returning stale "not found".
   */
  async findByClientMessageId(
    channelId: string,
    clientMessageId: string
  ): Promise<ChatMessageRow | null> {
    const result = await queryPrimary(
      `SELECT * FROM chat_messages
       WHERE channel_id = $1 AND client_message_id = $2
       LIMIT 1`,
      [channelId, clientMessageId]
    );
    return (result.rows[0] as unknown as ChatMessageRow) ?? null;
  }

  /**
   * BUG-NEW-005 fix: fetch parent WITHOUT created_at filter so PostgreSQL scans ALL partitions.
   * Never add AND created_at > NOW() - INTERVAL '1 month' — this silently breaks cross-partition threading.
   */
  async findById(id: string, channelId: string): Promise<ChatMessageRow | null> {
    const result = await queryPrimary(
      `SELECT id, channel_id, org_id, sender_id, parent_message_id, sequence_number, body, created_at, deleted_at
       FROM chat_messages
       WHERE id = $1 AND channel_id = $2
       LIMIT 1`,
      [id, channelId]
    );
    return (result.rows[0] as unknown as ChatMessageRow) ?? null;
  }

  async create(data: CreateMessageData, client?: PoolClient): Promise<ChatMessageRow> {
    const sql = `
      INSERT INTO chat_messages
        (id, org_id, channel_id, sender_id, client_message_id, sequence_number,
         body, body_parsed, parent_message_id, created_at)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, NOW())
      RETURNING *`;
    const params = [
      data.org_id,
      data.channel_id,
      data.sender_id,
      data.client_message_id,
      data.sequence_number.toString(),
      data.body,
      data.body_parsed ? JSON.stringify(data.body_parsed) : null,
      data.parent_message_id ?? null,
    ];
    const result = client
      ? await client.query(sql, params)
      : await queryPrimary(sql, params);
    return result.rows[0] as unknown as ChatMessageRow;
  }

  async listByChannel(
    channelId: string,
    limit = 50,
    beforeSequence?: bigint
  ): Promise<ChatMessageRow[]> {
    if (beforeSequence !== undefined) {
      const result = await queryReplica(
        `SELECT * FROM chat_messages
         WHERE channel_id = $1 AND sequence_number < $2 AND deleted_at IS NULL
         ORDER BY sequence_number DESC LIMIT $3`,
        [channelId, beforeSequence.toString(), limit]
      );
      return (result.rows as unknown as ChatMessageRow[]).reverse();
    }
    const result = await queryReplica(
      `SELECT * FROM chat_messages
       WHERE channel_id = $1 AND deleted_at IS NULL
       ORDER BY sequence_number DESC LIMIT $2`,
      [channelId, limit]
    );
    return (result.rows as unknown as ChatMessageRow[]).reverse();
  }

  async softDelete(orgId: string, messageId: string, senderId: string): Promise<boolean> {
    const result = await queryPrimary(
      `UPDATE chat_messages SET deleted_at = NOW()
       WHERE id = $1 AND org_id = $2 AND sender_id = $3 AND deleted_at IS NULL`,
      [messageId, orgId, senderId]
    );
    return (result.rowCount ?? 0) > 0;
  }
}
