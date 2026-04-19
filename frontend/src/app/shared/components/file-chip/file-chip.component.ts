// frontend/src/app/shared/components/file-chip/file-chip.component.ts
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FileUpload } from '../../../core/models/file.model';

@Component({
  selector: 'app-file-chip',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="chip" [ngClass]="'chip--' + upload.state">
      <span class="chip-icon">{{ icon }}</span>
      <span class="chip-name">{{ upload.file.name }}</span>
      <span class="chip-size">{{ formatSize(upload.file.size) }}</span>

      @if (upload.state === 'uploading') {
        <div class="chip-progress-wrapper">
          <div class="chip-progress" [style.width.%]="upload.progress"></div>
        </div>
        <button data-testid="cancel-btn" class="chip-action" (click)="cancel.emit(upload.id)" title="Cancel">✕</button>
      }

      @if (upload.state === 'rejected' || upload.state === 'cancelled' || upload.state === 'error') {
        <span class="chip-error-msg">{{ upload.error ?? upload.state }}</span>
        <button data-testid="dismiss-btn" class="chip-action" (click)="dismiss.emit(upload.id)" title="Dismiss">✕</button>
      }
    </div>
  `,
})
export class FileChipComponent {
  @Input({ required: true }) upload!: FileUpload;
  @Output() cancel  = new EventEmitter<string>();
  @Output() dismiss = new EventEmitter<string>();

  get icon(): string {
    const icons: Record<string, string> = {
      pending: '⏳', uploading: '⬆', scanning: '🔍',
      ready: '✅', rejected: '🚫', cancelled: '⛔', error: '⚠',
    };
    return icons[this.upload.state] ?? '📄';
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
