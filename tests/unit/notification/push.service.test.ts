// tests/unit/notification/push.service.test.ts
jest.mock('../../../src/shared/database/pool', () => ({
  queryPrimary: jest.fn(),
  queryReplica:  jest.fn(),
}));
jest.mock('../../../src/shared/config', () => ({
  config: { logLevel: 'silent', nodeEnv: 'test', vapidPublicKey: 'pub', vapidPrivateKey: 'priv', vapidContact: 'mailto:test@test.com' },
}));
jest.mock('web-push', () => ({
  default: {
    setVapidDetails: jest.fn(),
    sendNotification: jest.fn(),
  },
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

import { queryPrimary } from '../../../src/shared/database/pool';
import * as webpush from 'web-push';
import { saveSubscription, removeSubscription, sendPush } from '../../../src/modules/notification/push.service';

const mockQuery = queryPrimary as jest.Mock;
const mockSend  = webpush.sendNotification as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('saveSubscription', () => {
  it('upserts subscription row', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await saveSubscription('user-1', 'org-1', { endpoint: 'https://ep', keys: { p256dh: 'p', auth: 'a' } });
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO push_subscriptions'),
      ['user-1', 'org-1', 'https://ep', 'p', 'a'],
    );
  });
});

describe('removeSubscription', () => {
  it('deletes subscription by endpoint', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await removeSubscription('user-1', 'https://ep');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM push_subscriptions'),
      ['user-1', 'https://ep'],
    );
  });
});

describe('sendPush', () => {
  it('sends push to each subscription', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [
      { endpoint: 'https://ep', p256dh: 'p', auth: 'a' },
    ]});
    mockSend.mockResolvedValueOnce({});
    await sendPush('user-1', { title: 'New notification', body: 'Test' });
    expect(mockSend).toHaveBeenCalledWith(
      { endpoint: 'https://ep', keys: { p256dh: 'p', auth: 'a' } },
      JSON.stringify({ title: 'New notification', body: 'Test' }),
    );
  });

  it('silently deletes expired subscription on 410', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ endpoint: 'https://gone', p256dh: 'p', auth: 'a' }] })
      .mockResolvedValueOnce({ rows: [] });
    const err = Object.assign(new Error('Gone'), { statusCode: 410 });
    mockSend.mockRejectedValueOnce(err);
    await expect(sendPush('user-1', { title: 'Test', body: '' })).resolves.not.toThrow();
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM push_subscriptions'),
      expect.arrayContaining(['https://gone']),
    );
  });
});
