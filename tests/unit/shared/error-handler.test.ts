/**
 * Unit tests for shared/errors/error-handler.middleware.ts
 *
 * Covers:
 * - AppError subtypes → correct HTTP status + code
 * - ZodError → 400 VALIDATION_ERROR
 * - PostgreSQL unique-violation (code 23505) → 409 DUPLICATE_ENTRY
 * - SyntaxError / entity.parse.failed → 400 INVALID_JSON
 * - entity.too.large / status 413 → 413 PAYLOAD_TOO_LARGE
 * - Unknown error → 500 INTERNAL_ERROR
 * - Response includes meta.request_id
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  errorHandlerMiddleware,
} from '../../../src/shared/errors/error-handler.middleware';
import {
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  TooManyRequestsError,
} from '../../../src/shared/errors/app-errors';

function mockRes() {
  const json = jest.fn().mockReturnThis();
  const status = jest.fn().mockReturnThis();
  // chain status().json()
  status.mockReturnValue({ json });
  return { status, json, _json: json } as unknown as Response & { status: jest.Mock; _json: jest.Mock };
}

function mockReq(id?: string): Request {
  return { headers: {}, id } as unknown as Request;
}

const next: NextFunction = jest.fn();

describe('errorHandlerMiddleware', () => {
  describe('AppError subclasses', () => {
    it('maps BadRequestError → 400', () => {
      const res = mockRes();
      errorHandlerMiddleware(new BadRequestError('BAD', 'bad input'), mockReq(), res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      const body = (res.status as jest.Mock).mock.results[0].value.json.mock.calls[0][0];
      expect(body.error.code).toBe('BAD');
    });

    it('maps UnauthorizedError → 401', () => {
      const res = mockRes();
      errorHandlerMiddleware(new UnauthorizedError('MISSING_TOKEN', 'no token'), mockReq(), res, next);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('maps ForbiddenError → 403', () => {
      const res = mockRes();
      errorHandlerMiddleware(new ForbiddenError('FORBIDDEN', 'forbidden'), mockReq(), res, next);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('maps NotFoundError → 404', () => {
      const res = mockRes();
      errorHandlerMiddleware(new NotFoundError('Task'), mockReq(), res, next);
      expect(res.status).toHaveBeenCalledWith(404);
      const body = (res.status as jest.Mock).mock.results[0].value.json.mock.calls[0][0];
      expect(body.error.message).toContain('Task');
    });

    it('maps ConflictError → 409', () => {
      const res = mockRes();
      errorHandlerMiddleware(new ConflictError('CONFLICT', 'conflict'), mockReq(), res, next);
      expect(res.status).toHaveBeenCalledWith(409);
    });

    it('maps TooManyRequestsError → 429', () => {
      const res = mockRes();
      errorHandlerMiddleware(new TooManyRequestsError(30), mockReq(), res, next);
      expect(res.status).toHaveBeenCalledWith(429);
    });

    it('includes AppError details in response', () => {
      const res = mockRes();
      const err = new AppError(422, 'UNPROCESSABLE', 'msg', { field: 'value' });
      errorHandlerMiddleware(err, mockReq(), res, next);
      expect(res.status).toHaveBeenCalledWith(422);
      const body = (res.status as jest.Mock).mock.results[0].value.json.mock.calls[0][0];
      expect(body.error.details).toEqual({ field: 'value' });
    });
  });

  describe('ZodError', () => {
    it('maps ZodError → 400 VALIDATION_ERROR', () => {
      const schema = z.object({ name: z.string() });
      const result = schema.safeParse({ name: 123 });
      const res = mockRes();
      errorHandlerMiddleware(result.error!, mockReq(), res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      const body = (res.status as jest.Mock).mock.results[0].value.json.mock.calls[0][0];
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details).toBeDefined();
    });
  });

  describe('PostgreSQL error code 23505', () => {
    it('maps pg unique violation → 409 DUPLICATE_ENTRY', () => {
      const err = Object.assign(new Error('duplicate key'), { code: '23505' });
      const res = mockRes();
      errorHandlerMiddleware(err, mockReq(), res, next);
      expect(res.status).toHaveBeenCalledWith(409);
      const body = (res.status as jest.Mock).mock.results[0].value.json.mock.calls[0][0];
      expect(body.error.code).toBe('DUPLICATE_ENTRY');
    });
  });

  describe('JSON parse errors', () => {
    it('maps SyntaxError → 400 INVALID_JSON', () => {
      const err = new SyntaxError('Unexpected token');
      const res = mockRes();
      errorHandlerMiddleware(err, mockReq(), res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      const body = (res.status as jest.Mock).mock.results[0].value.json.mock.calls[0][0];
      expect(body.error.code).toBe('INVALID_JSON');
    });

    it('maps entity.parse.failed type → 400 INVALID_JSON', () => {
      const err = Object.assign(new Error('parse failed'), { type: 'entity.parse.failed' });
      const res = mockRes();
      errorHandlerMiddleware(err, mockReq(), res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      const body = (res.status as jest.Mock).mock.results[0].value.json.mock.calls[0][0];
      expect(body.error.code).toBe('INVALID_JSON');
    });
  });

  describe('Payload too large', () => {
    it('maps entity.too.large type → 413', () => {
      const err = Object.assign(new Error('too large'), { type: 'entity.too.large' });
      const res = mockRes();
      errorHandlerMiddleware(err, mockReq(), res, next);
      expect(res.status).toHaveBeenCalledWith(413);
      const body = (res.status as jest.Mock).mock.results[0].value.json.mock.calls[0][0];
      expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('maps status 413 → 413 PAYLOAD_TOO_LARGE', () => {
      const err = Object.assign(new Error('too big'), { status: 413 });
      const res = mockRes();
      errorHandlerMiddleware(err, mockReq(), res, next);
      expect(res.status).toHaveBeenCalledWith(413);
    });
  });

  describe('Unknown errors', () => {
    it('maps generic Error → 500 INTERNAL_ERROR', () => {
      const res = mockRes();
      errorHandlerMiddleware(new Error('something broke'), mockReq(), res, next);
      expect(res.status).toHaveBeenCalledWith(500);
      const body = (res.status as jest.Mock).mock.results[0].value.json.mock.calls[0][0];
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('meta.request_id', () => {
    it('includes request_id from req.id if available', () => {
      const res = mockRes();
      const reqWithId = mockReq('req-abc-123');
      errorHandlerMiddleware(new NotFoundError('X'), reqWithId, res, next);
      const body = (res.status as jest.Mock).mock.results[0].value.json.mock.calls[0][0];
      expect(body.meta.request_id).toBe('req-abc-123');
    });

    it('generates a uuid request_id when req.id is absent', () => {
      const res = mockRes();
      errorHandlerMiddleware(new NotFoundError('X'), mockReq(), res, next);
      const body = (res.status as jest.Mock).mock.results[0].value.json.mock.calls[0][0];
      expect(body.meta.request_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
    });
  });
});
