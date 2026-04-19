// frontend/src/app/core/services/file.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject } from 'rxjs';
import { ApiResponse } from '../models/api-response.model';
import { FileUpload, UploadUrlResultDto } from '../models/file.model';
import { TenantService } from './tenant.service';

@Injectable({ providedIn: 'root' })
export class FileService {
  private http   = inject(HttpClient);
  private tenant = inject(TenantService);

  upload(file: File): Observable<Partial<FileUpload>> {
    const orgId = this.tenant.activeOrgId()!;
    const subject = new Subject<Partial<FileUpload>>();

    this.http
      .post<ApiResponse<UploadUrlResultDto>>(
        `/api/v1/orgs/${orgId}/files/upload-url`,
        { filename: file.name, mimeType: file.type || 'application/octet-stream', sizeBytes: file.size }
      )
      .subscribe({
        next: res => {
          const { fileId, uploadUrl, uploadFields } = res.data;
          this.uploadToS3(file, uploadUrl, uploadFields, fileId, subject, orgId);
        },
        error: err => {
          subject.next({ state: 'error', error: err?.error?.error?.code ?? 'Upload URL request failed' });
          subject.complete();
        },
      });

    return subject.asObservable();
  }

  private uploadToS3(
    file: File,
    uploadUrl: string,
    uploadFields: Record<string, string>,
    fileId: string,
    subject: Subject<Partial<FileUpload>>,
    orgId: string,
  ): void {
    const formData = new FormData();
    for (const [key, value] of Object.entries(uploadFields)) {
      formData.append(key, value);
    }
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    subject.next({ state: 'uploading', progress: 0, xhr });

    xhr.upload.addEventListener('progress', (e: ProgressEvent) => {
      if (e.lengthComputable) {
        subject.next({ progress: Math.round((e.loaded / e.total) * 100) });
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        subject.next({ state: 'scanning', progress: 100 });
        this.pollScanStatus(orgId, fileId, subject);
      } else {
        subject.next({ state: 'error', error: `S3 upload failed (${xhr.status})` });
        subject.complete();
      }
    });

    xhr.addEventListener('error', () => {
      subject.next({ state: 'error', error: 'Network error during upload' });
      subject.complete();
    });

    xhr.addEventListener('abort', () => {
      subject.next({ state: 'cancelled' });
      subject.complete();
    });

    xhr.open('POST', uploadUrl);
    xhr.send(formData);
  }

  private pollScanStatus(
    orgId: string,
    fileId: string,
    subject: Subject<Partial<FileUpload>>,
  ): void {
    const poll = () => {
      this.http
        .get<ApiResponse<{ url: string }>>(
          `/api/v1/orgs/${orgId}/files/${fileId}/download-url`,
          { observe: 'response' }
        )
        .subscribe({
          next: res => {
            if (res.status === 200) {
              subject.next({ state: 'ready', fileId });
              subject.complete();
            } else {
              setTimeout(poll, 3000);
            }
          },
          error: err => {
            if (err.status === 422) {
              subject.next({ state: 'rejected', error: 'File rejected by virus scan' });
            } else {
              subject.next({ state: 'error', error: 'Scan check failed' });
            }
            subject.complete();
          },
        });
    };

    setTimeout(poll, 3000);
  }
}
