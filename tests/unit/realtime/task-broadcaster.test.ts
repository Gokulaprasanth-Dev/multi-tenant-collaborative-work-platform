/**
 * Unit tests for src/shared/realtime/task-broadcaster.ts
 *
 * Covers:
 * - startTaskBroadcaster subscribes to outbox:events
 * - task.created → emitted to task room AND org room
 * - task.updated / task.deleted / task.status_changed → same as task.created
 * - task.assigned → emitted to assignee's user room + task room
 * - task.commented / comment.created → emitted to task room only
 * - task.mentioned / mention.created → emitted to mentioned user's room
 * - Non-task events (message.created) → ignored
 * - Malformed JSON → ignored without throwing
 */

// ── Hoist mocks ───────────────────────────────────────────────────────────────

const mockSubscribe = jest.fn();
const mockOn = jest.fn();

jest.mock('../../../src/shared/redis/clients', () => ({
  redisClient: {},
  redisPubSubClient: {
    subscribe: mockSubscribe,
    on: mockOn,
  },
}));

const mockEmitToOrg = jest.fn();
const mockEmitToRoom = jest.fn();
const mockEmitToUser = jest.fn();

jest.mock('../../../src/shared/realtime/socket-server', () => ({
  emitToOrg: (...args: unknown[]) => mockEmitToOrg(...args),
  emitToRoom: (...args: unknown[]) => mockEmitToRoom(...args),
  emitToUser: (...args: unknown[]) => mockEmitToUser(...args),
}));

import { startTaskBroadcaster } from '../../../src/shared/realtime/task-broadcaster';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeIo() {
  return {} as any;
}

function makeEvent(eventType: string, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: 'evt-1',
    org_id: 'org-1',
    event_type: eventType,
    entity_type: 'task',
    entity_id: 'task-1',
    actor_user_id: 'user-1',
    payload: { taskId: 'task-1', ...overrides },
    occurred_at: new Date().toISOString(),
  });
}

function getMessageHandler(): (_channel: string, message: string) => void {
  const call = mockOn.mock.calls.find((c: string[]) => c[0] === 'message');
  return call[1];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSubscribe.mockImplementation((_channel: string, cb: (err: Error | null) => void) => cb(null));
});

describe('startTaskBroadcaster', () => {
  it('subscribes to outbox:events channel', () => {
    const io = makeIo();
    startTaskBroadcaster(io);
    expect(mockSubscribe).toHaveBeenCalledWith('outbox:events', expect.any(Function));
  });

  it('task.created → emits to task room and org room', () => {
    const io = makeIo();
    startTaskBroadcaster(io);
    const handler = getMessageHandler();
    handler('outbox:events', makeEvent('task.created'));

    expect(mockEmitToRoom).toHaveBeenCalledWith(io, 'org:org-1:task:task-1', 'task.created', expect.any(Object));
    expect(mockEmitToOrg).toHaveBeenCalledWith(io, 'org-1', 'task.created', expect.any(Object));
  });

  it('task.updated → emits to task room and org room', () => {
    const io = makeIo();
    startTaskBroadcaster(io);
    const handler = getMessageHandler();
    handler('outbox:events', makeEvent('task.updated'));

    expect(mockEmitToRoom).toHaveBeenCalledWith(io, 'org:org-1:task:task-1', 'task.updated', expect.any(Object));
    expect(mockEmitToOrg).toHaveBeenCalledWith(io, 'org-1', 'task.updated', expect.any(Object));
  });

  it('task.deleted → emits to task room and org room', () => {
    const io = makeIo();
    startTaskBroadcaster(io);
    const handler = getMessageHandler();
    handler('outbox:events', makeEvent('task.deleted'));

    expect(mockEmitToRoom).toHaveBeenCalled();
    expect(mockEmitToOrg).toHaveBeenCalled();
  });

  it('task.status_changed → emits to task room and org room', () => {
    const io = makeIo();
    startTaskBroadcaster(io);
    const handler = getMessageHandler();
    handler('outbox:events', makeEvent('task.status_changed'));

    expect(mockEmitToRoom).toHaveBeenCalledWith(io, 'org:org-1:task:task-1', 'task.status_changed', expect.any(Object));
    expect(mockEmitToOrg).toHaveBeenCalledWith(io, 'org-1', 'task.status_changed', expect.any(Object));
  });

  it('task.assigned → emits to assignee user room and task room', () => {
    const io = makeIo();
    startTaskBroadcaster(io);
    const handler = getMessageHandler();
    handler('outbox:events', makeEvent('task.assigned', { assigneeId: 'user-99' }));

    expect(mockEmitToUser).toHaveBeenCalledWith(io, 'org-1', 'user-99', 'task.assigned', expect.any(Object));
    expect(mockEmitToRoom).toHaveBeenCalledWith(io, 'org:org-1:task:task-1', 'task.assigned', expect.any(Object));
    expect(mockEmitToOrg).not.toHaveBeenCalled();
  });

  it('task.assigned without assigneeId → only emits to task room', () => {
    const io = makeIo();
    startTaskBroadcaster(io);
    const handler = getMessageHandler();
    handler('outbox:events', makeEvent('task.assigned'));

    expect(mockEmitToUser).not.toHaveBeenCalled();
    expect(mockEmitToRoom).toHaveBeenCalledWith(io, 'org:org-1:task:task-1', 'task.assigned', expect.any(Object));
  });

  it('task.commented → emits to task room only', () => {
    const io = makeIo();
    startTaskBroadcaster(io);
    const handler = getMessageHandler();
    handler('outbox:events', makeEvent('task.commented'));

    expect(mockEmitToRoom).toHaveBeenCalledWith(io, 'org:org-1:task:task-1', 'task.commented', expect.any(Object));
    expect(mockEmitToOrg).not.toHaveBeenCalled();
    expect(mockEmitToUser).not.toHaveBeenCalled();
  });

  it('comment.created → emits to task room only', () => {
    const io = makeIo();
    startTaskBroadcaster(io);
    const handler = getMessageHandler();
    handler('outbox:events', makeEvent('comment.created'));

    expect(mockEmitToRoom).toHaveBeenCalledWith(io, 'org:org-1:task:task-1', 'comment.created', expect.any(Object));
    expect(mockEmitToOrg).not.toHaveBeenCalled();
  });

  it('task.mentioned → emits to mentioned user only', () => {
    const io = makeIo();
    startTaskBroadcaster(io);
    const handler = getMessageHandler();
    handler('outbox:events', makeEvent('task.mentioned', { mentionedUserId: 'user-55' }));

    expect(mockEmitToUser).toHaveBeenCalledWith(io, 'org-1', 'user-55', 'task.mentioned', expect.any(Object));
    expect(mockEmitToOrg).not.toHaveBeenCalled();
    expect(mockEmitToRoom).not.toHaveBeenCalled();
  });

  it('mention.created → emits to mentioned user only', () => {
    const io = makeIo();
    startTaskBroadcaster(io);
    const handler = getMessageHandler();
    handler('outbox:events', makeEvent('mention.created', { mentionedUserId: 'user-66' }));

    expect(mockEmitToUser).toHaveBeenCalledWith(io, 'org-1', 'user-66', 'mention.created', expect.any(Object));
  });

  it('non-task event (message.created) → ignored', () => {
    const io = makeIo();
    startTaskBroadcaster(io);
    const handler = getMessageHandler();
    handler('outbox:events', makeEvent('message.created'));

    expect(mockEmitToOrg).not.toHaveBeenCalled();
    expect(mockEmitToRoom).not.toHaveBeenCalled();
    expect(mockEmitToUser).not.toHaveBeenCalled();
  });

  it('malformed JSON → ignored without throwing', () => {
    const io = makeIo();
    startTaskBroadcaster(io);
    const handler = getMessageHandler();
    expect(() => handler('outbox:events', '{not json')).not.toThrow();
    expect(mockEmitToOrg).not.toHaveBeenCalled();
  });
});
