/**
 * Integration tests for chat/sequence.service.ts
 * Requires DATABASE_URL env var.
 * Run: npm run migrate:test && npm run test:integration
 */

import { v4 as uuidv4 } from 'uuid';
import { sequenceService } from '../../../src/modules/chat/sequence.service';
import { seedUser, seedOrg } from '../../helpers/db';
import { queryPrimary } from '../../../src/shared/database/pool';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

/** Creates a channel and initialises its sequence, returning the channel id. */
async function createChannelWithSequence(orgId: string, createdBy: string): Promise<string> {
  const result = await queryPrimary<{ id: string }>(
    `INSERT INTO channels (org_id, type, created_by) VALUES ($1, 'group', $2) RETURNING id`,
    [orgId, createdBy]
  );
  const channelId = result.rows[0]!.id;

  // Initialise the per-channel PostgreSQL sequence
  await queryPrimary(`SELECT create_channel_sequence($1)`, [channelId]);

  return channelId;
}

maybeDescribe('sequence.service integration', () => {
  let userId: string;
  let orgId: string;
  const createdChannelIds: string[] = [];

  beforeAll(async () => {
    const user = await seedUser();
    userId = user.userId;
    const org = await seedOrg({ ownerId: userId });
    orgId = org.orgId;
  });

  afterAll(async () => {
    // Remove channels created during tests (sequences are dropped with them)
    if (createdChannelIds.length > 0) {
      await queryPrimary(
        `DELETE FROM channels WHERE id = ANY($1)`,
        [createdChannelIds]
      );
    }
  });

  // ── nextSequence tests ────────────────────────────────────────────────────

  it('nextSequence returns a BigInt', async () => {
    const channelId = await createChannelWithSequence(orgId, userId);
    createdChannelIds.push(channelId);

    const val = await sequenceService.nextSequence(channelId);

    expect(typeof val).toBe('bigint');
  });

  it('nextSequence returns incrementing values on consecutive calls', async () => {
    const channelId = await createChannelWithSequence(orgId, userId);
    createdChannelIds.push(channelId);

    const val1 = await sequenceService.nextSequence(channelId);
    const val2 = await sequenceService.nextSequence(channelId);
    const val3 = await sequenceService.nextSequence(channelId);

    expect(val1 < val2).toBe(true);
    expect(val2 < val3).toBe(true);
  });

  it('two different channels have independent sequences', async () => {
    const channelA = await createChannelWithSequence(orgId, userId);
    const channelB = await createChannelWithSequence(orgId, userId);
    createdChannelIds.push(channelA, channelB);

    const seqA1 = await sequenceService.nextSequence(channelA);
    const seqA2 = await sequenceService.nextSequence(channelA);

    const seqB1 = await sequenceService.nextSequence(channelB);
    const seqB2 = await sequenceService.nextSequence(channelB);

    // Each channel's own sequence increments independently
    expect(seqA1 < seqA2).toBe(true);
    expect(seqB1 < seqB2).toBe(true);

    // The two channels start fresh — seqA1 and seqB1 should both be 1
    // (sequences start at 1 by default); crucially they don't share state
    expect(seqA1).toBe(BigInt(1));
    expect(seqB1).toBe(BigInt(1));
  });
});
