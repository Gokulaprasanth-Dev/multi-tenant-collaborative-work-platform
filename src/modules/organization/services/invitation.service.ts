import { OrganizationRepository } from '../repositories/organization.repository';
import { MembershipRepository } from '../repositories/membership.repository';
import { AuthRepository } from '../../auth/repositories/auth.repository';
import { issueTokenPair } from '../../auth/services/jwt.service';
import { queryPrimary, queryReplica } from '../../../shared/database/pool';
import { config } from '../../../shared/config';
import { hmac, hashToken } from '../../../shared/crypto';
import { ForbiddenError, NotFoundError, AppError } from '../../../shared/errors/app-errors';

const orgRepo = new OrganizationRepository();
const memberRepo = new MembershipRepository();
const authRepo = new AuthRepository();

const INVITATION_TTL_DAYS = 7;

// Authoritative enum (same as TASK-044)
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
     VALUES ($1, $2, 'invitation', $3, $4, $5::jsonb, NOW())`,
    [orgId, eventType, entityId, actorUserId, JSON.stringify(payload)]
  );
}

async function seedNotificationPreferences(orgId: string, userId: string): Promise<void> {
  for (const eventType of NOTIFICATION_EVENT_TYPES) {
    await queryPrimary(
      `INSERT INTO notification_preferences (org_id, user_id, event_type)
       VALUES ($1, $2, $3)
       ON CONFLICT (org_id, user_id, event_type) DO NOTHING`,
      [orgId, userId, eventType]
    );
  }
}

export interface InvitationRow {
  id: string;
  org_id: string;
  invited_by: string;
  email: string;
  role: 'org_admin' | 'member' | 'guest';
  token_hash: string;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

export async function invite(
  orgId: string,
  invitedBy: string,
  email: string,
  role: 'org_admin' | 'member' | 'guest'
): Promise<InvitationRow> {
  const normalizedEmail = email.toLowerCase().trim();

  const org = await orgRepo.findById(orgId);
  if (!org) throw new NotFoundError('Organization');
  if (org.status !== 'active') {
    throw new ForbiddenError('ORG_NOT_ACTIVE', 'Invitations can only be sent for active organizations');
  }

  // Check member limit
  const currentCount = await memberRepo.countActiveMembers(orgId);
  if (currentCount >= org.max_members) {
    throw new ForbiddenError('PLAN_MEMBER_LIMIT_EXCEEDED', 'Organization has reached its member limit');
  }

  // Check no pending invite for this email in org
  const existingInvite = await queryReplica(
    `SELECT id FROM invitations WHERE org_id = $1 AND email = $2 AND status = 'pending' LIMIT 1`,
    [orgId, normalizedEmail]
  );
  if (existingInvite.rows.length > 0) {
    throw new ForbiddenError('INVITATION_ALREADY_PENDING', 'A pending invitation already exists for this email');
  }

  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

  // Generate HMAC token — deterministic from invite payload + timestamp for uniqueness
  const invitePayload = JSON.stringify({ orgId, email: normalizedEmail, role, invitedBy, expiresAt: expiresAt.toISOString() });
  const token = hmac(invitePayload, config.inviteSecret);
  const tokenHash = hashToken(token);

  const result = await queryPrimary(
    `INSERT INTO invitations (org_id, invited_by, email, role, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [orgId, invitedBy, normalizedEmail, role, tokenHash, expiresAt]
  );
  const invitation = result.rows[0] as unknown as InvitationRow;

  await writeOutboxEvent('invitation.created', orgId, invitation.id, invitedBy, {
    invitationId: invitation.id, orgId, email: normalizedEmail, role, token, expiresAt,
  });

  return invitation;
}

export async function acceptInvitation(token: string): Promise<{ tokens: { accessToken: string; refreshToken: string; expiresIn: number }; userId: string }> {
  const tokenHash = hashToken(token);

  const result = await queryPrimary(
    `SELECT * FROM invitations WHERE token_hash = $1 LIMIT 1`,
    [tokenHash]
  );
  const invitation = result.rows[0] as unknown as InvitationRow | undefined;

  if (!invitation) throw new NotFoundError('Invitation');

  if (invitation.status !== 'pending') {
    // 410 Gone for expired/revoked
    throw new AppError(410, 'INVITATION_GONE', 'Invitation has already been used, expired, or revoked');
  }

  if (invitation.expires_at < new Date()) {
    await queryPrimary(`UPDATE invitations SET status = 'expired' WHERE id = $1`, [invitation.id]);
    throw new AppError(410, 'INVITATION_EXPIRED', 'Invitation has expired');
  }

  // Find or create user
  let user = await authRepo.findUserByEmail(invitation.email);
  if (!user) {
    user = await authRepo.createUser({
      email: invitation.email,
      name: invitation.email.split('@')[0],
      email_verified: true,
    });
    await authRepo.createUserPreferences(user.id);
    await authRepo.createAuthProvider({
      user_id: user.id,
      provider: 'email',
      provider_user_id: invitation.email,
    });
  }

  // Create org membership — ON CONFLICT handles race conditions (partial unique index)
  await memberRepo.createMembership({
    org_id: invitation.org_id,
    user_id: user.id,
    role: invitation.role,
    invited_by: invitation.invited_by,
    joined_at: new Date(),
  });

  // Seed notification_preferences for new member
  await seedNotificationPreferences(invitation.org_id, user.id);

  // Mark invitation accepted
  await queryPrimary(
    `UPDATE invitations SET status = 'accepted', accepted_at = NOW() WHERE id = $1`,
    [invitation.id]
  );

  // Write outbox member.joined
  await writeOutboxEvent('member.joined', invitation.org_id, user.id, user.id, {
    orgId: invitation.org_id, userId: user.id, role: invitation.role,
  });

  const tokens = await issueTokenPair(user.id, invitation.org_id, invitation.role, user.is_platform_admin);

  return { tokens, userId: user.id };
}

export async function revokeInvitation(
  orgId: string,
  invitationId: string,
  revokedBy: string
): Promise<void> {
  const result = await queryPrimary(
    `UPDATE invitations SET status = 'revoked', revoked_at = NOW()
     WHERE id = $1 AND org_id = $2 AND status = 'pending'
     RETURNING id`,
    [invitationId, orgId]
  );
  if (result.rows.length === 0) {
    throw new NotFoundError('Invitation');
  }
  await writeOutboxEvent('invitation.revoked', orgId, invitationId, revokedBy, {
    invitationId, orgId, revokedBy,
  });
}
