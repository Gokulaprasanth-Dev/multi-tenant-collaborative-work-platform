// frontend/src/app/features/task/task-comment/task-comment.component.ts
import { Component, Input, Output, EventEmitter, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TaskService } from '../../../core/services/task.service';
import { FileUploadComponent } from '../../../shared/components/file-upload/file-upload.component';

@Component({
  selector: 'app-task-comment',
  standalone: true,
  imports: [CommonModule, FormsModule, FileUploadComponent],
  template: `
    <div class="task-comment-editor">
      <textarea
        [(ngModel)]="body"
        class="comment-textarea"
        placeholder="Add a comment…"
        rows="2"
      ></textarea>
      <app-file-upload (fileReady)="onFileReady($event)" />
      <button class="comment-submit-btn" (click)="submit()" [disabled]="!body.trim()">
        Comment
      </button>
    </div>
  `,
})
export class TaskCommentComponent {
  @Input({ required: true }) taskId!: string;
  @Output() commented = new EventEmitter<void>();

  private taskSvc = inject(TaskService);

  body = '';
  private attachments = signal<string[]>([]);

  onFileReady(fileId: string): void {
    this.attachments.update(ids => [...ids, fileId]);
  }

  submit(): void {
    if (!this.body.trim()) return;
    const quillBody = { ops: [{ insert: `${this.body.trim()}\n` }] };
    this.taskSvc.addComment(this.taskId, quillBody, this.attachments()).subscribe({
      next: () => {
        this.body = '';
        this.attachments.set([]);
        this.commented.emit();
      },
    });
  }
}
