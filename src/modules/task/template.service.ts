import { queryPrimary, queryReplica } from '../../shared/database/pool';
import { NotFoundError, ForbiddenError } from '../../shared/errors/app-errors';
import { MembershipRepository } from '../organization/repositories/membership.repository';

const memberRepo = new MembershipRepository();

export interface TaskTemplateRow {
  id: string;
  org_id: string;
  name: string;
  default_title: string | null;
  default_description: Record<string, unknown> | null;
  default_priority: 'low' | 'medium' | 'high' | 'urgent' | null;
  default_labels: string[];
  created_by: string;
  deleted_at: Date | null;
  created_at: Date;
}

export interface CreateTemplateInput {
  name: string;
  default_title?: string | null;
  default_description?: Record<string, unknown> | null;
  default_priority?: TaskTemplateRow['default_priority'];
  default_labels?: string[];
}

async function assertAdminOrOwner(orgId: string, userId: string): Promise<void> {
  const membership = await memberRepo.findMembership(orgId, userId);
  const role = membership?.role;
  if (role !== 'org_owner' && role !== 'org_admin') {
    throw new ForbiddenError('INSUFFICIENT_ROLE', 'Only org admins or owners can manage templates');
  }
}

export async function createTemplate(
  orgId: string,
  userId: string,
  input: CreateTemplateInput
): Promise<TaskTemplateRow> {
  await assertAdminOrOwner(orgId, userId);

  const result = await queryPrimary(
    `INSERT INTO task_templates (org_id, name, default_title, default_description, default_priority, default_labels, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      orgId,
      input.name,
      input.default_title ?? null,
      input.default_description ? JSON.stringify(input.default_description) : null,
      input.default_priority ?? null,
      input.default_labels ?? [],
      userId,
    ]
  );
  return result.rows[0] as unknown as TaskTemplateRow;
}

export async function listTemplates(orgId: string): Promise<TaskTemplateRow[]> {
  const result = await queryReplica(
    `SELECT * FROM task_templates WHERE org_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC`,
    [orgId]
  );
  return result.rows as unknown as TaskTemplateRow[];
}

export async function getTemplate(orgId: string, templateId: string): Promise<TaskTemplateRow> {
  const result = await queryReplica(
    `SELECT * FROM task_templates WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL LIMIT 1`,
    [templateId, orgId]
  );
  const row = result.rows[0] as unknown as TaskTemplateRow | undefined;
  if (!row) throw new NotFoundError('TaskTemplate');
  return row;
}

export async function deleteTemplate(
  orgId: string,
  templateId: string,
  userId: string
): Promise<void> {
  await assertAdminOrOwner(orgId, userId);

  const result = await queryPrimary(
    `UPDATE task_templates SET deleted_at = NOW()
     WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL
     RETURNING id`,
    [templateId, orgId]
  );
  if (result.rows.length === 0) throw new NotFoundError('TaskTemplate');
}
