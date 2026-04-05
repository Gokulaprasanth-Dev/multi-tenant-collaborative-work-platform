import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate, validateQuery } from '../../shared/validation/validate.middleware';
import { jwtMiddleware } from '../../shared/auth-middleware/jwt.middleware';
import { orgContextMiddleware } from '../../shared/auth-middleware/org-context.middleware';
import { orgStatusMiddleware } from '../../shared/auth-middleware/org-status.middleware';
import { idempotencyMiddleware } from '../../shared/idempotency/idempotency.middleware';
import * as TaskService from './task.service';
import * as DependencyService from './dependency.service';
import * as BulkService from './bulk.service';
import * as TemplateService from './template.service';
import * as CommentService from './comment.service';
import * as ActivityLogService from './activity-log.service';

const router = Router();
const orgMiddleware = [jwtMiddleware, orgContextMiddleware, orgStatusMiddleware];
const orgMiddlewareWithIdempotency = [...orgMiddleware, idempotencyMiddleware];

// ── Task schemas ──────────────────────────────────────────────────────────────

const taskStatusEnum = z.enum(['todo', 'in_progress', 'in_review', 'done', 'cancelled']);
const taskPriorityEnum = z.enum(['low', 'medium', 'high', 'urgent']);

const createTaskSchema = z.object({
  workspace_id: z.string().uuid(),
  board_id: z.string().uuid().nullable().optional(),
  parent_task_id: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(500),
  description: z.record(z.unknown()).nullable().optional(),
  status: taskStatusEnum.optional(),
  priority: taskPriorityEnum.optional(),
  due_date: z.string().datetime().nullable().optional(),
  is_recurring: z.boolean().optional(),
  recurrence_rule: z.string().nullable().optional(),
  template_id: z.string().uuid().nullable().optional(),
  labels: z.array(z.string()).optional(),
  assignee_ids: z.array(z.string().uuid()).optional(),
});

const updateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.record(z.unknown()).nullable().optional(),
  status: taskStatusEnum.optional(),
  priority: taskPriorityEnum.optional(),
  due_date: z.string().datetime().nullable().optional(),
  board_id: z.string().uuid().nullable().optional(),
  labels: z.array(z.string()).optional(),
  is_recurring: z.boolean().optional(),
  recurrence_rule: z.string().nullable().optional(),
  assignee_ids: z.array(z.string().uuid()).optional(),
  version: z.number().int().positive(),
});

const listTasksQuerySchema = z.object({
  workspace_id: z.string().uuid().optional(),
  board_id: z.string().uuid().optional(),
  status: taskStatusEnum.optional(),
});

// ── Tasks CRUD ─────────────────────────────────────────────────────────────────

// POST /api/v1/orgs/:orgId/tasks
router.post(
  '/orgs/:orgId/tasks',
  ...orgMiddlewareWithIdempotency,
  validate(createTaskSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = req.body as TaskService.CreateTaskInput & { due_date?: string | null };
      const task = await TaskService.createTask(req.orgContext!.orgId, req.user!.userId, {
        ...input,
        due_date: input.due_date ? new Date(input.due_date) : undefined,
      });
      res.created(task);
    } catch (err) { next(err); }
  }
);

// GET /api/v1/orgs/:orgId/tasks
router.get(
  '/orgs/:orgId/tasks',
  ...orgMiddleware,
  validateQuery(listTasksQuerySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tasks = await TaskService.listTasks(req.orgContext!.orgId, req.query as {
        workspaceId?: string; boardId?: string; status?: string;
      });
      res.success(tasks);
    } catch (err) { next(err); }
  }
);

// GET /api/v1/orgs/:orgId/tasks/:taskId
router.get(
  '/orgs/:orgId/tasks/:taskId',
  ...orgMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const task = await TaskService.getTask(req.orgContext!.orgId, req.params['taskId']!);
      res.success(task);
    } catch (err) { next(err); }
  }
);

// PATCH /api/v1/orgs/:orgId/tasks/:taskId
router.patch(
  '/orgs/:orgId/tasks/:taskId',
  ...orgMiddlewareWithIdempotency,
  validate(updateTaskSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = req.body as TaskService.UpdateTaskInput & { due_date?: string | null };
      const task = await TaskService.updateTask(
        req.orgContext!.orgId,
        req.params['taskId']!,
        req.user!.userId,
        {
          ...input,
          due_date: input.due_date !== undefined ? (input.due_date ? new Date(input.due_date) : null) : undefined,
        }
      );
      res.success(task);
    } catch (err) { next(err); }
  }
);

// DELETE /api/v1/orgs/:orgId/tasks/:taskId
router.delete(
  '/orgs/:orgId/tasks/:taskId',
  ...orgMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await TaskService.deleteTask(req.orgContext!.orgId, req.params['taskId']!, req.user!.userId);
      res.success({ message: 'Task deleted' });
    } catch (err) { next(err); }
  }
);

// ── Dependencies ──────────────────────────────────────────────────────────────

// POST /api/v1/orgs/:orgId/tasks/:taskId/dependencies
router.post(
  '/orgs/:orgId/tasks/:taskId/dependencies',
  ...orgMiddlewareWithIdempotency,
  validate(z.object({
    blocked_task_id: z.string().uuid(),
  })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dep = await DependencyService.addDependency(
        req.orgContext!.orgId,
        req.params['taskId']!,
        (req.body as { blocked_task_id: string }).blocked_task_id,
        req.user!.userId
      );
      res.created(dep);
    } catch (err) { next(err); }
  }
);

// GET /api/v1/orgs/:orgId/tasks/:taskId/dependencies
router.get(
  '/orgs/:orgId/tasks/:taskId/dependencies',
  ...orgMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deps = await DependencyService.listDependencies(
        req.orgContext!.orgId, req.params['taskId']!
      );
      res.success(deps);
    } catch (err) { next(err); }
  }
);

// DELETE /api/v1/orgs/:orgId/tasks/dependencies/:dependencyId
router.delete(
  '/orgs/:orgId/tasks/dependencies/:dependencyId',
  ...orgMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await DependencyService.removeDependency(
        req.orgContext!.orgId, req.params['dependencyId']!
      );
      res.success({ message: 'Dependency removed' });
    } catch (err) { next(err); }
  }
);

// ── Bulk operations ───────────────────────────────────────────────────────────

// POST /api/v1/orgs/:orgId/tasks/bulk/status
router.post(
  '/orgs/:orgId/tasks/bulk/status',
  ...orgMiddlewareWithIdempotency,
  validate(z.object({
    task_ids: z.array(z.string().uuid()).min(1).max(100),
    status: taskStatusEnum,
  })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { task_ids, status } = req.body as { task_ids: string[]; status: string };
      const result = await BulkService.bulkUpdateStatus(
        req.orgContext!.orgId,
        req.user!.userId,
        { taskIds: task_ids, status: status as TaskService.UpdateTaskInput['status'] & string as never }
      );
      res.success(result);
    } catch (err) { next(err); }
  }
);

// DELETE /api/v1/orgs/:orgId/tasks/bulk
router.delete(
  '/orgs/:orgId/tasks/bulk',
  ...orgMiddleware,
  validate(z.object({
    task_ids: z.array(z.string().uuid()).min(1).max(100),
  })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { task_ids } = req.body as { task_ids: string[] };
      const result = await BulkService.bulkDelete(
        req.orgContext!.orgId, req.user!.userId, { taskIds: task_ids }
      );
      res.success(result);
    } catch (err) { next(err); }
  }
);

// ── Templates ─────────────────────────────────────────────────────────────────

// POST /api/v1/orgs/:orgId/task-templates
router.post(
  '/orgs/:orgId/task-templates',
  ...orgMiddlewareWithIdempotency,
  validate(z.object({
    name: z.string().min(1).max(255),
    default_title: z.string().max(500).nullable().optional(),
    default_description: z.record(z.unknown()).nullable().optional(),
    default_priority: z.enum(['low', 'medium', 'high', 'urgent']).nullable().optional(),
    default_labels: z.array(z.string()).optional(),
  })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const template = await TemplateService.createTemplate(
        req.orgContext!.orgId, req.user!.userId, req.body as TemplateService.CreateTemplateInput
      );
      res.created(template);
    } catch (err) { next(err); }
  }
);

// GET /api/v1/orgs/:orgId/task-templates
router.get(
  '/orgs/:orgId/task-templates',
  ...orgMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const templates = await TemplateService.listTemplates(req.orgContext!.orgId);
      res.success(templates);
    } catch (err) { next(err); }
  }
);

// DELETE /api/v1/orgs/:orgId/task-templates/:templateId
router.delete(
  '/orgs/:orgId/task-templates/:templateId',
  ...orgMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await TemplateService.deleteTemplate(
        req.orgContext!.orgId, req.params['templateId']!, req.user!.userId
      );
      res.success({ message: 'Template deleted' });
    } catch (err) { next(err); }
  }
);

// ── Comments ──────────────────────────────────────────────────────────────────

// POST /api/v1/orgs/:orgId/tasks/:taskId/comments
router.post(
  '/orgs/:orgId/tasks/:taskId/comments',
  ...orgMiddlewareWithIdempotency,
  validate(z.object({
    body: z.record(z.unknown()),
    parent_comment_id: z.string().uuid().nullable().optional(),
  })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = req.body as CommentService.CreateCommentInput;
      const comment = await CommentService.createComment(
        req.orgContext!.orgId,
        req.user!.userId,
        { ...input, task_id: req.params['taskId']! }
      );
      res.created(comment);
    } catch (err) { next(err); }
  }
);

// GET /api/v1/orgs/:orgId/tasks/:taskId/comments
router.get(
  '/orgs/:orgId/tasks/:taskId/comments',
  ...orgMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const comments = await CommentService.listComments(
        req.orgContext!.orgId, req.params['taskId']!
      );
      res.success(comments);
    } catch (err) { next(err); }
  }
);

// DELETE /api/v1/orgs/:orgId/tasks/:taskId/comments/:commentId
router.delete(
  '/orgs/:orgId/tasks/:taskId/comments/:commentId',
  ...orgMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await CommentService.deleteComment(
        req.orgContext!.orgId, req.params['commentId']!, req.user!.userId
      );
      res.success({ message: 'Comment deleted' });
    } catch (err) { next(err); }
  }
);

// ── Activity log ──────────────────────────────────────────────────────────────

// GET /api/v1/orgs/:orgId/tasks/:taskId/activity
router.get(
  '/orgs/:orgId/tasks/:taskId/activity',
  ...orgMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const activity = await ActivityLogService.listForTask(
        req.orgContext!.orgId, req.params['taskId']!
      );
      res.success(activity);
    } catch (err) { next(err); }
  }
);

// GET /api/v1/orgs/:orgId/activity
router.get(
  '/orgs/:orgId/activity',
  ...orgMiddleware,
  validateQuery(z.object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Number(req.query['limit'] ?? 100);
      const offset = Number(req.query['offset'] ?? 0);
      const activity = await ActivityLogService.listForOrg(req.orgContext!.orgId, limit, offset);
      res.success(activity);
    } catch (err) { next(err); }
  }
);

export default router;
