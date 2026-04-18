// frontend/src/app/features/notifications/notification-preferences/notification-preferences.component.spec.ts
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { NotificationPreferencesComponent } from './notification-preferences.component';
import { TenantService } from '../../../core/services/tenant.service';
import { PushNotificationService } from '../../../core/services/push-notification.service';
import { NotificationPreferenceDto } from '../../../core/models/notification.model';

const PREF: NotificationPreferenceDto = {
  event_type: 'task.assigned', channel_inapp: true, channel_email: false,
  channel_push: false, digest_mode: 'realtime',
  quiet_hours_start: null, quiet_hours_end: null,
};

describe('NotificationPreferencesComponent', () => {
  let fixture: ComponentFixture<NotificationPreferencesComponent>;
  let http: HttpTestingController;
  let tenant: { activeOrgId: jest.Mock };
  let pushSvc: { isSupported: jest.Mock; permissionDenied: ReturnType<typeof signal<boolean>>; requestPermission: jest.Mock };

  beforeEach(async () => {
    tenant  = { activeOrgId: jest.fn().mockReturnValue('org-1') };
    pushSvc = {
      isSupported:       jest.fn().mockReturnValue(true),
      permissionDenied:  signal(false),
      requestPermission: jest.fn().mockReturnValue(of(undefined)),
    };

    await TestBed.configureTestingModule({
      imports: [NotificationPreferencesComponent, HttpClientTestingModule],
      providers: [
        { provide: TenantService,            useValue: tenant },
        { provide: PushNotificationService,  useValue: pushSvc },
        provideRouter([]),
        provideAnimations(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NotificationPreferencesComponent);
    fixture.detectChanges();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads preferences on init', fakeAsync(() => {
    http.expectOne('/api/v1/orgs/org-1/notification-preferences')
      .flush({ data: [PREF], error: null, meta: {} });
    tick();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('task.assigned');
  }));

  it('toggling a channel calls PATCH immediately', fakeAsync(() => {
    http.expectOne('/api/v1/orgs/org-1/notification-preferences')
      .flush({ data: [PREF], error: null, meta: {} });
    tick(); fixture.detectChanges();
    const toggle = fixture.nativeElement.querySelector('.pref-toggle-email');
    toggle.click();
    fixture.detectChanges();
    const req = http.expectOne('/api/v1/orgs/org-1/notification-preferences/task.assigned');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body.channel_email).toBe(true);
    req.flush({ data: {}, error: null, meta: {} });
  }));

  it('shows enable push button when supported and not denied', fakeAsync(() => {
    http.expectOne('/api/v1/orgs/org-1/notification-preferences')
      .flush({ data: [PREF], error: null, meta: {} });
    tick(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.push-enable-btn')).toBeTruthy();
  }));

  it('calls requestPermission() when push enable button clicked', fakeAsync(() => {
    http.expectOne('/api/v1/orgs/org-1/notification-preferences')
      .flush({ data: [PREF], error: null, meta: {} });
    tick(); fixture.detectChanges();
    fixture.nativeElement.querySelector('.push-enable-btn').click();
    expect(pushSvc.requestPermission).toHaveBeenCalled();
  }));

  it('shows blocked message when permissionDenied is true', fakeAsync(() => {
    pushSvc.permissionDenied.set(true);
    http.expectOne('/api/v1/orgs/org-1/notification-preferences')
      .flush({ data: [PREF], error: null, meta: {} });
    tick(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('blocked');
  }));
});
