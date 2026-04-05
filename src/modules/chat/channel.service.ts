import { ChannelRepository, ChannelRow } from './channel.repository';
import { MembershipRepository } from '../organization/repositories/membership.repository';
import { withTransaction, queryPrimary } from '../../shared/database/pool';
import { AppError, NotFoundError, ForbiddenError } from '../../shared/errors/app-errors';
import { isEnabled } from '../feature-flag/feature-flag.service';

const channelRepo = new ChannelRepository();
const memberRepo = new MembershipRepository();

async function writeOutboxEvent(
  eventType: string,
  orgId: string,
  entityId: string,
  actorUserId: string | null,
  payload: Record<string, unknown>
): Promise<void> {
  await queryPrimary(
    `INSERT INTO outbox_events (org_id, event_type, entity_type, entity_id, actor_user_id, payload, occurred_at)
     VALUES ($1, $2, 'channel', $3, $4, $5::jsonb, NOW())`,
    [orgId, eventType, entityId, actorUserId, JSON.stringify(payload)]
  );
}

/**
 * Creates a direct (1-on-1) channel between two users.
 * COMPLETENESS-008 fix: canonical ordering enforced via LEAST/GREATEST.
 * Audit issue 2.2 fix: create_channel_sequence called INSIDE the same transaction.
 * On PK violation (duplicate pair): return existing channel, do NOT throw 409.
 */
export async function createDirect(
  orgId: string,
  creatorId: string,
  otherUserId: string
): Promise<{ channel: ChannelRow; created: boolean }> {
  if (creatorId === otherUserId) {
    throw new AppError(400, 'CANNOT_DM_SELF', 'Cannot create a direct message channel with yourself');
  }

  // Canonical ordering: user_a_id < user_b_id (UUID string comparison matches CHECK constraint)
  const userAId = creatorId < otherUserId ? creatorId : otherUserId;
  const userBId = creatorId < otherUserId ? otherUserId : creatorId;

  // Validate both users are org members
  const [creatorMembership, otherMembership] = await Promise.all([
    memberRepo.findMembership(orgId, creatorId),
    memberRepo.findMembership(orgId, otherUserId),
  ]);
  if (!creatorMembership) throw new AppError(403, 'NOT_ORG_MEMBER', 'Creator is not an org member');
  if (!otherMembership) throw new NotFoundError('OtherUser');

  try {
    const channel = await withTransaction(async (client) => {
      // 1. Create channel
      const ch = await channelRepo.create(orgId, 'direct', creatorId, null, client);

      // 2. Add both users as members
      await channelRepo.addMember(ch.id, creatorId, orgId, client);
      await channelRepo.addMember(ch.id, otherUserId, orgId, client);

      // 3. Insert direct_channel_pairs (canonical order)
      await channelRepo.insertDirectPair(orgId, userAId, userBId, ch.id, client);

      // 4. CRITICAL (audit issue 2.2 fix): create per-channel sequence inside this transaction
      await client.query(`SELECT create_channel_sequence($1)`, [ch.id]);

      return ch;
    });

    await writeOutboxEvent('channel.created', orgId, channel.id, creatorId, {
      channelId: channel.id, orgId, type: 'direct',
    });

    return { channel, created: true };
  } catch (err: unknown) {
    // PK violation on direct_channel_pairs means the pair already exists
    const pgErr = err as { code?: string };
    if (pgErr.code === '23505') {
      const existing = await channelRepo.findDirectChannel(orgId, userAId, userBId);
      if (existing) return { channel: existing, created: false };
    }
    throw err;
  }
}

/**
 * Creates a group channel.
 * Feature-flagged: 'feature.chat' must be enabled for the org (pro+ plan).
 */
export async function createGroup(
  orgId: string,
  creatorId: string,
  name: string,
  memberIds: string[]
): Promise<ChannelRow> {
  // Feature flag: feature.chat must be enabled for this org (pro+ plan)
  const chatEnabled = await isEnabled(orgId, 'feature.chat');
  if (!chatEnabled) {
    throw new ForbiddenError('FEATURE_NOT_ENABLED', 'Chat is not enabled for this organization. Upgrade to pro plan.');
  }

  if (memberIds.length < 2) {
    throw new AppError(422, 'INSUFFICIENT_MEMBERS', 'Group channels require at least 2 members');
  }

  // Validate all member IDs are org members
  for (const userId of [...new Set([creatorId, ...memberIds])]) {
    const m = await memberRepo.findMembership(orgId, userId);
    if (!m) throw new AppError(422, 'MEMBER_NOT_IN_ORG', `User ${userId} is not an org member`);
  }

  const channel = await withTransaction(async (client) => {
    // 1. Create channel
    const ch = await channelRepo.create(orgId, 'group', creatorId, name, client);

    // 2. Add creator + all specified members
    const allMembers = [...new Set([creatorId, ...memberIds])];
    for (const userId of allMembers) {
      await channelRepo.addMember(ch.id, userId, orgId, client);
    }

    // 3. CRITICAL: create per-channel sequence inside this transaction
    await client.query(`SELECT create_channel_sequence($1)`, [ch.id]);

    return ch;
  });

  await writeOutboxEvent('channel.created', orgId, channel.id, creatorId, {
    channelId: channel.id, orgId, type: 'group', name,
  });

  return channel;
}

export async function getChannel(orgId: string, channelId: string): Promise<ChannelRow> {
  const ch = await channelRepo.findById(channelId);
  if (!ch || ch.org_id !== orgId) throw new NotFoundError('Channel');
  return ch;
}

export async function listChannels(orgId: string): Promise<ChannelRow[]> {
  return channelRepo.findByOrg(orgId);
}

export async function assertChannelMember(channelId: string, userId: string): Promise<void> {
  const isMember = await channelRepo.isMember(channelId, userId);
  if (!isMember) throw new AppError(403, 'NOT_CHANNEL_MEMBER', 'You are not a member of this channel');
}
