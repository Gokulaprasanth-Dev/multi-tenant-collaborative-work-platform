import { queryPrimary } from '../../shared/database/pool';

export class SequenceService {
  /**
   * Returns the next sequence number for a channel.
   *
   * IMPORTANT: Always uses PRIMARY pool — never replica.
   * nextval() on a sequence is a write operation (increments sequence state).
   *
   * The sequence `channel_seq_{channelId}` is created by `create_channel_sequence`
   * (called in the channel creation transaction) before this method is ever called.
   *
   * Scale note: At >100K channels, migrate to Redis INCR with DB high-water mark sync.
   * See docs/RUNBOOK.md §6.1 for migration path.
   */
  async nextSequence(channelId: string): Promise<bigint> {
    // safeName is UUID-derived (hex + hyphens replaced by underscores) — no user input
    const safeName = 'channel_seq_' + channelId.replace(/-/g, '_');
    const result = await queryPrimary<{ nextval: string }>(
      `SELECT nextval('${safeName}')`
    );
    return BigInt(result.rows[0]!.nextval);
  }
}

export const sequenceService = new SequenceService();
