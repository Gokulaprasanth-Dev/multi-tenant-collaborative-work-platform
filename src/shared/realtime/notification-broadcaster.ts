import { Server } from 'socket.io';
import { redisPubSubClient } from '../redis/clients';

export async function startNotificationBroadcaster(io: Server): Promise<void> {
  redisPubSubClient.on('pmessage', (_pattern: string, channel: string, message: string) => {
    // channel format: notification:{orgId}:user:{userId}
    const parts  = channel.split(':');
    const orgId  = parts[1];
    const userId = parts[3];
    try {
      const row = JSON.parse(message) as Record<string, unknown>;
      io.to(`org:${orgId}:user:${userId}`).emit('notification:new', row);
    } catch {
      // malformed message — ignore
    }
  });
  await redisPubSubClient.psubscribe('notification:*');
}
