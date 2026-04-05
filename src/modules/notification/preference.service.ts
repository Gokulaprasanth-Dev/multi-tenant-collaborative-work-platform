import { NotificationRepository, NotificationPreferenceRow } from './notification.repository';

const notifRepo = new NotificationRepository();

const DEFAULT_PREFERENCE: Omit<NotificationPreferenceRow,
  'id' | 'org_id' | 'user_id' | 'event_type' | 'created_at' | 'updated_at'
> = {
  channel_inapp: true,
  channel_email: true,
  channel_push: false,
  digest_mode: 'realtime',
  quiet_hours_start: null,
  quiet_hours_end: null,
};

/**
 * Returns preference for a user+event, falling back to defaults if not found.
 * No preference row means the user hasn't overridden the default — defaults apply.
 */
export async function getOrDefault(
  orgId: string,
  userId: string,
  eventType: string
): Promise<NotificationPreferenceRow> {
  const existing = await notifRepo.findPreference(orgId, userId, eventType);
  if (existing) return existing;

  // Return synthetic default (no DB write — lazy)
  return {
    id: '',
    org_id: orgId,
    user_id: userId,
    event_type: eventType,
    created_at: new Date(),
    updated_at: new Date(),
    ...DEFAULT_PREFERENCE,
  };
}

export async function updatePreference(
  orgId: string,
  userId: string,
  eventType: string,
  data: Partial<Pick<NotificationPreferenceRow,
    'channel_inapp' | 'channel_email' | 'channel_push' | 'digest_mode' |
    'quiet_hours_start' | 'quiet_hours_end'
  >>
): Promise<NotificationPreferenceRow> {
  return notifRepo.upsertPreference(orgId, userId, eventType, data);
}

export async function listPreferences(orgId: string, userId: string): Promise<NotificationPreferenceRow[]> {
  return notifRepo.listPreferences(orgId, userId);
}
