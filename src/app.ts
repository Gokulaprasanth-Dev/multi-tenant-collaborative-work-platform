// STEP 1: OpenTelemetry SDK — MUST be first (before all other imports)
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const traceExporter = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  ? new OTLPTraceExporter({ url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT })
  : undefined;

const sdk = new NodeSDK({
  traceExporter,
  instrumentations: [getNodeAutoInstrumentations()],
});
sdk.start();

// STEP 2: All other imports after SDK is started
import 'express-async-errors';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { createServer } from 'http';
import { config } from './shared/config';
import { logger } from './shared/observability/logger';
import { requestLoggerMiddleware } from './shared/observability/request-logger.middleware';
import { errorHandlerMiddleware } from './shared/errors/error-handler.middleware';
import { primaryPool, replicaPool } from './shared/database/pool';
import { redisClient, closeAllRedisClients } from './shared/redis/clients';
import { createSocketServer } from './shared/realtime/socket-server';
import { httpMetricsMiddleware, metricsAuthMiddleware, registry, startQueueMetricsCollection } from './shared/observability/metrics';
import { OutboxPoller } from './shared/events/outbox-poller';
import { responseEnvelopeMiddleware } from './shared/response/response.middleware';
import authRouter from './modules/auth/auth.router';
import orgRouter from './modules/organization/organization.router';
import taskRouter from './modules/task/task.router';
import chatRouter from './modules/chat/chat.router';
import notificationRouter from './modules/notification/notification.router';
import { pushRouter } from './modules/notification/push.router';
import paymentRouter from './modules/payment/payment.router';
import fileRouter from './modules/file/file.router';
import searchRouter from './modules/search/search.router';
import workspaceRouter from './modules/workspace/workspace.router';
import webhookRouter from './modules/webhook/webhook.router';
import featureFlagRouter from './modules/feature-flag/feature-flag.router';
import adminRouter from './modules/platform-admin/admin.router';
import gdprRouter from './modules/gdpr/gdpr.router';
import swaggerUi from 'swagger-ui-express';

let appReady = false;
const outboxPoller = new OutboxPoller();
const app = express();
const httpServer = createServer(app);

// Socket.IO — must be attached to httpServer before it starts listening
const io = createSocketServer(httpServer);
export { io };

// Trust proxy — MUST be set before any middleware that uses req.ip
app.set('trust proxy', config.platformAdminTrustedProxy);

// Security middleware — Helmet with production-appropriate config
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  frameguard: { action: 'deny' },
  noSniff: true,
}));

app.use(cors({
  origin: config.corsOrigins.split(',').map(o => o.trim()),
  credentials: true,
}));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(requestLoggerMiddleware);
app.use(httpMetricsMiddleware);
app.use(responseEnvelopeMiddleware);

// Metrics endpoint — token-protected, never rely on load balancer
app.get('/metrics', metricsAuthMiddleware, async (_req, res) => {
  res.set('Content-Type', registry.contentType);
  res.end(await registry.metrics());
});

// Health endpoints
app.get('/live', (_req, res) => {
  res.json({ status: 'alive' });
});
app.get('/ready', (_req, res) => {
  if (!appReady) {
    return res.status(503).json({ status: 'not_ready', reason: 'migrations_in_progress' });
  }
  res.json({ status: 'ready' });
});
app.get('/health', async (_req, res) => {
  const checks: Record<string, string> = {};
  try { await primaryPool.query('SELECT 1'); checks.db = 'ok'; } catch { checks.db = 'error'; }
  try { await redisClient.ping(); checks.redis = 'ok'; } catch { checks.redis = 'error'; }
  const allOk = Object.values(checks).every(v => v === 'ok');
  res.status(allOk ? 200 : 503).json({ status: allOk ? 'ok' : 'degraded', checks });
});

// Routes — Phase 4 (Auth)
app.use('/api/v1/auth', authRouter);

// Routes — Phase 5 (Organization)
app.use('/api/v1', orgRouter);

// Routes — Phase 6 (Tasks)
app.use('/api/v1', taskRouter);

// Routes — Phase 7 (Chat)
app.use('/api/v1', chatRouter);

// Routes — Phase 8 (Notifications)
app.use('/api/v1', notificationRouter);
app.use('/api/v1', pushRouter);

// Routes — Phase 9 (Payments)
app.use('/api/v1', paymentRouter);

// Routes — Phase 10 (Files)
app.use('/api/v1', fileRouter);

// Routes — Phase 11 (Search)
app.use('/api/v1', searchRouter);

// Routes — Phase 6 (Workspaces)
app.use('/api/v1', workspaceRouter);

// Routes — Phase 13 (Webhooks)
app.use('/api/v1', webhookRouter);

// Routes — Phase 14 (Feature Flags)
app.use('/api/v1', featureFlagRouter);

// Routes — Phase 15 (Platform Admin)
app.use('/api/v1', adminRouter);

// Routes — Phase 16 (GDPR)
app.use('/api/v1', gdprRouter);

// OpenAPI / Swagger UI (TASK-106) — only in non-production or when explicitly enabled
if (config.nodeEnv !== 'production' || process.env.SWAGGER_ENABLED === 'true') {
  // Lazy load to avoid startup cost in production
  import('./shared/observability/openapi').then(({ openApiDoc }) => {
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiDoc));
    logger.info('Swagger UI mounted at /api-docs');
  }).catch(() => {
    // openapi.json not yet generated — silently skip
  });
}

app.use(errorHandlerMiddleware);

async function runMigrations(): Promise<void> {
  const { default: migrate } = await import('node-pg-migrate');
  const path = await import('path');
  await migrate({
    databaseUrl: process.env.DATABASE_URL!,
    migrationsTable: 'pgmigrations',
    direction: 'up',
    dir: path.join(__dirname, '../migrations'),
    log: (msg) => logger.info({ msg }, 'Migration'),
  });
}

async function start(): Promise<void> {
  httpServer.listen(config.port, () => {
    logger.info({ port: config.port }, 'HTTP server listening — /live ready');
  });
  try {
    await runMigrations();
    appReady = true;
    logger.info('Migrations complete. /ready now 200.');
    outboxPoller.start();
    startQueueMetricsCollection();
  } catch (err) {
    logger.error({ err }, 'Migration failed. /ready remains 503.');
  }
}

// Process-level safety nets — catch anything that escapes async error handlers
process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled Promise Rejection — shutting down');
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught Exception — shutting down');
  process.exit(1);
});

// Graceful shutdown — correct ordering (C-05 fix)
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received. Graceful shutdown starting...');
  const forced = setTimeout(() => {
    logger.error('Forced shutdown: 30s drain timeout exceeded.');
    process.exit(1);
  }, 30_000);
  httpServer.close(async () => {
    try {
      await outboxPoller.stop();
      await primaryPool.end();
      if (config.databaseReplicaUrl) await replicaPool.end();
      await closeAllRedisClients();
      clearTimeout(forced);
      logger.info('Graceful shutdown complete.');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  });
});

if (process.env.NODE_ENV !== 'test') {
  start().catch(err => {
    logger.fatal({ err }, 'Fatal startup error');
    process.exit(1);
  });
}

export { app, httpServer };
