// frontend/src/app/features/task/task-list/task-list.component.spec.ts
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { of, Subject } from 'rxjs';
import { TaskListComponent } from './task-list.component';
import { FileService } from '../../../core/services/file.service';
import { TaskService } from '../../../core/services/task.service';
import { Task } from '../../../core/models/task.model';

const TASK: Task = {
  id: 'task-1', orgId: 'org-1', workspaceId: 'ws-1',
  title: 'Fix bug', description: null,
  status: 'todo', priority: 'medium',
  assigneeIds: [], dueDate: null,
  version: 1, createdAt: '', updatedAt: '',
};

describe('TaskListComponent', () => {
  let fixture: ComponentFixture<TaskListComponent>;
  let taskSvc: { tasks: ReturnType<typeof signal<Task[]>>; loading: ReturnType<typeof signal<boolean>>; load: jest.Mock; updateStatus: jest.Mock; addComment: jest.Mock };

  beforeEach(async () => {
    taskSvc = {
      tasks:        signal<Task[]>([]),
      loading:      signal(false),
      load:         jest.fn().mockReturnValue(of([])),
      updateStatus: jest.fn().mockReturnValue(of(TASK)),
      addComment:   jest.fn().mockReturnValue(of({})),
    };

    await TestBed.configureTestingModule({
      imports: [TaskListComponent],
      providers: [
        { provide: TaskService, useValue: taskSvc },
        { provide: FileService, useValue: { upload: jest.fn().mockReturnValue(new Subject()) } },
        provideRouter([]),
        provideAnimations(),
        {
          provide: ActivatedRoute,
          useValue: {
            parent: { snapshot: { paramMap: { get: () => 'ws-1' } } },
            snapshot: { paramMap: { get: () => null } },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TaskListComponent);
    fixture.detectChanges();
  });

  it('calls taskSvc.load() with workspaceId on init', () => {
    expect(taskSvc.load).toHaveBeenCalledWith('ws-1');
  });

  it('renders a task row for each task in the todo group', fakeAsync(() => {
    taskSvc.tasks.set([TASK]);
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('.task-row');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Fix bug');
  }));

  it('shows empty message when no tasks in a group', fakeAsync(() => {
    taskSvc.tasks.set([]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No todo tasks');
  }));

  it('calls updateStatus when status select changes', fakeAsync(() => {
    taskSvc.tasks.set([TASK]);
    fixture.detectChanges();
    const select = fixture.nativeElement.querySelector('.task-status-select');
    select.value = 'done';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    tick();
    expect(taskSvc.updateStatus).toHaveBeenCalledWith('task-1', 'done', 1);
  }));
});
