// frontend/src/app/features/notifications/notification-bell/notification-bell.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { NotificationBellComponent } from './notification-bell.component';
import { NotificationService } from '../../../core/services/notification.service';

describe('NotificationBellComponent', () => {
  let fixture: ComponentFixture<NotificationBellComponent>;
  let notifSvc: {
    unreadCount: ReturnType<typeof signal<number>>;
    notifications: ReturnType<typeof signal<never[]>>;
    loading: ReturnType<typeof signal<boolean>>;
    load: jest.Mock;
    subscribeRealtime: jest.Mock;
    markRead: jest.Mock;
    markAllRead: jest.Mock;
  };

  beforeEach(async () => {
    notifSvc = {
      unreadCount:       signal(0),
      notifications:     signal([]),
      loading:           signal(false),
      load:              jest.fn().mockReturnValue({ subscribe: jest.fn() }),
      subscribeRealtime: jest.fn().mockReturnValue({ unsubscribe: jest.fn() }),
      markRead:          jest.fn().mockReturnValue(of(undefined)),
      markAllRead:       jest.fn().mockReturnValue(of(undefined)),
    };

    await TestBed.configureTestingModule({
      imports: [NotificationBellComponent],
      providers: [
        { provide: NotificationService, useValue: notifSvc },
        provideRouter([]),
        provideAnimations(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NotificationBellComponent);
    fixture.detectChanges();
  });

  it('hides badge when unreadCount is 0', () => {
    notifSvc.unreadCount.set(0);
    fixture.detectChanges();
    const badge = fixture.nativeElement.querySelector('.notif-badge');
    expect(badge).toBeFalsy();
  });

  it('shows badge with count when unreadCount > 0', () => {
    notifSvc.unreadCount.set(3);
    fixture.detectChanges();
    const badge = fixture.nativeElement.querySelector('.notif-badge');
    expect(badge).toBeTruthy();
    expect(badge.textContent.trim()).toBe('3');
  });

  it('toggles panel open on bell button click', () => {
    const btn = fixture.nativeElement.querySelector('.notif-bell-btn');
    btn.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-notification-panel')).toBeTruthy();
  });

  it('closes panel on second click', () => {
    const btn = fixture.nativeElement.querySelector('.notif-bell-btn');
    btn.click(); fixture.detectChanges();
    btn.click(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-notification-panel')).toBeFalsy();
  });
});
