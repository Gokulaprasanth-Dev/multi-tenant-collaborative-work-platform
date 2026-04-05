import { queryPrimary, queryReplica } from '../../shared/database/pool';

export interface NotificationRow {
  id: string;
  org_id: string;
  user_id: string;
  type: string;
  entity_type: string;
  entity_id: string;
  actor_id: string | null;
  payload: Record<string, unknown>;
  is_read: boolean;
  read_at: Date | null;
  created_at: Date;
}

export interface NotificationPreferenceRow {
  id: string;
  org_id: string;
  user_id: string;
  event_type: string;
  channel_inapp: boolean;
  channel_email: boolean;
  channel_push: boolean;
  digest_mode: 'realtime' | 'daily_digest';
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface NotificationDeliveryLogRow {
  id: string;
  notification_id: string;
  channel: string;
  status: 'pending' | 'sent' | 'failed';
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateNotificationData {
  org_id: string;
  user_id: string;
  type: string;
  entity_type: string;
  entity_id: string;
  actor_id?: string | null;
  payload?: Record<string, unknown>;
}

export class NotificationRepository {
  async create(data: CreateNotificationData): Promise<NotificationRow> {
    const result = await queryPrimary(
      `INSERT INTO notifications (org_id, user_id, type, entity_type, entity_id, actor_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING *`,
      [
        data.org_id,
        data.user_id,
        data.type,
        data.entity_type,
        data.entity_id,
        data.actor_id ?? null,
        JSON.stringify(data.payload ?? {}),
      ]
    );
    return result.rows[0] as unknown as NotificationRow;
  }

  async findByUser(
    orgId: string,
    userId: string,
    onlyUnread = false,
    limit = 50,
    offset = 0
  ): Promise<NotificationRow[]> {
    const unreadClause = onlyUnread ? 'AND is_read = FALSE' : '';
    const result = await queryReplica(
      `SELECT * FROM notifications
       WHERE org_id = $1 AND user_id = $2 ${unreadClause}
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [orgId, userId, limit, offset]
    );
    return result.rows as unknown as NotificationRow[];
  }

  async markRead(orgId: string, userId: string, notificationId: string): Promise<boolean> {
    const result = await queryPrimary(
      `UPDATE notifications SET is_read = TRUE, read_at = NOW()
       WHERE id = $1 AND org_id = $2 AND user_id = $3 AND is_read = FALSE
       RETURNING id`,
      [notificationId, orgId, userId]
    );
    return result.rows.length > 0;
  }

  async markAllRead(orgId: string, userId: string): Promise<number> {
    const result = await queryPrimary(
      `UPDATE notifications SET is_read = TRUE, read_at = NOW()
       WHERE org_id = $1 AND user_id = $2 AND is_read = FALSE`,
      [orgId, userId]
    );
    return result.rowCount ?? 0;
  }

  // ── Preferences ───────────────────────────────────────────────────────────

  async findPreference(
    orgId: string,
    userId: string,
    eventType: string
  ): Promise<NotificationPreferenceRow | null> {
    const result = await queryReplica(
      `SELECT * FROM notification_preferences
       WHERE org_id = $1 AND user_id = $2 AND event_type = $3 LIMIT 1`,
      [orgId, userId, eventType]
    );
    return (result.rows[0] as unknown as NotificationPreferenceRow) ?? null;
  }

  async upsertPreference(
    orgId: string,
    userId: string,
    eventType: string,
    data: Partial<Pick<NotificationPreferenceRow,
      'channel_inapp' | 'channel_email' | 'channel_push' | 'digest_mode' |
      'quiet_hours_start' | 'quiet_hours_end'
    >>
  ): Promise<NotificationPreferenceRow> {
    const setClauses: string[] = [];
    const params: unknown[] = [orgId, userId, eventType];
    let idx = 4;

    if (data.channel_inapp !== undefined) { setClauses.push(`channel_inapp = $${idx++}`); params.push(data.channel_inapp); }
    if (data.channel_email !== undefined) { setClauses.push(`channel_email = $${idx++}`); params.push(data.channel_email); }
    if (data.channel_push !== undefined) { setClauses.push(`channel_push = $${idx++}`); params.push(data.channel_push); }
    if (data.digest_mode !== undefined) { setClauses.push(`digest_mode = $${idx++}`); params.push(data.digest_mode); }
    if (data.quiet_hours_start !== undefined) { setClauses.push(`quiet_hours_start = $${idx++}`); params.push(data.quiet_hours_start); }
    if (data.quiet_hours_end !== undefined) { setClauses.push(`quiet_hours_end = $${idx++}`); params.push(data.quiet_hours_end); }

    const updateSet = setClauses.length > 0
      ? setClauses.join(', ')
      : 'channel_inapp = channel_inapp'; // no-op update so RETURNING works

    const result = await queryPrimary(
      `INSERT INTO notification_preferences (org_id, user_id, event_type)
       VALUES ($1, $2, $3)
       ON CONFLICT (org_id, user_id, event_type)
       DO UPDATE SET ${updateSet}
       RETURNING *`,
      params
    );
    return result.rows[0] as unknown as NotificationPreferenceRow;
  }

  async listPreferences(orgId: string, userId: string): Promise<NotificationPreferenceRow[]> {
    const result = await queryReplica(
      `SELECT * FROM notification_preferences WHERE org_id = $1 AND user_id = $2 ORDER BY event_type ASC`,
      [orgId, userId]
    );
    return result.rows as unknown as NotificationPreferenceRow[];
  }
}
