// frontend/src/app/core/services/socket.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { SocketService } from './socket.service';
import { TokenStorageService } from './token-storage.service';

const mockSocket = {
  connected: false,
  on:         jest.fn(),
  off:        jest.fn(),
  emit:       jest.fn(),
  disconnect: jest.fn(),
};

jest.mock('socket.io-client', () => ({
  io: jest.fn(() => mockSocket),
}));

describe('SocketService', () => {
  let service: SocketService;
  let storage: TokenStorageService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSocket.connected = false;
    TestBed.configureTestingModule({});
    service = TestBed.inject(SocketService);
    storage = TestBed.inject(TokenStorageService);
    localStorage.clear();
  });

  it('does not connect when no access token is stored', () => {
    service.connect();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { io } = require('socket.io-client') as { io: jest.Mock };
    expect(io).not.toHaveBeenCalled();
    expect(service.connected()).toBe(false);
  });

  it('calls io() with token when connect() is invoked and token exists', () => {
    storage.setAccessToken('tok-abc');
    service.connect();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { io } = require('socket.io-client') as { io: jest.Mock };
    expect(io).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ auth: { token: 'tok-abc' } }),
    );
  });

  it('does not create a second socket when already connected', () => {
    storage.setAccessToken('tok');
    service.connect();                 // creates socket (mockSocket.connected is false)
    mockSocket.connected = true;       // simulate connected
    service.connect();                 // should be no-op
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { io } = require('socket.io-client') as { io: jest.Mock };
    expect(io).toHaveBeenCalledTimes(1);
  });

  it('disconnect() sets connected signal to false and calls socket.disconnect()', () => {
    storage.setAccessToken('tok');
    service.connect();
    service.disconnect();
    expect(mockSocket.disconnect).toHaveBeenCalled();
    expect(service.connected()).toBe(false);
  });

  it('fromEvent() emits values when the socket fires the event', (done) => {
    storage.setAccessToken('tok');
    service.connect();

    const handlers: Record<string, (d: unknown) => void> = {};
    mockSocket.on.mockImplementation(
      (event: string, handler: (d: unknown) => void) => { handlers[event] = handler; }
    );

    service.fromEvent<{ text: string }>('chat:message').subscribe(msg => {
      expect(msg.text).toBe('hello');
      done();
    });

    handlers['chat:message']?.({ text: 'hello' });
  });
});
