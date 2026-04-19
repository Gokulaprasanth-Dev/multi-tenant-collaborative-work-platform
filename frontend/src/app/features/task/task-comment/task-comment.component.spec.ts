// frontend/src/app/features/task/task-comment/task-comment.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TaskCommentComponent } from './task-comment.component';
import { TaskService } from '../../../core/services/task.service';
import { FileService } from '../../../core/services/file.service';
import { TenantService } from '../../../core/services/tenant.service';
import { signal } from '@angular/core';
import { Subject, of } from 'rxjs';
import { Comment } from '../../../core/models/comment.model';

describe('TaskCommentComponent', () => {
  let fixture: ComponentFixture<TaskCommentComponent>;
  let component: TaskCommentComponent;
  let addComment: jest.Mock;

  beforeEach(async () => {
    addComment = jest.fn().mockReturnValue(of({
      id: 'c-1', taskId: 't-1', authorUserId: 'u-1',
      body: { ops: [{ insert: 'hello\n' }], attachments: [] },
      createdAt: '2026-04-18T00:00:00Z',
    } as Comment));

    await TestBed.configureTestingModule({
      imports: [TaskCommentComponent],
      providers: [
        { provide: TaskService, useValue: { addComment } },
        { provide: FileService, useValue: { upload: jest.fn().mockReturnValue(new Subject()) } },
        { provide: TenantService, useValue: { activeOrgId: signal('org-1') } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TaskCommentComponent);
    component = fixture.componentInstance;
    component.taskId = 't-1';
    fixture.detectChanges();
  });

  it('should render comment textarea', () => {
    expect(fixture.nativeElement.querySelector('textarea')).toBeTruthy();
  });

  it('should call addComment on submit', () => {
    const spy = jest.spyOn(component.commented, 'emit');
    component.body = 'hello';
    component.submit();
    expect(addComment).toHaveBeenCalledWith('t-1', { ops: [{ insert: 'hello\n' }] }, []);
    expect(spy).toHaveBeenCalled();
  });

  it('should not submit when body is empty', () => {
    component.body = '';
    component.submit();
    expect(addComment).not.toHaveBeenCalled();
  });

  it('should include attachment fileIds on submit', () => {
    component.body = 'see attached';
    component.onFileReady('f-1');
    component.submit();
    expect(addComment).toHaveBeenCalledWith(
      't-1',
      { ops: [{ insert: 'see attached\n' }] },
      ['f-1']
    );
  });
});
