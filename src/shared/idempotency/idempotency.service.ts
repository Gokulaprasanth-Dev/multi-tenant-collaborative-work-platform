import { hashToken } from '../crypto';
import { queryPrimary } from '../database/pool';
import { ConflictError } from '../errors/app-errors';

const TTL_HOURS = 24;

interface IdempotencyRecord {
  id: string;
  key_hash: string;
  response_status: number | null;
  response_body: Record<string, unknown> | null;
  expires_at: Date;
}

export type IdempotencyResult =
  | { cached: true; keyHash: string; response: { status: number; body: Record<string, unknown> } }
  | { cached: false; keyHash: string };

export class IdempotencyService {
  static computeKeyHash(orgId: string, userId: string, endpoint: string, clientKey: string): string {
    return hashToken(`${orgId}:${userId}:${endpoint}:${clientKey}`);
  }

  static async checkAndStore(
    clientKey: string,
    orgId: string,
    userId: string,
    endpoint: string,
  ): Promise<IdempotencyResult> {
    const keyHash = IdempotencyService.computeKeyHash(orgId, userId, endpoint, clientKey);

    const existing = await queryPrimary<IdempotencyRecord & Record<string, unknown>>(
      `SELECT id, key_hash, response_status, response_body, expires_at
       FROM idempotency_keys
       WHERE key_hash = $1 AND expires_at > NOW()`,
      [keyHash]
    );

    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      if (row.response_status !== null && row.response_body !== null) {
        // Completed — return cached response
        return {
          cached: true,
          keyHash,
          response: { status: row.response_status, body: row.response_body },
        };
      }
      // In progress — another request is processing this key
      throw new ConflictError('IDEMPOTENCY_IN_PROGRESS', 'A request with this Idempotency-Key is already in progress');
    }

    // Insert new record — response_status NULL signals in-progress
    await queryPrimary(
      `INSERT INTO idempotency_keys (key_hash, org_id, user_id, endpoint, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '${TTL_HOURS} hours')
       ON CONFLICT (key_hash) DO NOTHING`,
      [keyHash, orgId, userId, endpoint]
    );

    return { cached: false, keyHash };
  }

  static async saveResponse(
    keyHash: string,
    status: number,
    body: Record<string, unknown>,
  ): Promise<void> {
    await queryPrimary(
      `UPDATE idempotency_keys
       SET response_status = $1, response_body = $2
       WHERE key_hash = $3`,
      [status, JSON.stringify(body), keyHash]
    );
  }
}
