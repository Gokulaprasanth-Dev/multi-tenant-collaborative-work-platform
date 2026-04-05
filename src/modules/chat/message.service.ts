import { MessageRepository, ChatMessageRow } from './message.repository';
import { ChannelRepository } from './channel.repository';
import { queryPrimary } from '../../shared/database/pool';
import { AppError, NotFoundError } from '../../shared/errors/app-errors';

const messageRepo = new MessageRepository();
const channelRepo = new ChannelRepository();

/**
 * Assigns the next sequence number for a channel.
 * CRITICAL: Always uses PRIMARY pool — nextval() is a write operation.
 * Never use replica for sequence calls.
 */
async function nextSequence(channelId: string): Promise<bigint> {
  const safeName = 'channel_seq_' + channelId.replace(/-/g, '_');
  const result = await queryPrimary(`SELECT nextval('${safeName}')`);
  return BigInt((result.rows[0] as { nextval: string }).nextval);
}

export interface SendMessageInput {
  channelId: string;
  senderId: string;
  body: string;
  bodyParsed?: Record<string, unknown> | null;
  clientMessageId: string;
  parentMessageId?: string | null;
}

export async function send(
  orgId: string,
  input: SendMessageInput
): Promise<ChatMessageRow> {
  // Verify sender is channel member
  const isMember = await channelRepo.isMember(input.channelId, input.senderId);
  if (!isMember) {
    throw new AppError(403, 'NOT_CHANNEL_MEMBER', 'You are not a member of this channel');
  }

  // Idempotency: if client_message_id already exists, return existing message
  const existing = await messageRepo.findByClientMessageId(input.channelId, input.clientMessageId);
  if (existing) return existing;

  // Validate thread depth — only 1-level threading
  if (input.parentMessageId) {
    // BUG-NEW-005 fix: fetch WITHOUT created_at filter to scan all partitions
    const parent = await messageRepo.findById(input.parentMessageId, input.channelId);
    if (!parent) throw new NotFoundError('ParentMessage');
    if (parent.deleted_at) throw new AppError(422, 'PARENT_DELETED', 'Cannot reply to a deleted message');
    if (parent.parent_message_id !== null) {
      throw new AppError(422, 'THREADING_DEPTH_EXCEEDED', 'Messages can only be nested one level deep');
    }
  }

  // Assign sequence — PRIMARY only
  const sequenceNumber = await nextSequence(input.channelId);

  const message = await messageRepo.create({
    org_id: orgId,
    channel_id: input.channelId,
    sender_id: input.senderId,
    client_message_id: input.clientMessageId,
    sequence_number: sequenceNumber,
    body: input.body,
    body_parsed: input.bodyParsed ?? null,
    parent_message_id: input.parentMessageId ?? null,
  });

  // Write outbox message.created
  await queryPrimary(
    `INSERT INTO outbox_events (org_id, event_type, entity_type, entity_id, actor_user_id, payload, occurred_at)
     VALUES ($1, 'message.created', 'message', $2, $3, $4::jsonb, NOW())`,
    [
      orgId,
      message.id,
      input.senderId,
      JSON.stringify({
        messageId: message.id,
        channelId: input.channelId,
        orgId,
        senderId: input.senderId,
        sequenceNumber: sequenceNumber.toString(),
      }),
    ]
  );

  return message;
}

export async function listMessages(
  orgId: string,
  channelId: string,
  userId: string,
  limit = 50,
  beforeSequence?: bigint
): Promise<ChatMessageRow[]> {
  const isMember = await channelRepo.isMember(channelId, userId);
  if (!isMember) throw new AppError(403, 'NOT_CHANNEL_MEMBER', 'You are not a member of this channel');

  return messageRepo.listByChannel(channelId, limit, beforeSequence);
}

export async function deleteMessage(
  orgId: string,
  messageId: string,
  channelId: string,
  userId: string
): Promise<void> {
  const deleted = await messageRepo.softDelete(orgId, messageId, userId);
  if (!deleted) throw new NotFoundError('Message');
}
