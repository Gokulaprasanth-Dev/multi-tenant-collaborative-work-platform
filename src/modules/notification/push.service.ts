// src/modules/notification/push.service.ts
import * as webpush from 'web-push';
import { queryPrimary } from '../../shared/database/pool';
import { config } from '../../shared/config';

if (config.vapidPublicKey && config.vapidPrivateKey) {
  webpush.setVapidDetails(
    config.vapidContact,
    config.vapidPublicKey,
    config.vapidPrivateKey,
  );
}

export interface PushSubscriptionData {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function saveSubscription(
  userId: string,
  orgId: string,
  sub: PushSubscriptionData,
): Promise<void> {
  await queryPrimary(
    `INSERT INTO push_subscriptions (user_id, org_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, endpoint) DO UPDATE
       SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [userId, orgId, sub.endpoint, sub.keys.p256dh, sub.keys.auth],
  );
}

export async function removeSubscription(userId: string, endpoint: string): Promise<void> {
  await queryPrimary(
    `DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2`,
    [userId, endpoint],
  );
}

export async function sendPush(userId: string, payload: object): Promise<void> {
  const { rows } = await queryPrimary<{ endpoint: string; p256dh: string; auth: string }>(
    `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`,
    [userId],
  );
  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          JSON.stringify(payload),
        );
      } catch (err: unknown) {
        if ((err as { statusCode?: number }).statusCode === 410) {
          await queryPrimary(
            `DELETE FROM push_subscriptions WHERE endpoint = $1`,
            [row.endpoint],
          );
        }
      }
    }),
  );
}
