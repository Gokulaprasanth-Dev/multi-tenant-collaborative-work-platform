// frontend/src/app/shared/components/file-upload/file-upload.component.ts
import {
  Component, Output, EventEmitter, HostListener, signal, computed, inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgxDropzoneModule, NgxDropzoneChangeEvent } from 'ngx-dropzone';
import { FileService } from '../../../core/services/file.service';
import { FileUpload, UploadState } from '../../../core/models/file.model';
import { FileChipComponent } from '../file-chip/file-chip.component';

const PENDING_STATES: UploadState[] = ['uploading', 'scanning', 'error'];

@Component({
  selector: 'app-file-upload',
  standalone: true,
  imports: [CommonModule, NgxDropzoneModule, FileChipComponent],
  template: `
    <ngx-dropzone (change)="onDrop($event)" [disableClick]="true" class="dropzone">
      <ngx-dropzone-label>
        <button type="button" class="pick-btn" (click)="picker.click()">Attach files</button>
        <span class="drop-hint"> or drag & drop</span>
      </ngx-dropzone-label>
    </ngx-dropzone>

    <input #picker type="file" multiple hidden (change)="onPickerChange($event)" />

    @if (uploads().length > 0) {
      <div class="chip-list">
        @for (u of uploads(); track u.id) {
          <app-file-chip [upload]="u" (cancel)="onCancel($event)" (dismiss)="onDismiss($event)" />
        }
      </div>
    }
  `,
})
export class FileUploadComponent {
  private fileSvc = inject(FileService);

  @Output() fileReady = new EventEmitter<string>();

  readonly uploads    = signal<FileUpload[]>([]);
  readonly hasPending = computed(() => this.uploads().some(u => PENDING_STATES.includes(u.state)));

  onDrop(event: NgxDropzoneChangeEvent): void {
    this.onFilesSelected(event.addedFiles);
  }

  onPickerChange(event: Event): void {
    const files = Array.from((event.target as HTMLInputElement).files ?? []);
    this.onFilesSelected(files);
    (event.target as HTMLInputElement).value = '';
  }

  @HostListener('paste', ['$event'])
  onPaste(event: ClipboardEvent): void {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length) this.onFilesSelected(files);
  }

  onFilesSelected(files: File[]): void {
    for (const file of files) {
      const entry: FileUpload = {
        id: crypto.randomUUID(), file, state: 'pending', progress: 0,
      };
      this.uploads.update(list => [...list, entry]);

      this.fileSvc.upload(file).subscribe(update => {
        this.uploads.update(list =>
          list.map(u => u.id === entry.id ? { ...u, ...update } : u)
        );
        if (update.state === 'ready' && update.fileId) {
          this.fileReady.emit(update.fileId);
        }
      });
    }
  }

  onCancel(uploadId: string): void {
    const entry = this.uploads().find(u => u.id === uploadId);
    entry?.xhr?.abort();
  }

  onDismiss(uploadId: string): void {
    this.uploads.update(list => list.filter(u => u.id !== uploadId));
  }

  clearReady(): void {
    this.uploads.update(list => list.filter(u => u.state !== 'ready'));
  }
}
