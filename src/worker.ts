// STEP 1: OpenTelemetry SDK — MUST be first
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const sdk = new NodeSDK({ instrumentations: [getNodeAutoInstrumentations()] });
sdk.start();

// STEP 2: All other imports
import { Worker } from 'bullmq';
import { logger } from './shared/observability/logger';
import { closeAllRedisClients, redisPubSubClient } from './shared/redis/clients';
import { primaryPool, replicaPool } from './shared/database/pool';
import { config } from './shared/config';
import { startQueueMetricsCollection } from './shared/observability/metrics';

// Worker registrations
import auditWorker from './modules/audit/workers/audit.worker.registration';
import { startNotificationWorker } from './modules/notification/workers/notification.worker.registration';
import { startEmailWorker } from './modules/notification/workers/email.worker.registration';
import { startDigestWorker } from './modules/notification/workers/digest.worker.registration';
import { startSearchWorker } from './modules/search/workers/search-index.worker.registration';
import { startPaymentWorker } from './modules/payment/workers/payment.worker.registration';
import { startErasureWorker } from './modules/gdpr/workers/erasure.worker.registration';
import { startOffboardingWorker } from './modules/gdpr/workers/offboarding.worker.registration';
import { startVirusScanWorker, startFileCleanupWorker } from './modules/file/workers/virus-scan.worker.registration';
import { startCleanupWorker } from './shared/jobs/cleanup.worker.registration';
import { startWebhookDeliveryWorker } from './modules/webhook/workers/webhook-delivery.worker.registration';
import { startRecurringTaskWorker } from './modules/task/workers/recurring-task.worker.registration';

// All BullMQ Worker instances — used by SIGTERM handler to drain in-flight jobs
export const allRegisteredWorkers: Worker[] = [];

function routeOutboxEvent(event: { event_type: string; [key: string]: unknown }): void {
  // Event routing filled in as modules are built.
  logger.debug({ eventType: event.event_type }, 'Outbox event received');
}

async function startWorker(): Promise<void> {
  logger.info('Worker starting...');

  // Subscribe using redisPubSubClient — subscribe-only client
  redisPubSubClient.on('message', (_channel, message) => {
    try {
      const event = JSON.parse(message);
      routeOutboxEvent(event);
    } catch (err) {
      logger.error({ err, message }, 'Failed to parse outbox event');
    }
  });
  await redisPubSubClient.subscribe('outbox:events');

  // Start all BullMQ workers and collect instances for clean shutdown
  allRegisteredWorkers.push(auditWorker);
  allRegisteredWorkers.push(startNotificationWorker());
  allRegisteredWorkers.push(startEmailWorker());
  allRegisteredWorkers.push(startSearchWorker());
  allRegisteredWorkers.push(startPaymentWorker());
  allRegisteredWorkers.push(startErasureWorker());
  allRegisteredWorkers.push(startOffboardingWorker());
  allRegisteredWorkers.push(startVirusScanWorker());
  allRegisteredWorkers.push(startFileCleanupWorker());
  allRegisteredWorkers.push(startWebhookDeliveryWorker());
  allRegisteredWorkers.push(startRecurringTaskWorker());

  // Async workers (register repeatable jobs before starting)
  const [cleanupWorker, digestWorker] = await Promise.all([
    startCleanupWorker(),
    startDigestWorker(),
  ]);
  allRegisteredWorkers.push(cleanupWorker, digestWorker);

  // Start metrics collection every 30s in worker process too
  startQueueMetricsCollection();

  logger.info({ workerCount: allRegisteredWorkers.length }, 'Worker ready. All BullMQ workers started.');
}

// Process-level safety nets
process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Worker: Unhandled Promise Rejection — shutting down');
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Worker: Uncaught Exception — shutting down');
  process.exit(1);
});

// Graceful shutdown for worker — ordered: stop intake → drain jobs → close DB → close Redis
process.on('SIGTERM', async () => {
  logger.info('Worker SIGTERM. Graceful shutdown...');

  const forced = setTimeout(() => {
    logger.error('Forced worker shutdown: 30s drain timeout exceeded.');
    process.exit(1);
  }, 30_000);

  try {
    // Step 1: Close all BullMQ workers — allows in-flight jobs to complete
    if (allRegisteredWorkers.length > 0) {
      await Promise.all(allRegisteredWorkers.map(w => w.close()));
      logger.info({ count: allRegisteredWorkers.length }, 'BullMQ workers closed');
    }

    // Step 2: Close DB pools
    await primaryPool.end();
    if (config.databaseReplicaUrl) await replicaPool.end();

    // Step 3: Close all Redis clients
    await closeAllRedisClients();

    clearTimeout(forced);
    logger.info('Worker shutdown complete.');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Error during worker shutdown');
    process.exit(1);
  }
});

startWorker().catch(err => {
  logger.fatal({ err }, 'Fatal worker startup error');
  process.exit(1);
});
