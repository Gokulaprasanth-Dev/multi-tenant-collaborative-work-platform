import { Job, Worker } from 'bullmq';
import * as dns from 'dns';
import ipaddr from 'ipaddr.js';
import axios from 'axios';
import { WebhookRepository } from '../webhook.repository';
import { decryptSecret, hmac } from '../../../shared/crypto';
import { redisClient } from '../../../shared/redis/clients';
import { logger } from '../../../shared/observability/logger';

const webhookRepo = new WebhookRepository();

export interface WebhookDeliveryJobData {
  webhookId: string;
  orgId: string;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

// SEC-NEW-003 fix: DNS rebinding prevention — resolve hostname at delivery time
async function isPrivateIp(ip: string): Promise<boolean> {
  try {
    const parsed = ipaddr.parse(ip);
    return parsed.range() !== 'unicast';
  } catch {
    return true;
  }
}

async function deliverWebhook(
  webhookUrl: URL,
  payload: unknown,
  secret: string,
  eventType: string,
  eventId: string
): Promise<number> {
  // Resolve hostname ONCE — prevents DNS rebinding
  const resolved = await dns.promises.lookup(webhookUrl.hostname);

  // Check resolved IP against private ranges (delivery-time check)
  if (await isPrivateIp(resolved.address)) {
    throw new Error(`SSRF_BLOCKED: ${webhookUrl.hostname} resolves to private IP ${resolved.address}`);
  }

  // Connect to resolved IP directly with Host header set to original hostname
  const targetUrl = `${webhookUrl.protocol}//${resolved.address}${webhookUrl.pathname}${webhookUrl.search}`;
  const hmacSig = 'sha256=' + hmac(JSON.stringify(payload), secret);

  const response = await axios.post(targetUrl, payload, {
    headers: {
      'Host': webhookUrl.hostname,
      'X-Webhook-Signature': hmacSig,
      'X-Event-Type': eventType,
      'X-Event-ID': eventId,
      'Content-Type': 'application/json',
    },
    timeout: 10_000,
    validateStatus: () => true, // don't throw on 4xx/5xx
  });

  return response.status;
}

export async function webhookDeliveryWorkerJob(job: Job<WebhookDeliveryJobData>): Promise<void> {
  const { webhookId, orgId, eventId, eventType, payload } = job.data;

  // Idempotency: skip if already delivered
  const existing = await webhookRepo.findDeliveryLog(webhookId, eventId);
  if (existing?.status === 'delivered') {
    logger.debug({ webhookId, eventId }, 'webhookDelivery: already delivered, skipping');
    return;
  }

  // Create or retrieve delivery log
  const logRow = existing ?? await webhookRepo.createDeliveryLog({ webhook_id: webhookId, org_id: orgId, event_id: eventId, event_type: eventType });

  const webhook = await webhookRepo.findById(webhookId, orgId);
  if (!webhook || !webhook.is_active) {
    logger.warn({ webhookId }, 'webhookDelivery: webhook not found or inactive');
    return;
  }

  let responseStatus: number | undefined;
  try {
    const webhookUrl = new URL(webhook.url as string);
    const secret = decryptSecret(webhook.secret_encrypted as string);

    responseStatus = await deliverWebhook(webhookUrl, payload, secret, eventType, eventId);

    const success = responseStatus >= 200 && responseStatus < 300;
    await webhookRepo.updateDeliveryLog(logRow.id, success ? 'delivered' : 'failed', responseStatus);

    if (!success) {
      throw new Error(`Webhook returned ${responseStatus}`);
    }

    logger.info({ webhookId, eventId, responseStatus }, 'webhookDelivery: delivered');
  } catch (err) {
    await webhookRepo.updateDeliveryLog(logRow.id, 'failed', responseStatus);
    logger.warn({ err, webhookId, eventId }, 'webhookDelivery: delivery failed');
    throw err; // BullMQ will retry
  }
}

export function startWebhookDeliveryWorker(): Worker {
  const worker = new Worker<WebhookDeliveryJobData>(
    'webhooks',
    webhookDeliveryWorkerJob,
    { connection: redisClient, concurrency: 10 }
  );

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, 'webhookDeliveryWorker: job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'webhookDeliveryWorker: job failed');
  });

  logger.info('Webhook delivery worker started (concurrency: 10)');
  return worker;
}
