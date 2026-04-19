// frontend/src/app/features/chat/channel-view/channel-view.component.spec.ts
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { ReactiveFormsModule } from '@angular/forms';
import { signal } from '@angular/core';
import { of, Subscription, Subject } from 'rxjs';
import { ChannelViewComponent } from './channel-view.component';
import { MessageService } from '../../../core/services/message.service';
import { ChannelService } from '../../../core/services/channel.service';
import { FileService } from '../../../core/services/file.service';
import { Message } from '../../../core/models/message.model';
import { Channel } from '../../../core/models/channel.model';

const MSG: Message = {
  id: 'msg-1', channelId: 'ch-1', senderUserId: 'u-1',
  body: 'Hello!', clientMessageId: 'cid-1', createdAt: '2024-01-01T10:00:00.000Z', attachments: [],
};

const CH: Channel = {
  id: 'ch-1', orgId: 'org-1', workspaceId: 'ws-1',
  type: 'group', name: 'general', createdAt: '',
};

describe('ChannelViewComponent', () => {
  let fixture: ComponentFixture<ChannelViewComponent>;
  let msgSvc: { messages: ReturnType<typeof signal<Message[]>>; sending: ReturnType<typeof signal<boolean>>; load: jest.Mock; send: jest.Mock; subscribeRealtime: jest.Mock };
  let chSvc:  { channels: ReturnType<typeof signal<Channel[]>> };

  beforeEach(async () => {
    msgSvc = {
      messages:           signal<Message[]>([]),
      sending:            signal(false),
      load:               jest.fn().mockReturnValue(of([])),
      send:               jest.fn().mockReturnValue(of(MSG)),
      subscribeRealtime:  jest.fn().mockReturnValue(new Subscription()),
    };
    chSvc = {
      channels: signal<Channel[]>([CH]),
    };

    await TestBed.configureTestingModule({
      imports: [ChannelViewComponent, ReactiveFormsModule],
      providers: [
        { provide: MessageService, useValue: msgSvc },
        { provide: ChannelService, useValue: chSvc },
        { provide: FileService, useValue: { upload: jest.fn().mockReturnValue(new Subject()) } },
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 'ch-1' } } },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ChannelViewComponent);
    fixture.detectChanges();
  });

  it('calls load() and subscribeRealtime() with channelId on init', fakeAsync(() => {
    tick();
    expect(msgSvc.load).toHaveBeenCalledWith('ch-1');
    expect(msgSvc.subscribeRealtime).toHaveBeenCalledWith('ch-1');
  }));

  it('renders a message row for each message', fakeAsync(() => {
    msgSvc.messages.set([MSG]);
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('.message-row');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Hello!');
  }));

  it('shows empty state when no messages', fakeAsync(() => {
    msgSvc.messages.set([]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No messages yet');
  }));

  it('calls send() and resets form on submit', fakeAsync(() => {
    const input = fixture.nativeElement.querySelector('.message-input');
    input.value = 'Hi there';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const form = fixture.nativeElement.querySelector('form');
    form.dispatchEvent(new Event('submit'));
    tick();
    expect(msgSvc.send).toHaveBeenCalledWith('ch-1', 'Hi there', []);
  }));
});
