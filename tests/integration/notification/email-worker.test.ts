/**
 * Integration tests for emailWorkerJob skip paths
 *
 * We test all branches that do NOT send real emails:
 * - Idempotency: second call with same key is skipped
 * - Unknown event type: skipped (no template mapping)
 * - Missing recipientEmail: skipped
 *
 * The actual send path requires SES/SendGrid credentials and is not tested here.
 */

import { v4 as uuidv4 } from 'uuid';
import type { Job } from 'bullmq';
import { redisClient } from '../../../src/shared/redis/clients';
import {
  emailWorkerJob,
  type SendNotificationEmailJobData,
} from '../../../src/modules/notification/workers/email.worker';

const RUN_INTEGRATION = Boolean(process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

function makeJob(data: SendNotificationEmailJobData): Job<SendNotificationEmailJobData> {
  return { data } as unknown as Job<SendNotificationEmailJobData>;
}

maybeDescribe('emailWorkerJob (skip paths)', () => {
  const entityId = uuidv4();
  const userId = uuidv4();

  afterEach(async () => {
    // Clean up any idempotency keys created during tests
    const keys = await redisClient.keys('email:sent:*');
    if (keys.length > 0) await redisClient.del(...keys);
  });

  it('skips when event type has no template mapping', async () => {
    // Should not throw — no email provider call happens
    await expect(emailWorkerJob(makeJob({
      userId,
      eventType: 'org.created',  // not in EVENT_TEMPLATE_MAP
      entityId,
      entityType: 'org',
      orgId: uuidv4(),
      actorUserId: null,
      payload: { recipientEmail: 'test@example.com' },
    }))).resolves.not.toThrow();
  });

  it('skips when recipientEmail is missing from payload', async () => {
    await expect(emailWorkerJob(makeJob({
      userId,
      eventType: 'task.assigned',
      entityId,
      entityType: 'task',
      orgId: uuidv4(),
      actorUserId: null,
      payload: {},  // no recipientEmail
    }))).resolves.not.toThrow();
  });

  it('skips on second call due to idempotency key', async () => {
    // Pre-set the idempotency key
    const key = `email:sent:${userId}:task.assigned:${entityId}`;
    await redisClient.set(key, '1', 'EX', 3600);

    // Should skip without attempting to send (no email provider error)
    await expect(emailWorkerJob(makeJob({
      userId,
      eventType: 'task.assigned',
      entityId,
      entityType: 'task',
      orgId: uuidv4(),
      actorUserId: null,
      payload: { recipientEmail: 'test@example.com' },
    }))).resolves.not.toThrow();
  });
});
