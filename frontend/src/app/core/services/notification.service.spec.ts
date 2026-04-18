// frontend/src/app/core/services/notification.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { of, Subscription } from 'rxjs';
import { NotificationService } from './notification.service';
import { TenantService } from './tenant.service';
import { SocketService } from './socket.service';
import { NotificationDto } from '../models/notification.model';

const DTO: NotificationDto = {
  id: 'n-1', org_id: 'org-1', user_id: 'u-1',
  type: 'task.assigned', entity_type: 'task', entity_id: 't-1',
  actor_id: 'u-2', payload: {}, is_read: false,
  read_at: null, created_at: '2024-01-01T10:00:00Z',
};

describe('NotificationService', () => {
  let svc: NotificationService;
  let http: HttpTestingController;
  let tenant: { activeOrgId: jest.Mock };
  let socket: { fromEvent: jest.Mock };

  beforeEach(() => {
    tenant = { activeOrgId: jest.fn().mockReturnValue('org-1') };
    socket = { fromEvent: jest.fn().mockReturnValue(of()) };

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        NotificationService,
        { provide: TenantService,  useValue: tenant },
        { provide: SocketService,   useValue: socket },
      ],
    });
    svc  = TestBed.inject(NotificationService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('load() populates notifications signal', () => {
    svc.load().subscribe();
    http.expectOne('/api/v1/orgs/org-1/notifications?limit=20')
      .flush({ data: [DTO], error: null, meta: {} });
    expect(svc.notifications().length).toBe(1);
    expect(svc.notifications()[0].id).toBe('n-1');
  });

  it('load() sets unreadCount from response', () => {
    svc.load().subscribe();
    http.expectOne('/api/v1/orgs/org-1/notifications?limit=20')
      .flush({ data: [DTO], error: null, meta: {} });
    expect(svc.unreadCount()).toBe(1);
  });

  it('markRead() optimistically updates isRead and sends PATCH', () => {
    svc.notifications.set([{ ...DTO, id: 'n-1', isRead: false } as never]);
    svc.markRead('n-1').subscribe();
    expect(svc.notifications()[0].isRead).toBe(true);
    http.expectOne('/api/v1/orgs/org-1/notifications/n-1/read').flush({ data: {}, error: null, meta: {} });
  });

  it('markRead() reverts on error', () => {
    svc.notifications.set([{ id: 'n-1', isRead: false, orgId: 'org-1' } as never]);
    svc.markRead('n-1').subscribe({ error: () => {} });
    http.expectOne('/api/v1/orgs/org-1/notifications/n-1/read').flush('err', { status: 500, statusText: 'Error' });
    expect(svc.notifications()[0].isRead).toBe(false);
  });

  it('markAllRead() clears unreadCount optimistically', () => {
    svc.notifications.set([{ id: 'n-1', isRead: false } as never]);
    svc.markAllRead().subscribe();
    expect(svc.unreadCount()).toBe(0);
    http.expectOne('/api/v1/orgs/org-1/notifications/read-all').flush({ data: {}, error: null, meta: {} });
  });

  it('subscribeRealtime() prepends incoming notification and increments count', () => {
    const subject$ = of(DTO);
    socket.fromEvent.mockReturnValue(subject$);
    const sub: Subscription = svc.subscribeRealtime();
    expect(svc.notifications().length).toBe(1);
    expect(svc.unreadCount()).toBe(1);
    sub.unsubscribe();
  });
});
