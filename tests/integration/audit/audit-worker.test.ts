/**
 * Integration tests for audit.worker.ts
 *
 * Covers:
 * - persistAuditLog: inserts a row in audit_logs with all fields
 * - persistAuditLog: actor_type 'system' (no orgId/actorId)
 * - persistAuditLog: payload stored as JSON
 * - auditWorkerJob: wrapper delegates to persistAuditLog
 */

import { v4 as uuidv4 } from 'uuid';
import { seedUser, seedOrg } from '../../helpers/db';
import { queryPrimary } from '../../../src/shared/database/pool';
import {
  persistAuditLog,
  auditWorkerJob,
  AuditPayload,
} from '../../../src/modules/audit/workers/audit.worker';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

maybeDescribe('audit.worker', () => {
  describe('persistAuditLog', () => {
    it('inserts a full audit log row', async () => {
      const { userId } = await seedUser();
      const { orgId } = await seedOrg({ ownerId: userId });
      const correlationId = uuidv4();

      await persistAuditLog({
        orgId,
        actorId: userId,
        actorType: 'user',
        eventType: 'task.created',
        entityType: 'task',
        entityId: uuidv4(),
        ipAddress: '127.0.0.1',
        userAgent: 'jest-test/1.0',
        payload: { key: 'value', count: 42 },
        correlationId,
      });

      const row = await queryPrimary<{
        org_id: string;
        actor_id: string;
        actor_type: string;
        event_type: string;
        entity_type: string;
        ip_address: string;
        user_agent: string;
        payload: Record<string, unknown>;
        correlation_id: string;
      }>(
        `SELECT org_id, actor_id, actor_type, event_type, entity_type,
                ip_address, user_agent, payload, correlation_id
         FROM audit_logs
         WHERE correlation_id = $1`,
        [correlationId]
      );

      expect(row.rows).toHaveLength(1);
      const r = row.rows[0]!;
      expect(r.org_id).toBe(orgId);
      expect(r.actor_id).toBe(userId);
      expect(r.actor_type).toBe('user');
      expect(r.event_type).toBe('task.created');
      expect(r.entity_type).toBe('task');
      expect(r.ip_address).toBe('127.0.0.1');
      expect(r.user_agent).toBe('jest-test/1.0');
      expect(r.correlation_id).toBe(correlationId);
    });

    it('inserts a system-level log without orgId or actorId', async () => {
      const correlationId = uuidv4();

      await persistAuditLog({
        actorType: 'system',
        eventType: 'system.cleanup_run',
        correlationId,
      });

      const row = await queryPrimary<{
        org_id: string | null;
        actor_id: string | null;
        actor_type: string;
        event_type: string;
      }>(
        `SELECT org_id, actor_id, actor_type, event_type
         FROM audit_logs
         WHERE correlation_id = $1`,
        [correlationId]
      );

      expect(row.rows).toHaveLength(1);
      const r = row.rows[0]!;
      expect(r.org_id).toBeNull();
      expect(r.actor_id).toBeNull();
      expect(r.actor_type).toBe('system');
      expect(r.event_type).toBe('system.cleanup_run');
    });

    it('stores payload as JSONB', async () => {
      const correlationId = uuidv4();
      const payload = { nested: { deep: true }, list: [1, 2, 3] };

      await persistAuditLog({
        actorType: 'system',
        eventType: 'test.payload',
        payload,
        correlationId,
      });

      const row = await queryPrimary<{ payload: Record<string, unknown> }>(
        `SELECT payload FROM audit_logs WHERE correlation_id = $1`,
        [correlationId]
      );

      expect(row.rows[0]!.payload).toEqual(payload);
    });

    it('uses provided occurredAt timestamp', async () => {
      const correlationId = uuidv4();
      const occurredAt = new Date('2024-01-15T10:00:00Z');

      await persistAuditLog({
        actorType: 'system',
        eventType: 'test.timestamp',
        occurredAt,
        correlationId,
      });

      const row = await queryPrimary<{ occurred_at: Date }>(
        `SELECT occurred_at FROM audit_logs WHERE correlation_id = $1`,
        [correlationId]
      );

      const stored = new Date(row.rows[0]!.occurred_at);
      expect(stored.getTime()).toBe(occurredAt.getTime());
    });
  });

  describe('auditWorkerJob', () => {
    it('delegates to persistAuditLog and inserts a row', async () => {
      const correlationId = uuidv4();

      await auditWorkerJob({
        data: {
          actorType: 'platform_admin',
          eventType: 'admin.org_suspended',
          correlationId,
        } as AuditPayload,
      });

      const row = await queryPrimary<{ event_type: string }>(
        `SELECT event_type FROM audit_logs WHERE correlation_id = $1`,
        [correlationId]
      );

      expect(row.rows).toHaveLength(1);
      expect(row.rows[0]!.event_type).toBe('admin.org_suspended');
    });
  });
});
