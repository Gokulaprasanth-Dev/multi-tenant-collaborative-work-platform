import { Socket } from 'socket.io';

/**
 * RoomManager: manages task and call room subscriptions per socket.
 */
export class RoomManager {
  constructor(private readonly socket: Socket) {}

  async subscribeToTask(taskId: string, orgId: string): Promise<void> {
    await this.socket.join(`org:${orgId}:task:${taskId}`);
  }

  async unsubscribeFromTask(taskId: string, orgId: string): Promise<void> {
    await this.socket.leave(`org:${orgId}:task:${taskId}`);
  }

  async subscribeToCall(callId: string): Promise<void> {
    await this.socket.join(`call:${callId}`);
  }

  async unsubscribeFromCall(callId: string): Promise<void> {
    await this.socket.leave(`call:${callId}`);
  }
}
