// frontend/src/app/core/services/task.service.spec.ts
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TaskService } from './task.service';
import { TenantService } from './tenant.service';
import { TaskDto } from '../models/task.model';

const TASK_DTO: TaskDto = {
  id: 'task-1', org_id: 'org-1', workspace_id: 'ws-1',
  title: 'Fix bug', description: null,
  status: 'todo', priority: 'medium',
  assignee_ids: [], due_date: null,
  version: 1, created_at: '2024-01-01T00:00:00.000Z', updated_at: '2024-01-01T00:00:00.000Z',
};

describe('TaskService', () => {
  let service: TaskService;
  let ctrl: HttpTestingController;
  let tenant: TenantService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(TaskService);
    ctrl    = TestBed.inject(HttpTestingController);
    tenant  = TestBed.inject(TenantService);
  });

  afterEach(() => ctrl.verify());

  it('load() does nothing when no org is active', fakeAsync(() => {
    service.load('ws-1').subscribe();
    tick();
    ctrl.expectNone('/api/v1/orgs/org-1/tasks');
    expect(service.tasks()).toEqual([]);
  }));

  it('load() fetches tasks filtered by workspaceId and updates signal', fakeAsync(() => {
    tenant.setOrg({ id: 'org-1', name: 'Acme', slug: 'acme', status: 'active', plan: 'free' });
    service.load('ws-1').subscribe();
    ctrl.expectOne('/api/v1/orgs/org-1/tasks?workspace_id=ws-1')
      .flush({ data: [TASK_DTO], error: null, meta: {} });
    tick();
    expect(service.tasks().length).toBe(1);
    expect(service.tasks()[0].title).toBe('Fix bug');
    expect(service.tasks()[0].workspaceId).toBe('ws-1');
  }));

  it('create() POSTs and appends new task to signal', fakeAsync(() => {
    tenant.setOrg({ id: 'org-1', name: 'Acme', slug: 'acme', status: 'active', plan: 'free' });
    service.create('ws-1', 'New task').subscribe();
    const req = ctrl.expectOne('/api/v1/orgs/org-1/tasks');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toMatchObject({ workspace_id: 'ws-1', title: 'New task' });
    req.flush({ data: { ...TASK_DTO, id: 'task-2', title: 'New task' }, error: null, meta: {} });
    tick();
    expect(service.tasks().length).toBe(1);
    expect(service.tasks()[0].title).toBe('New task');
  }));

  it('updateStatus() optimistically updates signal then confirms on success', fakeAsync(() => {
    tenant.setOrg({ id: 'org-1', name: 'Acme', slug: 'acme', status: 'active', plan: 'free' });
    service.tasks.set([{ ...TASK_DTO, id: 'task-1', assigneeIds: [], dueDate: null, orgId: 'org-1', workspaceId: 'ws-1', createdAt: '', updatedAt: '' }]);
    service.updateStatus('task-1', 'done', 1).subscribe();
    // Optimistic: signal updated before HTTP response
    expect(service.tasks()[0].status).toBe('done');
    ctrl.expectOne('/api/v1/orgs/org-1/tasks/task-1')
      .flush({ data: { ...TASK_DTO, status: 'done', version: 2 }, error: null, meta: {} });
    tick();
    expect(service.tasks()[0].status).toBe('done');
    expect(service.tasks()[0].version).toBe(2);
  }));

  it('updateStatus() reverts signal on HTTP error', fakeAsync(() => {
    tenant.setOrg({ id: 'org-1', name: 'Acme', slug: 'acme', status: 'active', plan: 'free' });
    service.tasks.set([{ ...TASK_DTO, id: 'task-1', assigneeIds: [], dueDate: null, orgId: 'org-1', workspaceId: 'ws-1', createdAt: '', updatedAt: '' }]);
    service.updateStatus('task-1', 'done', 1).subscribe({ error: () => {} });
    expect(service.tasks()[0].status).toBe('done'); // optimistic
    ctrl.expectOne('/api/v1/orgs/org-1/tasks/task-1').error(new ErrorEvent('Network error'));
    tick();
    expect(service.tasks()[0].status).toBe('todo'); // reverted
  }));
});
