import { redisClient } from '../redis/clients';

const PRESENCE_TTL = 90; // seconds
const TYPING_TTL = 5;    // seconds

export async function setOnline(userId: string, orgId: string): Promise<void> {
  await redisClient.hset(`presence:${orgId}`, userId, 'online');
  await redisClient.expire(`presence:${orgId}`, PRESENCE_TTL);
}

export async function setOffline(userId: string, orgId: string): Promise<void> {
  await redisClient.hdel(`presence:${orgId}`, userId);
}

export async function heartbeat(userId: string, orgId: string): Promise<void> {
  await redisClient.hset(`presence:${orgId}`, userId, 'online');
  await redisClient.expire(`presence:${orgId}`, PRESENCE_TTL);
}

export async function getStatus(userId: string, orgId: string): Promise<'online' | 'offline'> {
  const status = await redisClient.hget(`presence:${orgId}`, userId);
  return status === 'online' ? 'online' : 'offline';
}

export async function setTyping(userId: string, channelId: string): Promise<void> {
  await redisClient.set(`typing:${channelId}:${userId}`, '1', 'EX', TYPING_TTL);
}

export async function clearTyping(userId: string, channelId: string): Promise<void> {
  await redisClient.del(`typing:${channelId}:${userId}`);
}

export async function getTypingUsers(channelId: string): Promise<string[]> {
  const prefix = `typing:${channelId}:`;
  const keys = await redisClient.keys(`${prefix}*`);
  return keys.map(k => k.slice(prefix.length)).filter(Boolean);
}
