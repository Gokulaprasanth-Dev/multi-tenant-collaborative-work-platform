import { z } from 'zod';
import * as dotenv from 'dotenv';
dotenv.config();

const schema = z.object({
  databaseUrl: z.string().min(1, 'DATABASE_URL required'),
  databaseReplicaUrl: z.string().optional(),
  redisUrl: z.string().default('redis://localhost:6379'),
  redisSentinelHosts: z.string().optional(),
  redisPassword: z.string().optional(),
  jwtPrivateKey: z.string().min(1, 'JWT_PRIVATE_KEY required'),
  jwtPublicKey: z.string().min(1, 'JWT_PUBLIC_KEY required'),
  jwtAccessTokenTtl: z.coerce.number().int().positive().default(900),
  encryptionKey: z.string().regex(/^[0-9a-f]{64}$/i, 'ENCRYPTION_KEY must be exactly 64 hex chars (32 bytes)'),
  inviteSecret: z.string().min(32, 'INVITE_SECRET must be at least 32 chars'),
  metricsToken: z.string().min(16, 'METRICS_TOKEN must be at least 16 chars'),
  port: z.coerce.number().int().positive().default(3000),
  nodeEnv: z.enum(['development', 'production', 'test', 'staging']).default('development'),
  logLevel: z.string().default('info'),
  corsOrigins: z.string().default('http://localhost:3000'),
  storageProvider: z.enum(['local', 's3']).default('local'),
  awsRegion: z.string().optional(),
  awsS3Bucket: z.string().optional(),
  awsS3Endpoint: z.string().url().optional().or(z.literal('')).transform(v => v || undefined),
  razorpayKeyId: z.string().min(1, 'RAZORPAY_KEY_ID required'),
  razorpayKeySecret: z.string().min(1, 'RAZORPAY_KEY_SECRET required'),
  razorpayWebhookSecret: z.string().min(1, 'RAZORPAY_WEBHOOK_SECRET required'),
  emailProvider: z.enum(['ses', 'sendgrid', 'smtp']).default('sendgrid'),
  awsSesRegion: z.string().optional(),
  awsSesFromEmail: z.string().optional(),
  sendgridApiKey: z.string().optional(),
  smtpHost: z.string().default('localhost'),
  smtpPort: z.coerce.number().int().positive().default(1025),
  smtpSecure: z.coerce.boolean().default(false),
  smtpUser: z.string().optional(),
  smtpPass: z.string().optional(),
  smtpFromEmail: z.string().default('dev@localhost'),
  searchProvider: z.enum(['postgres', 'typesense']).default('postgres'),
  typesenseUrl: z.string().url().optional().or(z.literal('')).transform(v => v || undefined),
  typesenseApiKey: z.string().optional(),
  platformAdminIpAllowlist: z.string().optional(),
  platformAdminTrustedProxy: z.string().default('loopback'),
  clamavHost: z.string().default('clamav'),
  clamavPort: z.coerce.number().int().positive().default(3310),
  virusScanEnabled: z.coerce.boolean().default(false),
  otlpEndpoint: z.string().url().optional().or(z.literal('')).transform(v => v || undefined),
  outboxPollBatchSize: z.coerce.number().int().positive().default(100),
  testDatabaseUrl: z.string().optional(), // optional — required assertion in test setup only
  loadtestOrgId: z.string().optional(),
  loadtestUserPrefix: z.string().default('loadtest_user_'),
  livekitUrl: z.string().optional(),
  livekitApiKey: z.string().optional(),
  livekitApiSecret: z.string().optional(),
  vapidPublicKey: z.string().default(''),
  vapidPrivateKey: z.string().default(''),
  vapidContact: z.string().default('mailto:admin@example.com'),
});

const parsed = schema.safeParse({
  databaseUrl: process.env.DATABASE_URL,
  databaseReplicaUrl: process.env.DATABASE_REPLICA_URL,
  redisUrl: process.env.REDIS_URL,
  redisSentinelHosts: process.env.REDIS_SENTINEL_HOSTS,
  redisPassword: process.env.REDIS_PASSWORD,
  jwtPrivateKey: process.env.JWT_PRIVATE_KEY_BASE64
    ? Buffer.from(process.env.JWT_PRIVATE_KEY_BASE64, 'base64').toString('utf8')
    : process.env.JWT_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  jwtPublicKey: process.env.JWT_PUBLIC_KEY_BASE64
    ? Buffer.from(process.env.JWT_PUBLIC_KEY_BASE64, 'base64').toString('utf8')
    : process.env.JWT_PUBLIC_KEY?.replace(/\\n/g, '\n'),
  jwtAccessTokenTtl: process.env.JWT_ACCESS_TOKEN_TTL,
  encryptionKey: process.env.ENCRYPTION_KEY,
  inviteSecret: process.env.INVITE_SECRET,
  metricsToken: process.env.METRICS_TOKEN,
  port: process.env.PORT,
  nodeEnv: process.env.NODE_ENV,
  logLevel: process.env.LOG_LEVEL,
  corsOrigins: process.env.CORS_ORIGINS,
  storageProvider: process.env.STORAGE_PROVIDER,
  awsRegion: process.env.AWS_REGION,
  awsS3Bucket: process.env.AWS_S3_BUCKET,
  awsS3Endpoint: process.env.AWS_S3_ENDPOINT || undefined,
  razorpayKeyId: process.env.RAZORPAY_KEY_ID,
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET,
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  emailProvider: process.env.EMAIL_PROVIDER,
  awsSesRegion: process.env.AWS_SES_REGION,
  awsSesFromEmail: process.env.AWS_SES_FROM_EMAIL,
  sendgridApiKey: process.env.SENDGRID_API_KEY,
  smtpHost: process.env.SMTP_HOST,
  smtpPort: process.env.SMTP_PORT,
  smtpSecure: process.env.SMTP_SECURE,
  smtpUser: process.env.SMTP_USER,
  smtpPass: process.env.SMTP_PASS,
  smtpFromEmail: process.env.SMTP_FROM_EMAIL,
  searchProvider: process.env.SEARCH_PROVIDER,
  typesenseUrl: process.env.TYPESENSE_URL || undefined,
  typesenseApiKey: process.env.TYPESENSE_API_KEY || undefined,
  platformAdminIpAllowlist: process.env.PLATFORM_ADMIN_IP_ALLOWLIST,
  platformAdminTrustedProxy: process.env.PLATFORM_ADMIN_TRUSTED_PROXY,
  clamavHost: process.env.CLAMAV_HOST,
  clamavPort: process.env.CLAMAV_PORT,
  virusScanEnabled: process.env.VIRUS_SCAN_ENABLED,
  otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  outboxPollBatchSize: process.env.OUTBOX_POLL_BATCH_SIZE,
  testDatabaseUrl: process.env.TEST_DATABASE_URL,
  loadtestOrgId: process.env.LOADTEST_ORG_ID,
  loadtestUserPrefix: process.env.LOADTEST_USER_PREFIX,
  livekitUrl: process.env.LIVEKIT_URL,
  livekitApiKey: process.env.LIVEKIT_API_KEY,
  livekitApiSecret: process.env.LIVEKIT_API_SECRET,
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY,
  vapidContact: process.env.VAPID_CONTACT,
});

if (!parsed.success) {
  console.error('❌ Config validation failed:');
  parsed.error.issues.forEach(i => console.error(`  ${i.path.join('.')}: ${i.message}`));
  process.exit(1);
}

export const config = parsed.data;

// CORS production guard (C-02 fix)
if (config.nodeEnv === 'production' && config.corsOrigins === '*') {
  console.error('❌ CORS_ORIGINS must not be wildcard (*) in production.');
  process.exit(1);
}
