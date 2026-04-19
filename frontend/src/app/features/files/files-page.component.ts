// frontend/src/app/features/files/files-page.component.ts
import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { TenantService } from '../../core/services/tenant.service';
import { ApiResponse } from '../../core/models/api-response.model';
import { FileRecord, FileRecordDto, toFileRecord } from '../../core/models/file.model';
import { FileUploadComponent } from '../../shared/components/file-upload/file-upload.component';

@Component({
  selector: 'app-files-page',
  standalone: true,
  imports: [CommonModule, FileUploadComponent],
  template: `
    <div class="files-page">
      <h1 class="files-title">Files</h1>

      <app-file-upload (fileReady)="onFileReady()" />

      @if (files().length === 0) {
        <p class="files-empty">No files uploaded yet.</p>
      } @else {
        <div class="files-grid">
          @for (file of files(); track file.id) {
            <div class="file-card">
              <span class="file-name">{{ file.filename }}</span>
              <span class="file-size">{{ formatSize(file.sizeBytes) }}</span>
              <span class="file-date">{{ file.createdAt | date:'mediumDate' }}</span>
              <button class="file-delete-btn" (click)="deleteFile(file.id)">Delete</button>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class FilesPageComponent implements OnInit {
  private http   = inject(HttpClient);
  private tenant = inject(TenantService);

  readonly files = signal<FileRecord[]>([]);

  ngOnInit(): void { this.load(); }

  load(): void {
    const orgId = this.tenant.activeOrgId()!;
    this.http
      .get<ApiResponse<FileRecordDto[]>>(`/api/v1/orgs/${orgId}/files?limit=20&offset=0`)
      .subscribe(res => this.files.set(res.data.map(toFileRecord)));
  }

  onFileReady(): void { this.load(); }

  deleteFile(fileId: string): void {
    const orgId = this.tenant.activeOrgId()!;
    this.http.delete(`/api/v1/orgs/${orgId}/files/${fileId}`)
      .subscribe(() => this.load());
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
