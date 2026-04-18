// frontend/src/app/features/notifications/notification-panel/notification-panel.component.spec.ts
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { NotificationPanelComponent } from './notification-panel.component';
import { NotificationService } from '../../../core/services/notification.service';
import { Notification } from '../../../core/models/notification.model';

const N: Notification = {
  id: 'n-1', orgId: 'org-1', userId: 'u-1',
  type: 'task.assigned', entityType: 'task', entityId: 't-1',
  actorId: 'u-2', payload: { workspaceId: 'ws-1' },
  isRead: false, readAt: null, createdAt: '2024-01-01T10:00:00Z',
};

describe('NotificationPanelComponent', () => {
  let fixture: ComponentFixture<NotificationPanelComponent>;
  let notifSvc: {
    notifications: ReturnType<typeof signal<Notification[]>>;
    loading: ReturnType<typeof signal<boolean>>;
    markRead: jest.Mock;
    markAllRead: jest.Mock;
  };

  beforeEach(async () => {
    notifSvc = {
      notifications: signal<Notification[]>([]),
      loading:       signal(false),
      markRead:      jest.fn().mockReturnValue(of(undefined)),
      markAllRead:   jest.fn().mockReturnValue(of(undefined)),
    };

    await TestBed.configureTestingModule({
      imports: [NotificationPanelComponent],
      providers: [
        { provide: NotificationService, useValue: notifSvc },
        provideRouter([]),
        provideAnimations(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NotificationPanelComponent);
    fixture.detectChanges();
  });

  it('renders All tab by default', () => {
    expect(fixture.nativeElement.querySelector('.notif-tab--active').textContent).toContain('All');
  });

  it('Unread tab filters to unread notifications only', fakeAsync(() => {
    notifSvc.notifications.set([N, { ...N, id: 'n-2', isRead: true }]);
    fixture.detectChanges();
    const tabs = fixture.nativeElement.querySelectorAll('.notif-tab');
    tabs[1].click(); // Unread tab
    fixture.detectChanges();
    tick();
    const rows = fixture.nativeElement.querySelectorAll('app-notification-item');
    expect(rows.length).toBe(1);
  }));

  it('Mentions tab filters to mention type notifications', fakeAsync(() => {
    notifSvc.notifications.set([N, { ...N, id: 'n-3', type: 'chat.mention', isRead: false }]);
    fixture.detectChanges();
    const tabs = fixture.nativeElement.querySelectorAll('.notif-tab');
    tabs[2].click(); // Mentions tab
    fixture.detectChanges();
    tick();
    const rows = fixture.nativeElement.querySelectorAll('app-notification-item');
    expect(rows.length).toBe(1);
  }));

  it('Mark all read button calls markAllRead()', fakeAsync(() => {
    notifSvc.notifications.set([N]);
    fixture.detectChanges();
    fixture.nativeElement.querySelector('.notif-mark-all-btn').click();
    tick();
    expect(notifSvc.markAllRead).toHaveBeenCalled();
  }));
});
