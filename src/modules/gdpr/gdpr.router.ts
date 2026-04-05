/**
 * GDPR API Routes — SPEC §6.2
 * POST /orgs/:orgId/gdpr/export-request    — request user data export
 * POST /orgs/:orgId/gdpr/erasure-request   — request user erasure (re-auth gate)
 * POST /admin/orgs/:orgId/gdpr/org-export  — org-level data export (admin)
 * POST /admin/orgs/:orgId/offboard         — initiate org offboarding (admin)
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate } from '../../shared/validation/validate.middleware';
import { jwtMiddleware } from '../../shared/auth-middleware/jwt.middleware';
import { orgContextMiddleware } from '../../shared/auth-middleware/org-context.middleware';
import { orgStatusMiddleware } from '../../shared/auth-middleware/org-status.middleware';
import { platformAdminMiddleware } from '../platform-admin/admin.middleware';
import { enqueue } from '../../shared/queue/queues';
import { queryPrimary, queryReplica } from '../../shared/database/pool';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../../shared/errors/app-errors';
import { logger } from '../../shared/observability/logger';
import bcrypt from 'bcryptjs';

const router = Router();

const orgMiddleware = [jwtMiddleware, orgContextMiddleware, orgStatusMiddleware];

// ── POST /orgs/:orgId/gdpr/export-request ─────────────────────────────────
// Enqueue a user data export job; emits gdpr.export_ready outbox event when done.
router.post(
  '/orgs/:orgId/gdpr/export-request',
  ...orgMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId } = req.orgContext!;
      const userId = req.user!.userId;

      await enqueue('gdpr-export', 'gdpr-user-export', {
        userId,
        orgId,
        requestedAt: new Date().toISOString(),
      });

      logger.info({ userId, orgId }, 'gdpr: user export enqueued');
      res.accepted({ message: 'Export request received. You will receive a download link by email.' });
    } catch (err) { next(err); }
  }
);

const ErasureRequestSchema = z.object({
  password: z.string().min(1),
  confirm: z.literal('DELETE MY ACCOUNT'),
});

// ── POST /orgs/:orgId/gdpr/erasure-request ────────────────────────────────
// Re-auth gate: requires current password + explicit confirmation phrase.
// Enqueues erase-user job. Retains payment rows.
router.post(
  '/orgs/:orgId/gdpr/erasure-request',
  ...orgMiddleware,
  validate(ErasureRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId } = req.orgContext!;
      const userId = req.user!.userId;

      // Re-auth gate — fetch current password_hash
      const userResult = await queryPrimary<{ password_hash: string | null }>(
        `SELECT password_hash FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [userId]
      );

      if (userResult.rows.length === 0) throw new NotFoundError('User');

      const { password_hash } = userResult.rows[0]!;
      if (!password_hash) {
        // SSO-only user — no password to verify; block local erasure, require support
        throw new ForbiddenError(
          'SSO_ONLY_ACCOUNT',
          'Erasure for SSO-only accounts must be requested via support.'
        );
      }

      const valid = await bcrypt.compare(req.body.password as string, password_hash);
      if (!valid) throw new UnauthorizedError('INVALID_PASSWORD', 'Incorrect password.');

      await enqueue('erase-user', 'erase-user', { userId, orgId });

      logger.info({ userId, orgId }, 'gdpr: erasure request enqueued');
      res.accepted({ message: 'Erasure request received. Your account data will be anonymised.' });
    } catch (err) { next(err); }
  }
);

// ── POST /admin/orgs/:orgId/gdpr/org-export ───────────────────────────────
// Platform admin: enqueue org-level data export.
router.post(
  '/admin/orgs/:orgId/gdpr/org-export',
  jwtMiddleware,
  platformAdminMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId } = req.params as { orgId: string };
      const requestedByUserId = req.user!.userId;

      const orgResult = await queryReplica(
        `SELECT id FROM organizations WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [orgId]
      );
      if (orgResult.rows.length === 0) throw new NotFoundError('Organization');

      await enqueue('gdpr-org-export', 'gdpr-org-export', {
        orgId,
        requestedByUserId,
        requestedAt: new Date().toISOString(),
      });

      logger.info({ orgId, requestedByUserId }, 'gdpr: org export enqueued');
      res.accepted({ message: 'Org export request received.' });
    } catch (err) { next(err); }
  }
);

// ── POST /admin/orgs/:orgId/offboard ──────────────────────────────────────
// Platform admin: initiate org offboarding (sets status → 'offboarding', enqueues job).
router.post(
  '/admin/orgs/:orgId/offboard',
  jwtMiddleware,
  platformAdminMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId } = req.params as { orgId: string };

      const orgResult = await queryPrimary<{ status: string }>(
        `SELECT status FROM organizations WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [orgId]
      );
      if (orgResult.rows.length === 0) throw new NotFoundError('Organization');

      const { status } = orgResult.rows[0]!;
      if (status === 'deleted') {
        throw new ForbiddenError('ORG_ALREADY_DELETED', 'Organization is already deleted.');
      }

      // Set to offboarding
      await queryPrimary(
        `UPDATE organizations SET status = 'offboarding', offboarding_started_at = NOW() WHERE id = $1`,
        [orgId]
      );

      await enqueue('offboarding', 'offboard-org', { orgId });

      logger.info({ orgId }, 'gdpr: org offboarding initiated');
      res.accepted({ message: 'Offboarding initiated.' });
    } catch (err) { next(err); }
  }
);

export default router;
