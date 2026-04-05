/**
 * Unit tests for src/shared/realtime/reconnect.handler.ts
 *
 * Covers:
 * - registerReconnectHandlers registers 'client:sync' and 'auth:refresh' event handlers
 * - client:sync: emits client:sync:messages for channels with missed messages
 * - client:sync: no-op when lastMessageSequences is missing or invalid
 * - client:sync: no-op when no missed messages exist
 * - auth:refresh: emits auth:tokens on success
 * - auth:refresh: emits auth:session-expired on failure
 * - auth:refresh: no-op when refreshToken is missing
 */

// ── Hoist mocks ───────────────────────────────────────────────────────────────

const mockQueryReplica = jest.fn();
jest.mock('../../../src/shared/database/pool', () => ({
  queryReplica: (...args: unknown[]) => mockQueryReplica(...args),
  queryPrimary: jest.fn(),
}));

const mockRefreshTokenPair = jest.fn();
jest.mock('../../../src/modules/auth/services/jwt.service', () => ({
  refreshTokenPair: (...args: unknown[]) => mockRefreshTokenPair(...args),
}));

import { registerReconnectHandlers } from '../../../src/shared/realtime/reconnect.handler';

// ── Mock socket ───────────────────────────────────────────────────────────────

function makeSocket() {
  const handlers: Record<string, (data: unknown) => void | Promise<void>> = {};
  return {
    on: jest.fn((event: string, handler: (data: unknown) => void | Promise<void>) => {
      handlers[event] = handler;
    }),
    emit: jest.fn(),
    data: { userId: 'user-1' },
    _trigger: async (event: string, data: unknown) => {
      await handlers[event]?.(data);
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQueryReplica.mockResolvedValue({ rows: [] });
});

describe('registerReconnectHandlers', () => {
  it('registers client:sync and auth:refresh handlers', () => {
    const socket = makeSocket();
    registerReconnectHandlers(socket as any);
    expect(socket.on).toHaveBeenCalledWith('client:sync', expect.any(Function));
    expect(socket.on).toHaveBeenCalledWith('auth:refresh', expect.any(Function));
  });

  describe('client:sync', () => {
    it('emits client:sync:messages when missed messages exist', async () => {
      const socket = makeSocket();
      registerReconnectHandlers(socket as any);

      const missedMessages = [
        { id: 'msg-1', channel_id: 'ch-1', sender_id: 'user-2', body: 'hello', sequence_number: '5', created_at: new Date().toISOString() },
      ];
      mockQueryReplica.mockResolvedValue({ rows: missedMessages });

      await socket._trigger('client:sync', { lastMessageSequences: { 'ch-1': '4' } });

      expect(mockQueryReplica).toHaveBeenCalledWith(
        expect.stringContaining('sequence_number > $2'),
        ['ch-1', '4']
      );
      expect(socket.emit).toHaveBeenCalledWith('client:sync:messages', {
        channelId: 'ch-1',
        messages: missedMessages,
      });
    });

    it('does not emit when no missed messages', async () => {
      const socket = makeSocket();
      registerReconnectHandlers(socket as any);
      mockQueryReplica.mockResolvedValue({ rows: [] });

      await socket._trigger('client:sync', { lastMessageSequences: { 'ch-1': '10' } });

      expect(socket.emit).not.toHaveBeenCalled();
    });

    it('handles multiple channels', async () => {
      const socket = makeSocket();
      registerReconnectHandlers(socket as any);

      mockQueryReplica
        .mockResolvedValueOnce({ rows: [{ id: 'msg-1', channel_id: 'ch-1', sender_id: 'u', body: 'a', sequence_number: '2', created_at: '' }] })
        .mockResolvedValueOnce({ rows: [] });

      await socket._trigger('client:sync', { lastMessageSequences: { 'ch-1': '1', 'ch-2': '5' } });

      expect(socket.emit).toHaveBeenCalledTimes(1);
      expect(socket.emit).toHaveBeenCalledWith('client:sync:messages', expect.objectContaining({ channelId: 'ch-1' }));
    });

    it('is a no-op when lastMessageSequences is missing', async () => {
      const socket = makeSocket();
      registerReconnectHandlers(socket as any);
      await socket._trigger('client:sync', {});
      expect(mockQueryReplica).not.toHaveBeenCalled();
    });

    it('is a no-op when lastMessageSequences is not an object', async () => {
      const socket = makeSocket();
      registerReconnectHandlers(socket as any);
      await socket._trigger('client:sync', { lastMessageSequences: 'bad' });
      expect(mockQueryReplica).not.toHaveBeenCalled();
    });
  });

  describe('auth:refresh', () => {
    it('emits auth:tokens on successful refresh', async () => {
      const socket = makeSocket();
      registerReconnectHandlers(socket as any);

      const tokenPair = { accessToken: 'new-access', refreshToken: 'new-refresh' };
      mockRefreshTokenPair.mockResolvedValue(tokenPair);

      await socket._trigger('auth:refresh', { refreshToken: 'old-refresh' });

      expect(mockRefreshTokenPair).toHaveBeenCalledWith('old-refresh');
      expect(socket.emit).toHaveBeenCalledWith('auth:tokens', tokenPair);
    });

    it('emits auth:session-expired when refresh fails', async () => {
      const socket = makeSocket();
      registerReconnectHandlers(socket as any);
      mockRefreshTokenPair.mockRejectedValue(new Error('expired'));

      await socket._trigger('auth:refresh', { refreshToken: 'bad-token' });

      expect(socket.emit).toHaveBeenCalledWith('auth:session-expired');
    });

    it('is a no-op when refreshToken is missing', async () => {
      const socket = makeSocket();
      registerReconnectHandlers(socket as any);
      await socket._trigger('auth:refresh', {});
      expect(mockRefreshTokenPair).not.toHaveBeenCalled();
    });
  });
});
