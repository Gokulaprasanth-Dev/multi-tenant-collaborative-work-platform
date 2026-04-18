// frontend/src/app/core/services/push-notification.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { PushNotificationService } from './push-notification.service';

const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0));

const MOCK_SUB = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/test',
  getKey: (name: string) => name === 'p256dh'
    ? new Uint8Array([1, 2, 3]).buffer
    : new Uint8Array([4, 5, 6]).buffer,
};

describe('PushNotificationService', () => {
  let svc: PushNotificationService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [PushNotificationService],
    });
    svc  = TestBed.inject(PushNotificationService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('isSupported() returns false when serviceWorker API absent', () => {
    const orig = (navigator as { serviceWorker?: unknown }).serviceWorker;
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    expect(svc.isSupported()).toBe(false);
    (navigator as { serviceWorker?: unknown }).serviceWorker = orig;
  });

  it('permissionDenied signal starts false', () => {
    expect(svc.permissionDenied()).toBe(false);
  });

  it('requestPermission() posts to /push/subscribe with subscription keys', async () => {
    const mockReg = {
      pushManager: {
        getSubscription: jest.fn().mockResolvedValue(null),
        subscribe: jest.fn().mockResolvedValue(MOCK_SUB),
      },
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register: jest.fn().mockResolvedValue(mockReg) },
      configurable: true,
    });
    const p = svc.requestPermission().toPromise();
    await flushPromises();
    http.expectOne('/api/v1/push/subscribe').flush({ data: { subscribed: true }, error: null, meta: {} });
    await p;
    expect(mockReg.pushManager.subscribe).toHaveBeenCalled();
  });

  it('unsubscribe() calls DELETE /push/subscribe', async () => {
    const mockReg = {
      pushManager: {
        getSubscription: jest.fn().mockResolvedValue({ ...MOCK_SUB, unsubscribe: jest.fn().mockResolvedValue(true) }),
      },
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register: jest.fn().mockResolvedValue(mockReg), ready: Promise.resolve(mockReg) },
      configurable: true,
    });
    svc.unsubscribe().subscribe();
    await flushPromises();
    http.expectOne(req => req.method === 'DELETE' && req.url === '/api/v1/push/subscribe')
      .flush({ data: { unsubscribed: true }, error: null, meta: {} });
  });
});
