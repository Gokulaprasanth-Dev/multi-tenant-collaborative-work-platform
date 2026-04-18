export interface NotificationDto {
  id: string;
  org_id: string;
  user_id: string;
  type: string;
  entity_type: string;
  entity_id: string;
  actor_id: string;
  payload: Record<string, unknown>;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  orgId: string;
  userId: string;
  type: string;
  entityType: string;
  entityId: string;
  actorId: string;
  payload: Record<string, unknown>;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export function toNotification(dto: NotificationDto): Notification {
  return {
    id:         dto.id,
    orgId:      dto.org_id,
    userId:     dto.user_id,
    type:       dto.type,
    entityType: dto.entity_type,
    entityId:   dto.entity_id,
    actorId:    dto.actor_id,
    payload:    dto.payload,
    isRead:     dto.is_read,
    readAt:     dto.read_at,
    createdAt:  dto.created_at,
  };
}

export interface NotificationPreferenceDto {
  event_type: string;
  channel_inapp: boolean;
  channel_email: boolean;
  channel_push: boolean;
  digest_mode: 'realtime' | 'daily_digest';
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
}

export interface NotificationPreference {
  eventType: string;
  channelInapp: boolean;
  channelEmail: boolean;
  channelPush: boolean;
  digestMode: 'realtime' | 'daily_digest';
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
}

export function toNotificationPreference(dto: NotificationPreferenceDto): NotificationPreference {
  return {
    eventType:       dto.event_type,
    channelInapp:    dto.channel_inapp,
    channelEmail:    dto.channel_email,
    channelPush:     dto.channel_push,
    digestMode:      dto.digest_mode,
    quietHoursStart: dto.quiet_hours_start,
    quietHoursEnd:   dto.quiet_hours_end,
  };
}
