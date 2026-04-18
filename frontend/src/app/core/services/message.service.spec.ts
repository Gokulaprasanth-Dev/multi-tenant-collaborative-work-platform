// frontend/src/app/core/services/message.service.spec.ts
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MessageService } from './message.service';
import { TenantService } from './tenant.service';
import { SocketService } from './socket.service';
import { MessageDto } from '../models/message.model';
import { Subject } from 'rxjs';

const MSG_DTO: MessageDto = {
  id: 'msg-1', channel_id: 'ch-1', sender_user_id: 'u-1',
  body: 'Hello!', client_message_id: 'cid-1',
  created_at: '2024-01-01T00:00:00.000Z',
};

describe('MessageService', () => {
  let service: MessageService;
  let ctrl: HttpTestingController;
  let tenant: TenantService;
  let socketSubject: Subject<MessageDto>;
  let socketService: { fromEvent: jest.Mock; connected: jest.Mock };

  beforeEach(() => {
    socketSubject = new Subject<MessageDto>();
    socketService = {
      fromEvent: jest.fn().mockReturnValue(socketSubject.asObservable()),
      connected:  jest.fn().mockReturnValue(false),
    };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SocketService, useValue: socketService },
      ],
    });
    service = TestBed.inject(MessageService);
    ctrl    = TestBed.inject(HttpTestingController);
    tenant  = TestBed.inject(TenantService);
  });

  afterEach(() => ctrl.verify());

  it('load() fetches messages and updates signal', fakeAsync(() => {
    tenant.setOrg({ id: 'org-1', name: 'Acme', slug: 'acme', status: 'active', plan: 'free' });
    service.load('ch-1').subscribe();
    ctrl.expectOne('/api/v1/orgs/org-1/channels/ch-1/messages?limit=50')
      .flush({ data: [MSG_DTO], error: null, meta: {} });
    tick();
    expect(service.messages().length).toBe(1);
    expect(service.messages()[0].body).toBe('Hello!');
  }));

  it('send() POSTs with body and client_message_id, sets sending flag', fakeAsync(() => {
    tenant.setOrg({ id: 'org-1', name: 'Acme', slug: 'acme', status: 'active', plan: 'free' });
    service.send('ch-1', 'Hi there').subscribe();
    expect(service.sending()).toBe(true);
    const req = ctrl.expectOne('/api/v1/orgs/org-1/channels/ch-1/messages');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toMatchObject({ body: 'Hi there' });
    expect(typeof req.request.body['client_message_id']).toBe('string');
    req.flush({ data: { ...MSG_DTO, body: 'Hi there' }, error: null, meta: {} });
    tick();
    expect(service.sending()).toBe(false);
  }));

  it('subscribeRealtime() appends incoming socket events for matching channelId', fakeAsync(() => {
    const sub = service.subscribeRealtime('ch-1');
    socketSubject.next(MSG_DTO);
    tick();
    expect(service.messages().length).toBe(1);
    expect(service.messages()[0].id).toBe('msg-1');
    sub.unsubscribe();
  }));

  it('subscribeRealtime() ignores events for other channels', fakeAsync(() => {
    const sub = service.subscribeRealtime('ch-1');
    socketSubject.next({ ...MSG_DTO, channel_id: 'ch-99' });
    tick();
    expect(service.messages().length).toBe(0);
    sub.unsubscribe();
  }));

  it('subscribeRealtime() dedupes messages with same id', fakeAsync(() => {
    const sub = service.subscribeRealtime('ch-1');
    socketSubject.next(MSG_DTO);
    socketSubject.next(MSG_DTO);
    tick();
    expect(service.messages().length).toBe(1);
    sub.unsubscribe();
  }));
});
