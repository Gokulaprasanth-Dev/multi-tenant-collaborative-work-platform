// frontend/src/app/features/chat/channel-view/channel-view.component.ts
import { Component, OnInit, OnDestroy, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { MessageService } from '../../../core/services/message.service';
import { ChannelService } from '../../../core/services/channel.service';

@Component({
  selector: 'app-channel-view',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="channel-view">
      <div class="channel-header"># {{ channelName() }}</div>

      <div class="message-list">
        @for (msg of messages(); track msg.id) {
          <div class="message-row">
            <span class="message-sender">{{ msg.senderUserId }}</span>
            <span class="message-body">{{ msg.body }}</span>
            <span class="message-time">{{ msg.createdAt | date:'shortTime' }}</span>
          </div>
        }

        @if (messages().length === 0) {
          <div class="message-empty">No messages yet — say hello!</div>
        }
      </div>

      <form class="message-input-row" [formGroup]="form" (ngSubmit)="send()">
        <input
          formControlName="body"
          class="message-input"
          [placeholder]="'Message #' + channelName() + '…'"
          autocomplete="off"
        />
        <button type="submit" class="message-send-btn" [disabled]="form.invalid || sending()">
          Send
        </button>
      </form>
    </div>
  `,
})
export class ChannelViewComponent implements OnInit, OnDestroy {
  private route    = inject(ActivatedRoute);
  private msgSvc   = inject(MessageService);
  private chSvc    = inject(ChannelService);
  private fb       = inject(FormBuilder);

  private realtimeSub?: Subscription;
  private channelId = signal('');

  readonly messages    = this.msgSvc.messages;
  readonly sending     = this.msgSvc.sending;
  readonly channelName = computed(() => {
    const ch = this.chSvc.channels().find(c => c.id === this.channelId());
    return ch?.name ?? '';
  });

  readonly form = this.fb.nonNullable.group({
    body: ['', Validators.required],
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('channelId')!;
    this.channelId.set(id);
    this.msgSvc.load(id).subscribe();
    this.realtimeSub = this.msgSvc.subscribeRealtime(id);
  }

  ngOnDestroy(): void {
    this.realtimeSub?.unsubscribe();
  }

  send(): void {
    if (this.form.invalid) return;
    const { body } = this.form.getRawValue();
    this.msgSvc.send(this.channelId(), body).subscribe({
      next: () => this.form.reset(),
    });
  }
}
