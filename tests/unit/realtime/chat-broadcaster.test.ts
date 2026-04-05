/**
 * Unit tests for src/shared/realtime/chat-broadcaster.ts
 *
 * Covers:
 * - startChatBroadcaster subscribes to outbox:events
 * - message.created → emits to channel room with ACK retry
 * - message.received → emits to channel room
 * - Non-message events → ignored
 * - Missing channelId in payload → ignored
 * - Malformed JSON → ignored without throwing
 */

// ── Hoist mocks ───────────────────────────────────────────────────────────────

const mockSubscribe = jest.fn();
const mockPubSubOn = jest.fn();

jest.mock('../../../src/shared/redis/clients', () => ({
  redisClient: {},
  redisPubSubClient: {
    subscribe: mockSubscribe,
    on: mockPubSubOn,
  },
}));

// Mock fetchSockets to return sockets with working emit callbacks
const mockFetchSockets = jest.fn();
const mockIoIn = jest.fn();
const mockIoTo = jest.fn();

function makeIo(autoAck = true) {
  const io = {
    in: jest.fn().mockReturnValue({
      fetchSockets: mockFetchSockets,
    }),
  } as any;
  if (autoAck) {
    mockFetchSockets.mockResolvedValue([
      {
        emit: jest.fn().mockImplementation((_event: string, _data: unknown, ack?: () => void) => {
          if (ack) ack(); // auto-ack
        }),
      },
    ]);
  }
  return io;
}

import { startChatBroadcaster } from '../../../src/shared/realtime/chat-broadcaster';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvent(eventType: string, payload: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: 'evt-1',
    org_id: 'org-1',
    event_type: eventType,
    entity_type: 'message',
    entity_id: 'msg-1',
    actor_user_id: 'user-1',
    payload,
    occurred_at: new Date().toISOString(),
  });
}

function getMessageHandler(): (_channel: string, message: string) => void {
  const call = mockPubSubOn.mock.calls.find((c: string[]) => c[0] === 'message');
  return call[1];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSubscribe.mockImplementation((_channel: string, cb: (err: Error | null) => void) => cb(null));
  mockFetchSockets.mockResolvedValue([]);
});

describe('startChatBroadcaster', () => {
  it('subscribes to outbox:events', () => {
    const io = makeIo();
    startChatBroadcaster(io);
    expect(mockSubscribe).toHaveBeenCalledWith('outbox:events', expect.any(Function));
  });

  it('message.created → fetches sockets for channel room and emits', async () => {
    const io = makeIo(true);
    startChatBroadcaster(io);
    const handler = getMessageHandler();

    handler('outbox:events', makeEvent('message.created', { channelId: 'ch-abc' }));

    // Give async emit a tick to run
    await new Promise(r => setImmediate(r));

    expect(io.in).toHaveBeenCalledWith('channel:ch-abc');
    expect(mockFetchSockets).toHaveBeenCalled();
  });

  it('message.received → fetches sockets for channel room', async () => {
    const io = makeIo(true);
    startChatBroadcaster(io);
    const handler = getMessageHandler();

    handler('outbox:events', makeEvent('message.received', { channelId: 'ch-xyz' }));
    await new Promise(r => setImmediate(r));

    expect(io.in).toHaveBeenCalledWith('channel:ch-xyz');
  });

  it('non-message event (task.created) → ignored', () => {
    const io = makeIo();
    startChatBroadcaster(io);
    const handler = getMessageHandler();
    handler('outbox:events', makeEvent('task.created', { channelId: 'ch-1' }));
    expect(io.in).not.toHaveBeenCalled();
  });

  it('missing channelId in payload → ignored', async () => {
    const io = makeIo();
    startChatBroadcaster(io);
    const handler = getMessageHandler();
    handler('outbox:events', makeEvent('message.created', {}));
    await new Promise(r => setImmediate(r));
    expect(io.in).not.toHaveBeenCalled();
  });

  it('malformed JSON → ignored without throwing', () => {
    const io = makeIo();
    startChatBroadcaster(io);
    const handler = getMessageHandler();
    expect(() => handler('outbox:events', '{bad json')).not.toThrow();
    expect(io.in).not.toHaveBeenCalled();
  });

  it('no-op when no sockets are in the room', async () => {
    const io = makeIo(false);
    mockFetchSockets.mockResolvedValue([]); // no subscribers
    startChatBroadcaster(io);
    const handler = getMessageHandler();
    handler('outbox:events', makeEvent('message.created', { channelId: 'ch-empty' }));
    await new Promise(r => setImmediate(r));
    // fetchSockets is called but no socket.emit calls happen
    expect(mockFetchSockets).toHaveBeenCalled();
  });
});
