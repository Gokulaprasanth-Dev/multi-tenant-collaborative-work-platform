// frontend/src/app/core/models/message.model.ts

export interface Message {
  id: string;
  channelId: string;
  senderUserId: string;
  body: string;
  clientMessageId: string;
  createdAt: string;
  attachments: string[];
}

export interface MessageDto {
  id: string;
  channel_id: string;
  sender_user_id: string;
  body: string;
  client_message_id: string;
  created_at: string;
  attachments?: string[];
}

export function toMessage(dto: MessageDto): Message {
  return {
    id:              dto.id,
    channelId:       dto.channel_id,
    senderUserId:    dto.sender_user_id,
    body:            dto.body,
    clientMessageId: dto.client_message_id,
    createdAt:       dto.created_at,
    attachments:     dto.attachments ?? [],
  };
}
