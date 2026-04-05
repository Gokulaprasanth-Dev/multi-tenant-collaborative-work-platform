/**
 * Unit tests for src/shared/realtime/room-manager.ts
 *
 * Covers:
 * - subscribeToTask: joins correct room `org:{orgId}:task:{taskId}`
 * - unsubscribeFromTask: leaves correct room
 * - subscribeToCall: joins `call:{callId}`
 * - unsubscribeFromCall: leaves `call:{callId}`
 */

import { RoomManager } from '../../../src/shared/realtime/room-manager';

function makeSocket() {
  return {
    join: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn().mockResolvedValue(undefined),
  };
}

describe('RoomManager', () => {
  let socket: ReturnType<typeof makeSocket>;
  let manager: RoomManager;

  beforeEach(() => {
    socket = makeSocket();
    manager = new RoomManager(socket as any);
  });

  describe('subscribeToTask', () => {
    it('joins the correct task room', async () => {
      await manager.subscribeToTask('task-123', 'org-456');
      expect(socket.join).toHaveBeenCalledWith('org:org-456:task:task-123');
    });
  });

  describe('unsubscribeFromTask', () => {
    it('leaves the correct task room', async () => {
      await manager.unsubscribeFromTask('task-123', 'org-456');
      expect(socket.leave).toHaveBeenCalledWith('org:org-456:task:task-123');
    });
  });

  describe('subscribeToCall', () => {
    it('joins the correct call room', async () => {
      await manager.subscribeToCall('call-abc');
      expect(socket.join).toHaveBeenCalledWith('call:call-abc');
    });
  });

  describe('unsubscribeFromCall', () => {
    it('leaves the correct call room', async () => {
      await manager.unsubscribeFromCall('call-abc');
      expect(socket.leave).toHaveBeenCalledWith('call:call-abc');
    });
  });

  it('does not mix up task and call rooms', async () => {
    await manager.subscribeToTask('t1', 'o1');
    await manager.subscribeToCall('c1');
    expect(socket.join).toHaveBeenCalledWith('org:o1:task:t1');
    expect(socket.join).toHaveBeenCalledWith('call:c1');
    expect(socket.join).not.toHaveBeenCalledWith('call:t1');
  });
});
