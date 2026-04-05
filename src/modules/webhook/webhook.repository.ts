import { queryPrimary, queryReplica } from '../../shared/database/pool';

export interface WebhookRow extends Record<string, unknown> {
  id: string;
  org_id: string;
  url: string;
  secret_hash: string;
  secret_encrypted: string;
  secret_preview: string;
  secret_key_version: number;
  event_types: string[];
  is_active: boolean;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface WebhookDeliveryLogRow extends Record<string, unknown> {
  id: string;
  webhook_id: string;
  org_id: string;
  event_id: string;
  event_type: string;
  status: 'pending' | 'delivered' | 'failed' | 'exhausted';
  response_status_code?: number;
  response_body?: string;
  error_message?: string;
  attempt_count: number;
  delivered_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export class WebhookRepository {
  async create(data: {
    org_id: string;
    url: string;
    secret_hash: string;
    secret_encrypted: string;
    secret_preview: string;
    event_types: string[];
    created_by: string;
  }): Promise<WebhookRow> {
    const result = await queryPrimary<WebhookRow>(
      `INSERT INTO webhook_subscriptions (org_id, url, secret_hash, secret_encrypted, secret_preview, event_types, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [data.org_id, data.url, data.secret_hash, data.secret_encrypted, data.secret_preview,
       data.event_types, data.created_by]
    );
    return result.rows[0]!;
  }

  async findById(id: string, orgId: string): Promise<WebhookRow | null> {
    const result = await queryPrimary<WebhookRow>(
      `SELECT * FROM webhook_subscriptions WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [id, orgId]
    );
    return result.rows[0] ?? null;
  }

  async findByOrg(orgId: string): Promise<WebhookRow[]> {
    const result = await queryReplica<WebhookRow>(
      `SELECT * FROM webhook_subscriptions WHERE org_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
      [orgId]
    );
    return result.rows;
  }

  async findActive(orgId: string): Promise<WebhookRow[]> {
    const result = await queryPrimary<WebhookRow>(
      `SELECT * FROM webhook_subscriptions WHERE org_id = $1 AND is_active = true AND deleted_at IS NULL`,
      [orgId]
    );
    return result.rows;
  }

  async updateSecret(
    id: string,
    orgId: string,
    secretHash: string,
    secretEncrypted: string,
    secretPreview: string,
    keyVersion: number
  ): Promise<WebhookRow | null> {
    const result = await queryPrimary<WebhookRow>(
      `UPDATE webhook_subscriptions
       SET secret_hash = $3, secret_encrypted = $4, secret_preview = $5,
           secret_key_version = $6, updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [id, orgId, secretHash, secretEncrypted, secretPreview, keyVersion]
    );
    return result.rows[0] ?? null;
  }

  async softDelete(id: string, orgId: string): Promise<void> {
    await queryPrimary(
      `UPDATE webhook_subscriptions SET deleted_at = NOW(), is_active = false WHERE id = $1 AND org_id = $2`,
      [id, orgId]
    );
  }

  async findDeliveryLog(webhookId: string, eventId: string): Promise<WebhookDeliveryLogRow | null> {
    const result = await queryPrimary<WebhookDeliveryLogRow>(
      `SELECT * FROM webhook_delivery_log WHERE webhook_id = $1 AND event_id = $2 LIMIT 1`,
      [webhookId, eventId]
    );
    return result.rows[0] ?? null;
  }

  async createDeliveryLog(data: {
    webhook_id: string;
    org_id: string;
    event_id: string;
    event_type: string;
  }): Promise<WebhookDeliveryLogRow> {
    const result = await queryPrimary<WebhookDeliveryLogRow>(
      `INSERT INTO webhook_delivery_log (webhook_id, org_id, event_id, event_type, status, attempt_count)
       VALUES ($1, $2, $3, $4, 'pending', 0)
       RETURNING *`,
      [data.webhook_id, data.org_id, data.event_id, data.event_type]
    );
    return result.rows[0]!;
  }

  async updateDeliveryLog(
    id: string,
    status: 'delivered' | 'failed' | 'exhausted',
    responseStatusCode?: number,
    errorMessage?: string
  ): Promise<void> {
    await queryPrimary(
      `UPDATE webhook_delivery_log
       SET status = $2, response_status_code = $3, error_message = $4,
           attempt_count = attempt_count + 1, updated_at = NOW(),
           delivered_at = CASE WHEN $2 = 'delivered' THEN NOW() ELSE NULL END
       WHERE id = $1`,
      [id, status, responseStatusCode ?? null, errorMessage ?? null]
    );
  }
}
