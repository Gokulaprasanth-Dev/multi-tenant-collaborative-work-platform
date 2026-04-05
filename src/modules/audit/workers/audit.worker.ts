import { queryPrimary } from '../../../shared/database/pool';

export interface AuditPayload {
  orgId?: string;
  actorId?: string;
  actorType: 'user' | 'system' | 'platform_admin';
  eventType: string;
  entityType?: string;
  entityId?: string;
  ipAddress?: string;
  userAgent?: string;
  payload?: Record<string, unknown>;
  correlationId?: string;
  occurredAt?: Date;
}

export async function persistAuditLog(data: AuditPayload): Promise<void> {
  await queryPrimary(`
    INSERT INTO audit_logs
      (org_id, actor_id, actor_type, event_type, entity_type, entity_id,
       ip_address, user_agent, payload, correlation_id, occurred_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
  `, [
    data.orgId || null, data.actorId || null, data.actorType,
    data.eventType, data.entityType || null, data.entityId || null,
    data.ipAddress || null, data.userAgent || null,
    JSON.stringify(data.payload || {}), data.correlationId || null,
    data.occurredAt || new Date(),
  ]);
}

export async function auditWorkerJob(job: { data: AuditPayload }): Promise<void> {
  await persistAuditLog(job.data);
}
