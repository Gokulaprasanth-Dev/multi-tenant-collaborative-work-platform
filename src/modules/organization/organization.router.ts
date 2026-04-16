import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate } from '../../shared/validation/validate.middleware';
import { jwtMiddleware } from '../../shared/auth-middleware/jwt.middleware';
import { orgContextMiddleware } from '../../shared/auth-middleware/org-context.middleware';
import { orgStatusMiddleware } from '../../shared/auth-middleware/org-status.middleware';
import { idempotencyMiddleware } from '../../shared/idempotency/idempotency.middleware';
import { queryReplica } from '../../shared/database/pool';
import { ForbiddenError, NotFoundError } from '../../shared/errors/app-errors';
import * as OrgService from './services/organization.service';
import type { UpdateOrgData } from './repositories/organization.repository';
import * as InvitationService from './services/invitation.service';

const router = Router();

// SEC-NEW-006 fix: explicit safe object construction — never spread raw DB row
function sanitizeUser(user: Record<string, unknown>): Record<string, unknown> {
  const {
    totp_secret: _t,
    password_hash: _p,
    mfa_backup_codes: _m,
    mfa_backup_codes_generated_at: _mg,
    ...safe
  } = user;
  return safe;
}

// ── GET /api/v1/me ─────────────────────────────────────────────────────────
router.get(
  '/me',
  jwtMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await queryReplica(
        `SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [req.user!.userId]
      );
      if (result.rows.length === 0) throw new NotFoundError('User');
      res.success(sanitizeUser(result.rows[0] as Record<string, unknown>));
    } catch (err) { next(err); }
  }
);

// ── org routes (require JWT + org context) ─────────────────────────────────
const orgMiddleware = [jwtMiddleware, orgContextMiddleware, orgStatusMiddleware];
const orgMiddlewareWithIdempotency = [...orgMiddleware, idempotencyMiddleware];

// POST /api/v1/orgs — create org (JWT only, no org context yet)
router.post(
  '/orgs',
  jwtMiddleware,
  idempotencyMiddleware,
  validate(z.object({
    name: z.string().min(1).max(255),
    slug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
    timezone: z.string().optional(),
    locale: z.string().optional(),
  })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = await OrgService.createOrg(req.user!.userId, req.body as OrgService.CreateOrgInput);
      res.created(org);
    } catch (err) { next(err); }
  }
);

// GET /api/v1/orgs/mine — list all orgs the current user is an active member of
router.get(
  '/orgs/mine',
  jwtMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await queryReplica(
        `SELECT o.id, o.name, o.slug, o.status, o.plan_tier
         FROM organizations o
         JOIN org_memberships m ON m.org_id = o.id
         WHERE m.user_id = $1
           AND m.status = 'active'
           AND m.deleted_at IS NULL
           AND o.deleted_at IS NULL
           AND o.status = 'active'
         ORDER BY o.created_at ASC`,
        [req.user!.userId]
      );
      res.success(result.rows);
    } catch (err) { next(err); }
  }
);

// GET /api/v1/orgs/:orgId
router.get(
  '/orgs/:orgId',
  ...orgMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = await OrgService.getOrg(req.orgContext!.orgId);
      res.success(org);
    } catch (err) { next(err); }
  }
);

// PATCH /api/v1/orgs/:orgId
router.patch(
  '/orgs/:orgId',
  ...orgMiddlewareWithIdempotency,
  validate(z.object({
    name: z.string().min(1).max(255).optional(),
    slug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/).optional(),
    timezone: z.string().optional(),
    locale: z.string().optional(),
    mfa_required: z.boolean().optional(),
    account_lockout_attempts: z.number().int().min(3).max(20).optional(),
    version: z.number().int().positive(),
  })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const role = req.orgContext!.memberRole;
      if (role !== 'org_owner' && role !== 'org_admin') {
        throw new ForbiddenError('INSUFFICIENT_ROLE', 'Only org owners and admins can update organization settings');
      }
      const { version, ...data } = req.body as { version: number } & UpdateOrgData;
      const org = await OrgService.updateOrg(req.orgContext!.orgId, data, version);
      res.success(org);
    } catch (err) { next(err); }
  }
);

// POST /api/v1/orgs/:orgId/suspend  (platform admin or org owner)
router.post(
  '/orgs/:orgId/suspend',
  ...orgMiddleware,
  validate(z.object({ reason: z.string().min(1).max(500) })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user!.isPlatformAdmin && req.orgContext!.memberRole !== 'org_owner') {
        throw new ForbiddenError('INSUFFICIENT_ROLE', 'Only platform admins or org owners can suspend an organization');
      }
      await OrgService.suspendOrg(req.orgContext!.orgId, req.body.reason as string, req.user!.userId);
      res.success({ message: 'Organization suspended' });
    } catch (err) { next(err); }
  }
);

// POST /api/v1/orgs/:orgId/reactivate
router.post(
  '/orgs/:orgId/reactivate',
  ...orgMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user!.isPlatformAdmin && req.orgContext!.memberRole !== 'org_owner') {
        throw new ForbiddenError('INSUFFICIENT_ROLE', 'Only platform admins or org owners can reactivate an organization');
      }
      await OrgService.reactivateOrg(req.orgContext!.orgId, req.user!.userId);
      res.success({ message: 'Organization reactivated' });
    } catch (err) { next(err); }
  }
);

// GET /api/v1/orgs/:orgId/members
router.get(
  '/orgs/:orgId/members',
  ...orgMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { MembershipRepository } = await import('./repositories/membership.repository');
      const repo = new MembershipRepository();
      const members = await repo.findMembersByOrg(req.orgContext!.orgId);
      res.success(members);
    } catch (err) { next(err); }
  }
);

// PATCH /api/v1/orgs/:orgId/members/:userId/role
router.patch(
  '/orgs/:orgId/members/:userId/role',
  ...orgMiddlewareWithIdempotency,
  validate(z.object({
    role: z.enum(['org_admin', 'member', 'guest']),
  })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const callerRole = req.orgContext!.memberRole;
      if (callerRole !== 'org_owner' && callerRole !== 'org_admin') {
        throw new ForbiddenError('INSUFFICIENT_ROLE', 'Only org owners and admins can change member roles');
      }
      const { MembershipRepository } = await import('./repositories/membership.repository');
      const repo = new MembershipRepository();
      const updated = await repo.updateRole(
        req.orgContext!.orgId,
        req.params['userId']!,
        (req.body as { role: 'org_admin' | 'member' | 'guest' }).role
      );
      if (!updated) throw new NotFoundError('Membership');
      res.success(updated);
    } catch (err) { next(err); }
  }
);

// DELETE /api/v1/orgs/:orgId/members/:userId
router.delete(
  '/orgs/:orgId/members/:userId',
  ...orgMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const callerRole = req.orgContext!.memberRole;
      if (callerRole !== 'org_owner' && callerRole !== 'org_admin') {
        throw new ForbiddenError('INSUFFICIENT_ROLE', 'Only org owners and admins can remove members');
      }
      const { MembershipRepository } = await import('./repositories/membership.repository');
      const repo = new MembershipRepository();
      await repo.removeMembership(req.orgContext!.orgId, req.params['userId']!);
      res.success({ message: 'Member removed' });
    } catch (err) { next(err); }
  }
);

// POST /api/v1/orgs/:orgId/invitations
router.post(
  '/orgs/:orgId/invitations',
  ...orgMiddlewareWithIdempotency,
  validate(z.object({
    email: z.string().email(),
    role: z.enum(['org_admin', 'member', 'guest']),
  })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const callerRole = req.orgContext!.memberRole;
      if (callerRole !== 'org_owner' && callerRole !== 'org_admin') {
        throw new ForbiddenError('INSUFFICIENT_ROLE', 'Only org owners and admins can invite members');
      }
      const { email, role } = req.body as { email: string; role: 'org_admin' | 'member' | 'guest' };
      const invitation = await InvitationService.invite(
        req.orgContext!.orgId,
        req.user!.userId,
        email,
        role
      );
      res.created(invitation);
    } catch (err) { next(err); }
  }
);

// DELETE /api/v1/orgs/:orgId/invitations/:invitationId
router.delete(
  '/orgs/:orgId/invitations/:invitationId',
  ...orgMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const callerRole = req.orgContext!.memberRole;
      if (callerRole !== 'org_owner' && callerRole !== 'org_admin') {
        throw new ForbiddenError('INSUFFICIENT_ROLE', 'Only org owners and admins can revoke invitations');
      }
      await InvitationService.revokeInvitation(
        req.orgContext!.orgId,
        req.params['invitationId']!,
        req.user!.userId
      );
      res.success({ message: 'Invitation revoked' });
    } catch (err) { next(err); }
  }
);

// POST /api/v1/orgs/invitations/accept  (public — no JWT required)
router.post(
  '/orgs/invitations/accept',
  validate(z.object({ token: z.string().min(1) })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await InvitationService.acceptInvitation((req.body as { token: string }).token);
      res.success(result);
    } catch (err) { next(err); }
  }
);

export default router;
