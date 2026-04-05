import { Socket } from 'socket.io';
import { queryReplica } from '../database/pool';
import { refreshTokenPair } from '../../modules/auth/services/jwt.service';
import { logger } from '../observability/logger';

/**
 * ReconnectHandler:
 * - `client:sync`: sync missed messages since client's last known sequence per channel
 * - `auth:refresh`: refresh JWT token pair
 */

export function registerReconnectHandlers(socket: Socket): void {
  // Sync missed messages
  socket.on('client:sync', async (data: { lastMessageSequences: Record<string, string> }) => {
    const { lastMessageSequences } = data;
    if (!lastMessageSequences || typeof lastMessageSequences !== 'object') return;

    try {
      for (const [channelId, lastSeq] of Object.entries(lastMessageSequences)) {
        const result = await queryReplica<{
          id: string;
          channel_id: string;
          sender_id: string;
          body: string;
          sequence_number: string;
          created_at: string;
        }>(
          `SELECT id, channel_id, sender_id, body, sequence_number, created_at
           FROM chat_messages
           WHERE channel_id = $1 AND sequence_number > $2 AND deleted_at IS NULL
           ORDER BY sequence_number ASC
           LIMIT 100`,
          [channelId, lastSeq]
        );

        if (result.rows.length > 0) {
          socket.emit('client:sync:messages', {
            channelId,
            messages: result.rows,
          });
        }
      }
    } catch (err) {
      logger.warn({ err, userId: socket.data.userId }, 'ReconnectHandler: sync failed');
    }
  });

  // Token refresh
  socket.on('auth:refresh', async (data: { refreshToken: string }) => {
    if (!data.refreshToken) return;

    try {
      const tokenPair = await refreshTokenPair(data.refreshToken);
      socket.emit('auth:tokens', tokenPair);
    } catch {
      socket.emit('auth:session-expired');
    }
  });
}
