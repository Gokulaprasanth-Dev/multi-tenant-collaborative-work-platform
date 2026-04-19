// frontend/src/app/shared/components/file-preview/file-preview.component.ts
import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

@Component({
  selector: 'app-file-preview',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (isImage) {
      <img [src]="url" [alt]="filename" class="preview-image" />
    } @else if (isPdf) {
      <iframe [src]="safeUrl" type="application/pdf" class="preview-pdf" title="PDF preview"></iframe>
    } @else if (isVideo) {
      <video [src]="url" controls class="preview-video"></video>
    } @else if (isAudio) {
      <audio [src]="url" controls class="preview-audio"></audio>
    } @else {
      <a [href]="url" [download]="filename" class="preview-download">⬇ {{ filename }}</a>
    }
  `,
})
export class FilePreviewComponent {
  @Input({ required: true }) url!: string;
  @Input({ required: true }) mimeType!: string;
  @Input({ required: true }) filename!: string;

  private sanitizer = inject(DomSanitizer);

  get isImage(): boolean  { return this.mimeType.startsWith('image/'); }
  get isPdf(): boolean    { return this.mimeType === 'application/pdf'; }
  get isVideo(): boolean  { return this.mimeType.startsWith('video/'); }
  get isAudio(): boolean  { return this.mimeType.startsWith('audio/'); }

  get safeUrl(): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(this.url);
  }
}
