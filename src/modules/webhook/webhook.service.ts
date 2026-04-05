import bcrypt from 'bcryptjs';
import * as dns from 'dns';
import ipaddr from 'ipaddr.js';
import { WebhookRepository, WebhookRow } from './webhook.repository';
import { encryptSecret } from '../../shared/crypto';
import { generateSecureToken } from '../../shared/crypto';
import { NotFoundError, UnprocessableError, ForbiddenError } from '../../shared/errors/app-errors';
import { logger } from '../../shared/observability/logger';
import { isEnabled } from '../feature-flag/feature-flag.service';

const webhookRepo = new WebhookRepository();

// SEC-NEW-004: registration-time DNS/IP blocklist check
async function isPrivateOrBlockedUrl(urlStr: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return true;
  }

  if (url.protocol !== 'https:') return true;

  try {
    const resolved = await dns.promises.lookup(url.hostname);
    const parsed = ipaddr.parse(resolved.address);
    return parsed.range() !== 'unicast';
  } catch {
    return true;
  }
}

export interface CreateWebhookInput {
  url: string;
  events: string[];
}

export interface CreateWebhookResult {
  webhook: Omit<WebhookRow, 'secret_hash' | 'secret_encrypted'>;
  secret: string; // returned once only
}

export async function create(
  orgId: string,
  userId: string,
  input: CreateWebhookInput
): Promise<CreateWebhookResult> {
  // Feature flag: feature.webhooks must be enabled for this org (business+ plan)
  const webhooksEnabled = await isEnabled(orgId, 'feature.webhooks');
  if (!webhooksEnabled) {
    throw new ForbiddenError('FEATURE_NOT_ENABLED', 'Webhooks are not enabled for this organization. Upgrade to business plan.');
  }

  // Validate HTTPS URL + DNS/IP blocklist (registration-time)
  if (await isPrivateOrBlockedUrl(input.url)) {
    throw new UnprocessableError('INVALID_WEBHOOK_URL', 'URL must be HTTPS and resolve to a public IP');
  }

  const secret = generateSecureToken(32);
  const secretHash = await bcrypt.hash(secret, 10);
  const secretEncrypted = encryptSecret(secret);
  const secretPreview = secret.slice(-4);

  const webhook = await webhookRepo.create({
    org_id: orgId,
    url: input.url,
    secret_hash: secretHash,
    secret_encrypted: secretEncrypted,
    secret_preview: secretPreview,
    event_types: input.events,
    created_by: userId,
  });

  const { secret_hash: _sh, secret_encrypted: _se, ...safeWebhook } = webhook;

  return { webhook: safeWebhook as Omit<WebhookRow, 'secret_hash' | 'secret_encrypted'>, secret };
}

export async function rotateSecret(
  orgId: string,
  webhookId: string,
  userId: string
): Promise<{ secret: string }> {
  const existing = await webhookRepo.findById(webhookId, orgId);
  if (!existing) throw new NotFoundError('Webhook');

  const newSecret = generateSecureToken(32);
  const newSecretHash = await bcrypt.hash(newSecret, 10);
  const newSecretEncrypted = encryptSecret(newSecret);
  const newSecretPreview = newSecret.slice(-4);
  const newVersion = existing.secret_key_version + 1;

  await webhookRepo.updateSecret(
    webhookId, orgId,
    newSecretHash, newSecretEncrypted, newSecretPreview, newVersion
  );

  logger.info({ webhookId, orgId, userId, newVersion }, 'webhookService: secret rotated');
  return { secret: newSecret };
}

export async function listByOrg(orgId: string): Promise<WebhookRow[]> {
  return webhookRepo.findByOrg(orgId);
}

export async function remove(orgId: string, webhookId: string): Promise<void> {
  const existing = await webhookRepo.findById(webhookId, orgId);
  if (!existing) throw new NotFoundError('Webhook');
  await webhookRepo.softDelete(webhookId, orgId);
}
