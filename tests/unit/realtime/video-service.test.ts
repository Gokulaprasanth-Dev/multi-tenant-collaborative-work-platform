/**
 * Unit tests for src/shared/realtime/video.service.ts
 *
 * Covers:
 * - handleCallJoin: emits error when feature flag is disabled
 * - handleCallJoin: joins socket room, updates Redis state, upserts DB row, emits participant-joined
 * - handleCallLeave: leaves room, removes from Redis, ends call in DB when empty, emits participant-left
 * - handleCallLeave: does NOT end call in DB when other participants remain
 * - handleCallOffer: forwards offer to target user room
 * - handleCallAnswer: forwards answer to target user room
 * - handleIceCandidate: forwards ICE candidate to target user room
 */

// ── Hoist mocks ───────────────────────────────────────────────────────────────

const mockQueryPrimary = jest.fn();
jest.mock('../../../src/shared/database/pool', () => ({
  queryPrimary: (...args: unknown[]) => mockQueryPrimary(...args),
  queryReplica: jest.fn(),
}));

const mockHset = jest.fn();
const mockSadd = jest.fn();
const mockExpire = jest.fn();
const mockSrem = jest.fn();
const mockScard = jest.fn();

jest.mock('../../../src/shared/redis/clients', () => ({
  redisClient: {
    hset: (...args: unknown[]) => mockHset(...args),
    sadd: (...args: unknown[]) => mockSadd(...args),
    expire: (...args: unknown[]) => mockExpire(...args),
    srem: (...args: unknown[]) => mockSrem(...args),
    scard: (...args: unknown[]) => mockScard(...args),
  },
  redisPubSubClient: {},
}));

const mockIsEnabled = jest.fn();
jest.mock('../../../src/modules/feature-flag/feature-flag.service', () => ({
  isEnabled: (...args: unknown[]) => mockIsEnabled(...args),
}));

jest.mock('../../../src/shared/config', () => ({
  config: {
    logLevel: 'silent',
    nodeEnv: 'test',
  },
}));

import {
  handleCallJoin,
  handleCallLeave,
  handleCallOffer,
  handleCallAnswer,
  handleIceCandidate,
} from '../../../src/shared/realtime/video.service';

// ── Socket / IO helpers ───────────────────────────────────────────────────────

function makeSocket(userId = 'user-1', orgId = 'org-1') {
  return {
    data: { userId, orgId },
    join: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn(),
  } as any;
}

function makeIo() {
  const emitMock = jest.fn();
  const toMock = jest.fn().mockReturnValue({ emit: emitMock });
  return { to: toMock, _emit: emitMock } as any;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockQueryPrimary.mockResolvedValue({ rows: [], rowCount: 0 });
  mockHset.mockResolvedValue(1);
  mockSadd.mockResolvedValue(1);
  mockExpire.mockResolvedValue(1);
  mockSrem.mockResolvedValue(1);
  mockScard.mockResolvedValue(0);
  mockIsEnabled.mockResolvedValue(true);
});

describe('handleCallJoin', () => {
  it('emits error and returns early when feature flag is disabled', async () => {
    mockIsEnabled.mockResolvedValue(false);
    const socket = makeSocket();
    const io = makeIo();

    await handleCallJoin(socket, io, { callId: 'call-1', channelId: 'ch-1' });

    expect(socket.emit).toHaveBeenCalledWith('error', {
      code: 'FEATURE_NOT_ENABLED',
      message: expect.any(String),
    });
    expect(socket.join).not.toHaveBeenCalled();
    expect(mockHset).not.toHaveBeenCalled();
    expect(mockQueryPrimary).not.toHaveBeenCalled();
  });

  it('joins socket to call room', async () => {
    const socket = makeSocket();
    const io = makeIo();

    await handleCallJoin(socket, io, { callId: 'call-1', channelId: 'ch-1' });

    expect(socket.join).toHaveBeenCalledWith('call:call-1');
  });

  it('stores call state and participants in Redis with TTL', async () => {
    const socket = makeSocket('user-1', 'org-1');
    const io = makeIo();

    await handleCallJoin(socket, io, { callId: 'call-1', channelId: 'ch-1' });

    expect(mockHset).toHaveBeenCalledWith(
      'call:state:call-1',
      'callId', 'call-1',
      'channelId', 'ch-1',
      'orgId', 'org-1'
    );
    expect(mockSadd).toHaveBeenCalledWith('call:participants:call-1', 'user-1');
    expect(mockExpire).toHaveBeenCalledWith('call:state:call-1', expect.any(Number));
    expect(mockExpire).toHaveBeenCalledWith('call:participants:call-1', expect.any(Number));
  });

  it('upserts video_calls row in DB with correct state column and initiator_id', async () => {
    const socket = makeSocket('user-1', 'org-1');
    const io = makeIo();

    await handleCallJoin(socket, io, { callId: 'call-1', channelId: 'ch-1' });

    expect(mockQueryPrimary).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO video_calls'),
      ['call-1', 'ch-1', 'org-1', 'user-1']
    );
    // Must use `state` column, not `status`
    const sql = mockQueryPrimary.mock.calls[0][0] as string;
    expect(sql).toContain('state');
    expect(sql).not.toContain('status');
  });

  it('emits call:participant-joined to call room', async () => {
    const socket = makeSocket('user-1', 'org-1');
    const io = makeIo();

    await handleCallJoin(socket, io, { callId: 'call-1', channelId: 'ch-1' });

    expect(io.to).toHaveBeenCalledWith('call:call-1');
    expect(io._emit).toHaveBeenCalledWith('call:participant-joined', {
      userId: 'user-1',
      callId: 'call-1',
    });
  });
});

describe('handleCallLeave', () => {
  it('leaves socket room and removes user from Redis participants', async () => {
    const socket = makeSocket('user-1');
    const io = makeIo();
    mockScard.mockResolvedValue(1); // others still in call

    await handleCallLeave(socket, io, { callId: 'call-1' });

    expect(socket.leave).toHaveBeenCalledWith('call:call-1');
    expect(mockSrem).toHaveBeenCalledWith('call:participants:call-1', 'user-1');
  });

  it('marks call as ended in DB when last participant leaves', async () => {
    const socket = makeSocket('user-1');
    const io = makeIo();
    mockScard.mockResolvedValue(0); // now empty

    await handleCallLeave(socket, io, { callId: 'call-1' });

    expect(mockQueryPrimary).toHaveBeenCalledWith(
      expect.stringContaining("state = 'ended'"),
      ['call-1']
    );
  });

  it('does NOT update DB when other participants remain', async () => {
    const socket = makeSocket('user-1');
    const io = makeIo();
    mockScard.mockResolvedValue(2);

    await handleCallLeave(socket, io, { callId: 'call-1' });

    expect(mockQueryPrimary).not.toHaveBeenCalled();
  });

  it('emits call:participant-left to call room', async () => {
    const socket = makeSocket('user-1');
    const io = makeIo();
    mockScard.mockResolvedValue(0);

    await handleCallLeave(socket, io, { callId: 'call-1' });

    expect(io.to).toHaveBeenCalledWith('call:call-1');
    expect(io._emit).toHaveBeenCalledWith('call:participant-left', {
      userId: 'user-1',
      callId: 'call-1',
    });
  });
});

describe('handleCallOffer', () => {
  it('forwards offer to target user room', () => {
    const socket = makeSocket('sender-1', 'org-1');
    const io = makeIo();

    handleCallOffer(socket, io, {
      callId: 'call-1',
      targetUserId: 'target-1',
      offer: { type: 'offer', sdp: 'v=0...' },
    });

    expect(io.to).toHaveBeenCalledWith('org:org-1:user:target-1');
    expect(io._emit).toHaveBeenCalledWith('call:offer', {
      callId: 'call-1',
      senderId: 'sender-1',
      offer: { type: 'offer', sdp: 'v=0...' },
    });
  });
});

describe('handleCallAnswer', () => {
  it('forwards answer to target user room', () => {
    const socket = makeSocket('sender-1', 'org-1');
    const io = makeIo();

    handleCallAnswer(socket, io, {
      callId: 'call-1',
      targetUserId: 'target-1',
      answer: { type: 'answer', sdp: 'v=0...' },
    });

    expect(io.to).toHaveBeenCalledWith('org:org-1:user:target-1');
    expect(io._emit).toHaveBeenCalledWith('call:answer', {
      callId: 'call-1',
      senderId: 'sender-1',
      answer: { type: 'answer', sdp: 'v=0...' },
    });
  });
});

describe('handleIceCandidate', () => {
  it('forwards ICE candidate to target user room', () => {
    const socket = makeSocket('sender-1', 'org-1');
    const io = makeIo();

    handleIceCandidate(socket, io, {
      callId: 'call-1',
      targetUserId: 'target-1',
      candidate: { candidate: 'candidate:1 1 UDP ...', sdpMid: '0' },
    });

    expect(io.to).toHaveBeenCalledWith('org:org-1:user:target-1');
    expect(io._emit).toHaveBeenCalledWith('call:ice-candidate', {
      callId: 'call-1',
      senderId: 'sender-1',
      candidate: { candidate: 'candidate:1 1 UDP ...', sdpMid: '0' },
    });
  });
});
