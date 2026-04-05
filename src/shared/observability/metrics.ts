import { Registry, collectDefaultMetrics, Histogram, Counter, Gauge } from 'prom-client';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { queues } from '../queue/queues';
import { queryReplica, primaryPool, replicaPool } from '../database/pool';
import { logger } from './logger';

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

// --- HTTP ---
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_ms',
  help: 'HTTP request duration in milliseconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [registry],
});

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [registry],
});

// --- BullMQ ---
export const bullmqQueueDepth = new Gauge({
  name: 'bullmq_queue_depth',
  help: 'Number of waiting jobs in BullMQ queue',
  labelNames: ['queue'],
  registers: [registry],
});

export const bullmqDlqDepth = new Gauge({
  name: 'bullmq_dlq_depth',
  help: 'Number of failed jobs in BullMQ queue',
  labelNames: ['queue'],
  registers: [registry],
});

export const bullmqJobsCompleted = new Counter({
  name: 'bullmq_jobs_completed_total',
  help: 'Total BullMQ jobs completed',
  labelNames: ['queue'],
  registers: [registry],
});

export const bullmqJobsFailed = new Counter({
  name: 'bullmq_jobs_failed_total',
  help: 'Total BullMQ jobs failed',
  labelNames: ['queue'],
  registers: [registry],
});

// --- Outbox / Search ---
export const outboxPendingEvents = new Gauge({
  name: 'outbox_pending_events',
  help: 'Number of pending outbox events',
  registers: [registry],
});

export const searchIndexLagSeconds = new Gauge({
  name: 'search_index_lag_seconds',
  help: 'Seconds since oldest pending search-related outbox event',
  registers: [registry],
});

// --- DB ---
export const dbPoolConnectionsActive = new Gauge({
  name: 'db_pool_connections_active',
  help: 'Active connections in DB pool',
  labelNames: ['pool'],
  registers: [registry],
});

export const dbQueryDuration = new Histogram({
  name: 'db_query_duration_ms',
  help: 'DB query duration in milliseconds',
  labelNames: ['pool', 'operation'],
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
  registers: [registry],
});

// --- Redis ---
export const redisCacheHits = new Counter({
  name: 'redis_cache_hits_total',
  help: 'Total Redis cache hits',
  registers: [registry],
});

export const redisCacheMisses = new Counter({
  name: 'redis_cache_misses_total',
  help: 'Total Redis cache misses',
  registers: [registry],
});

// --- Socket.IO ---
export const socketConnectionsActive = new Gauge({
  name: 'socket_connections_active',
  help: 'Active Socket.IO connections',
  registers: [registry],
});

// --- Circuit Breaker (also registered in circuit-breaker/index.ts — same registry) ---
// circuit_breaker_state Gauge is defined in circuit-breaker/index.ts

// --- Payments ---
export const paymentWebhookProcessed = new Counter({
  name: 'payment_webhook_processed_total',
  help: 'Total payment webhook events processed',
  labelNames: ['event_type'],
  registers: [registry],
});

// --- HTTP Middleware ---
export function httpMetricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const route = (req.route?.path as string) ?? req.path;
    const labels = { method: req.method, route, status_code: String(res.statusCode) };
    httpRequestDuration.observe(labels, duration);
    httpRequestsTotal.inc(labels);
  });
  next();
}

// --- Metrics endpoint auth ---
export function metricsAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token || token !== config.metricsToken) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or missing metrics token' } });
    return;
  }
  next();
}

// --- Queue metrics collection (run every 30s) ---
export async function collectQueueMetrics(): Promise<void> {
  for (const [name, queue] of Object.entries(queues)) {
    try {
      const [waiting, failed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getFailedCount(),
      ]);
      bullmqQueueDepth.set({ queue: name }, waiting);
      bullmqDlqDepth.set({ queue: name }, failed);
    } catch (err) {
      logger.warn({ err, queue: name }, 'Failed to collect queue metrics');
    }
  }

  // Outbox pending count
  try {
    const result = await queryReplica<{ count: string }>(
      `SELECT COUNT(*) AS count FROM outbox_events WHERE status = 'pending'`
    );
    outboxPendingEvents.set(parseInt(result.rows[0]?.count ?? '0', 10));
  } catch (err) {
    logger.warn({ err }, 'Failed to collect outbox_pending_events metric');
  }

  // DB pool active connections
  try {
    dbPoolConnectionsActive.set({ pool: 'primary' }, primaryPool.totalCount - primaryPool.idleCount);
    if (config.databaseReplicaUrl) {
      dbPoolConnectionsActive.set({ pool: 'replica' }, replicaPool.totalCount - replicaPool.idleCount);
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to collect db_pool_connections_active metric');
  }

  // Search index lag — BUG-NEW-007 fix: explicit IN list, not LIKE
  try {
    const result = await queryReplica<{ lag: string | null }>(`
      SELECT EXTRACT(EPOCH FROM NOW() - MIN(occurred_at)) AS lag
      FROM outbox_events
      WHERE status = 'pending'
        AND event_type IN (
          'task.created', 'task.updated', 'task.deleted',
          'message.created', 'message.deleted',
          'file.confirmed', 'file.deleted'
        )
    `);
    const lag = result.rows[0]?.lag;
    searchIndexLagSeconds.set(lag !== null && lag !== undefined ? parseFloat(lag) : 0);
  } catch (err) {
    logger.warn({ err }, 'Failed to collect search_index_lag_seconds metric');
  }
}

export function startQueueMetricsCollection(): NodeJS.Timeout {
  return setInterval(() => {
    collectQueueMetrics().catch(err =>
      logger.warn({ err }, 'Queue metrics collection error')
    );
  }, 30_000);
}
