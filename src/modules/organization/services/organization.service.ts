import { OrganizationRepository, OrgRow, UpdateOrgData } from '../repositories/organization.repository';
import { MembershipRepository } from '../repositories/membership.repository';
import { persistAuditLog } from '../../audit/workers/audit.worker';
import { withTransaction, queryPrimary } from '../../../shared/database/pool';
import { logger } from '../../../shared/observability/logger';
import { NotFoundError, ForbiddenError, ConflictError } from '../../../shared/errors/app-errors';

const orgRepo = new OrganizationRepository();
const memberRepo = new MembershipRepository();

// Authoritative enum — NOTIFICATION EVENT SEEDING (audit issue 2.9 fix)
const NOTIFICATION_EVENT_TYPES = [
  'task.assigned', 'task.updated', 'task.status_changed', 'task.commented',
  'task.mentioned', 'task.due_soon', 'message.received', 'mention.created',
  'member.joined', 'member.removed', 'file.quarantined', 'org.suspended',
  'payment.failed', 'invitation.created',
];

async function writeOutboxEvent(
  eventType: string,
  orgId: string,
  entityId: string,
  actorUserId: string | null,
  payload: Record<string, unknown>
): Promise<void> {
  await queryPrimary(
    `INSERT INTO outbox_events (org_id, event_type, entity_type, entity_id, actor_user_id, payload, occurred_at)
     VALUES ($1, $2, 'org', $3, $4, $5::jsonb, NOW())`,
    [orgId, eventType, entityId, actorUserId, JSON.stringify(payload)]
  );
}

export interface CreateOrgInput {
  name: string;
  slug: string;
  timezone?: string;
  locale?: string;
}

export async function createOrg(userId: string, data: CreateOrgInput): Promise<OrgRow> {
  // Check slug uniqueness before entering transaction
  const existingSlug = await orgRepo.findBySlug(data.slug);
  if (existingSlug) {
    throw new ConflictError('SLUG_TAKEN', 'Organization slug is already in use');
  }

  const org = await withTransaction(async (client) => {
    // 1. Create org record
    const newOrg = await orgRepo.create(data, client);

    // 2. Create default workspace
    await client.query(
      `INSERT INTO workspaces (org_id, name, owner_user_id) VALUES ($1, $2, $3)`,
      [newOrg.id, 'Default Workspace', userId]
    );

    // 3. Add creator as org_owner in org_memberships
    await memberRepo.createMembership(
      { org_id: newOrg.id, user_id: userId, role: 'org_owner', joined_at: new Date() },
      client
    );

    // 4. Seed notification_preferences for all event types (audit issue 2.9 fix)
    for (const eventType of NOTIFICATION_EVENT_TYPES) {
      await client.query(
        `INSERT INTO notification_preferences (org_id, user_id, event_type)
         VALUES ($1, $2, $3)
         ON CONFLICT (org_id, user_id, event_type) DO NOTHING`,
        [newOrg.id, userId, eventType]
      );
    }

    // 5. Create free subscriptions row
    await client.query(
      `INSERT INTO subscriptions (org_id, plan_tier, status) VALUES ($1, 'free', 'active')`,
      [newOrg.id]
    );

    return newOrg;
  });

  // After commit: write outbox org.created
  await writeOutboxEvent('org.created', org.id, org.id, userId, { orgId: org.id, name: org.name, userId });

  return org;
}

export async function getOrg(orgId: string): Promise<OrgRow> {
  const org = await orgRepo.findById(orgId);
  if (!org) throw new NotFoundError('Organization');
  return org;
}

export async function updateOrg(
  orgId: string,
  data: UpdateOrgData,
  expectedVersion: number
): Promise<OrgRow> {
  const updated = await orgRepo.update(orgId, data, expectedVersion);
  if (!updated) {
    // Distinguish between not-found and version conflict
    const existing = await orgRepo.findById(orgId);
    if (!existing) throw new NotFoundError('Organization');
    throw new ConflictError('VERSION_CONFLICT', 'Organization was modified by another request');
  }
  return updated;
}

export async function suspendOrg(orgId: string, reason: string, actorId?: string): Promise<void> {
  const org = await orgRepo.findById(orgId);
  if (!org) throw new NotFoundError('Organization');

  // BUG-NEW-003 fix: validate status BEFORE transitioning
  if (org.status !== 'active') {
    logger.warn({ orgId, currentStatus: org.status }, 'suspendOrg called on non-active org — skipping');
    return;
  }

  await orgRepo.updateStatus(orgId, 'suspended');

  await writeOutboxEvent('org.suspended', orgId, orgId, actorId ?? null, { orgId, reason });

  await persistAuditLog({
    orgId,
    actorId,
    actorType: actorId ? 'user' : 'system',
    eventType: 'org.suspended',
    entityType: 'org',
    entityId: orgId,
    payload: { reason },
  });
}

export async function reactivateOrg(orgId: string, actorId?: string): Promise<void> {
  const org = await orgRepo.findById(orgId);
  if (!org) throw new NotFoundError('Organization');

  if (org.status !== 'suspended') {
    throw new ForbiddenError('INVALID_STATUS_TRANSITION', 'Only suspended organizations can be reactivated');
  }

  await orgRepo.updateStatus(orgId, 'active');

  await writeOutboxEvent('org.reactivated', orgId, orgId, actorId ?? null, { orgId });

  await persistAuditLog({
    orgId,
    actorId,
    actorType: actorId ? 'user' : 'system',
    eventType: 'org.reactivated',
    entityType: 'org',
    entityId: orgId,
  });
}

export async function startOffboarding(orgId: string, actorId?: string): Promise<void> {
  const org = await orgRepo.findById(orgId);
  if (!org) throw new NotFoundError('Organization');

  if (org.status !== 'active' && org.status !== 'suspended') {
    throw new ForbiddenError('INVALID_STATUS_TRANSITION', 'Offboarding can only start from active or suspended status');
  }

  const now = new Date();
  await orgRepo.updateStatus(orgId, 'offboarding', { offboarding_started_at: now });

  await writeOutboxEvent('org.offboarding_started', orgId, orgId, actorId ?? null, { orgId });

  await persistAuditLog({
    orgId,
    actorId,
    actorType: actorId ? 'user' : 'system',
    eventType: 'org.offboarding_started',
    entityType: 'org',
    entityId: orgId,
  });
}
