import { redisClient } from '../redis/clients';
import { primaryPool } from '../database/pool';
import { logger } from '../observability/logger';
import { config } from '../config';
import { generateSecureToken } from '../crypto';

const FULL_BATCH_DELAY_MS = 10;
const PARTIAL_BATCH_DELAY_MS = 5_000;
const MAX_BACKOFF_MS = 60_000;
const LOCK_KEY = 'outbox:poller:lock';
const LOCK_TTL_SECONDS = 10;

export class OutboxPoller {
  private running = false;
  private stopped = false;
  private cyclePromise: Promise<void> = Promise.resolve();
  private consecutiveErrors = 0;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.stopped = false;
    logger.info('OutboxPoller started');
    this.loop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    // Wait for the current cycle to finish before returning
    await this.cyclePromise;
    this.running = false;
    logger.info('OutboxPoller stopped');
  }

  private loop(): void {
    if (this.stopped) return;

    let isFull = false;

    this.cyclePromise = this.pollCycle(isFull).then((full) => {
      isFull = full;
      this.consecutiveErrors = 0;
    }).catch((err) => {
      this.consecutiveErrors++;
      logger.error({ err, consecutiveErrors: this.consecutiveErrors }, 'OutboxPoller: unexpected loop error');
      isFull = false;
    }).finally(() => {
      if (this.stopped) return;
      let delay: number;
      if (isFull) {
        delay = FULL_BATCH_DELAY_MS;
      } else if (this.consecutiveErrors > 0) {
        // Exponential backoff: 5s, 10s, 20s, 40s … capped at 60s
        delay = Math.min(PARTIAL_BATCH_DELAY_MS * Math.pow(2, this.consecutiveErrors - 1), MAX_BACKOFF_MS);
      } else {
        delay = PARTIAL_BATCH_DELAY_MS;
      }
      setTimeout(() => this.loop(), delay);
    });
  }

  private async pollCycle(_isFull: boolean): Promise<boolean> {
    // Acquire distributed lock — only one poller instance processes at a time
    const instanceId = generateSecureToken(8);
    const locked = await redisClient.set(LOCK_KEY, instanceId, 'EX', LOCK_TTL_SECONDS, 'NX');
    if (!locked) return false; // Another instance is polling

    let isFull = false;
    const client = await primaryPool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(`
        SELECT * FROM outbox_events
        WHERE status = 'pending' AND occurred_at < NOW() - INTERVAL '100ms'
        ORDER BY created_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      `, [config.outboxPollBatchSize]);

      const events = result.rows;
      if (events.length === 0) {
        await client.query('ROLLBACK');
        return false;
      }

      // STEP 1: PUBLISH to Redis FIRST (at-least-once semantics)
      // If crash occurs after publish but before DB update, event stays pending and retries.
      // Consumers deduplicate via correlation_id.
      for (const event of events) {
        try {
          // CRITICAL: use redisClient (general-purpose), NOT redisPubSubClient (subscribe-mode only)
          await redisClient.publish('outbox:events', JSON.stringify(event));
        } catch (err) {
          logger.warn({ err, eventId: event.id }, 'Failed to publish outbox event to Redis; will retry on next cycle');
          // Do NOT mark as published — leave as pending for retry
          await client.query('ROLLBACK');
          return false;
        }
      }

      // STEP 2: Only after all publishes succeed, mark as published
      const ids = events.map((e: { id: string }) => e.id);
      await client.query(`
        UPDATE outbox_events
        SET status = 'published', published_at = NOW()
        WHERE id = ANY($1::uuid[])
      `, [ids]);

      await client.query('COMMIT');

      isFull = events.length >= config.outboxPollBatchSize;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error({ err }, 'Outbox poll cycle error');
      isFull = false;
    } finally {
      client.release();
    }

    return isFull;
  }
}
