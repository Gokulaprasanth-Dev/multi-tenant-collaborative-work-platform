import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate, validateQuery } from '../../shared/validation/validate.middleware';
import { jwtMiddleware } from '../../shared/auth-middleware/jwt.middleware';
import { orgContextMiddleware } from '../../shared/auth-middleware/org-context.middleware';
import { orgStatusMiddleware } from '../../shared/auth-middleware/org-status.middleware';
import { idempotencyMiddleware } from '../../shared/idempotency/idempotency.middleware';
import * as ChannelService from './channel.service';
import * as MessageService from './message.service';

const router = Router();
const orgMiddleware = [jwtMiddleware, orgContextMiddleware, orgStatusMiddleware];
const orgMiddlewareWithIdempotency = [...orgMiddleware, idempotencyMiddleware];

// ── Channels ──────────────────────────────────────────────────────────────────

// POST /api/v1/orgs/:orgId/channels/direct
router.post(
  '/orgs/:orgId/channels/direct',
  ...orgMiddlewareWithIdempotency,
  validate(z.object({
    other_user_id: z.string().uuid(),
  })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { other_user_id } = req.body as { other_user_id: string };
      const { channel, created } = await ChannelService.createDirect(
        req.orgContext!.orgId,
        req.user!.userId,
        other_user_id
      );
      if (created) {
        res.created(channel);
      } else {
        res.success(channel);
      }
    } catch (err) { next(err); }
  }
);

// POST /api/v1/orgs/:orgId/channels/group
router.post(
  '/orgs/:orgId/channels/group',
  ...orgMiddlewareWithIdempotency,
  validate(z.object({
    name: z.string().min(1).max(255),
    member_ids: z.array(z.string().uuid()).min(2),
  })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, member_ids } = req.body as { name: string; member_ids: string[] };
      const channel = await ChannelService.createGroup(
        req.orgContext!.orgId,
        req.user!.userId,
        name,
        member_ids
      );
      res.created(channel);
    } catch (err) { next(err); }
  }
);

// GET /api/v1/orgs/:orgId/channels
router.get(
  '/orgs/:orgId/channels',
  ...orgMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const channels = await ChannelService.listChannels(req.orgContext!.orgId);
      res.success(channels);
    } catch (err) { next(err); }
  }
);

// GET /api/v1/orgs/:orgId/channels/:channelId
router.get(
  '/orgs/:orgId/channels/:channelId',
  ...orgMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const channel = await ChannelService.getChannel(
        req.orgContext!.orgId, req.params['channelId']!
      );
      res.success(channel);
    } catch (err) { next(err); }
  }
);

// ── Messages ──────────────────────────────────────────────────────────────────

// POST /api/v1/orgs/:orgId/channels/:channelId/messages
router.post(
  '/orgs/:orgId/channels/:channelId/messages',
  ...orgMiddlewareWithIdempotency,
  validate(z.object({
    body: z.string().min(1),
    body_parsed: z.record(z.unknown()).nullable().optional(),
    client_message_id: z.string().uuid(),
    parent_message_id: z.string().uuid().nullable().optional(),
  })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = req.body as {
        body: string;
        body_parsed?: Record<string, unknown> | null;
        client_message_id: string;
        parent_message_id?: string | null;
      };
      const message = await MessageService.send(req.orgContext!.orgId, {
        channelId: req.params['channelId']!,
        senderId: req.user!.userId,
        body: input.body,
        bodyParsed: input.body_parsed,
        clientMessageId: input.client_message_id,
        parentMessageId: input.parent_message_id,
      });
      res.created(message);
    } catch (err) { next(err); }
  }
);

// GET /api/v1/orgs/:orgId/channels/:channelId/messages
router.get(
  '/orgs/:orgId/channels/:channelId/messages',
  ...orgMiddleware,
  validateQuery(z.object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    before_sequence: z.coerce.bigint().optional(),
  })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Number(req.query['limit'] ?? 50);
      const beforeSeq = req.query['before_sequence']
        ? BigInt(req.query['before_sequence'] as string)
        : undefined;
      const messages = await MessageService.listMessages(
        req.orgContext!.orgId,
        req.params['channelId']!,
        req.user!.userId,
        limit,
        beforeSeq
      );
      res.success(messages);
    } catch (err) { next(err); }
  }
);

// DELETE /api/v1/orgs/:orgId/channels/:channelId/messages/:messageId
router.delete(
  '/orgs/:orgId/channels/:channelId/messages/:messageId',
  ...orgMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await MessageService.deleteMessage(
        req.orgContext!.orgId,
        req.params['messageId']!,
        req.params['channelId']!,
        req.user!.userId
      );
      res.success({ message: 'Message deleted' });
    } catch (err) { next(err); }
  }
);

export default router;
