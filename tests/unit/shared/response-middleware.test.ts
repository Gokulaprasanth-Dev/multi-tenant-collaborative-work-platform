/**
 * Unit tests for src/shared/response/response.middleware.ts
 *
 * Covers:
 * - responseEnvelopeMiddleware: attaches res.success, res.created, res.accepted
 * - res.success: returns { data, error: null, meta } with status 200 by default
 * - res.success: accepts custom status code
 * - res.created: returns status 201
 * - res.accepted: returns status 202
 * - meta includes correlation_id from x-correlation-id header when present
 * - meta generates correlation_id when header is absent
 * - meta includes request_id (uuid) and timestamp
 */

import { Request, Response, NextFunction } from 'express';
import { responseEnvelopeMiddleware } from '../../../src/shared/response/response.middleware';

function makeReqRes(correlationId?: string) {
  const req = {
    headers: correlationId ? { 'x-correlation-id': correlationId } : {},
  } as unknown as Request;

  let capturedStatus = 0;
  let capturedBody: unknown = null;

  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockImplementation((body: unknown) => {
      capturedBody = body;
    }),
    get body() { return capturedBody; },
    get statusCode() { return capturedStatus; },
  } as unknown as Response;

  // chain: status().json() → capture both
  (res.status as jest.Mock).mockImplementation((code: number) => {
    capturedStatus = code;
    return res;
  });

  return { req, res, next: jest.fn() as NextFunction };
}

function getBody(res: Response): Record<string, unknown> {
  return (res as any).body as Record<string, unknown>;
}

describe('responseEnvelopeMiddleware', () => {
  it('calls next()', () => {
    const { req, res, next } = makeReqRes();
    responseEnvelopeMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('attaches res.success, res.created, and res.accepted', () => {
    const { req, res, next } = makeReqRes();
    responseEnvelopeMiddleware(req, res, next);
    expect(typeof (res as any).success).toBe('function');
    expect(typeof (res as any).created).toBe('function');
    expect(typeof (res as any).accepted).toBe('function');
  });

  describe('res.success', () => {
    it('sends status 200 by default', () => {
      const { req, res, next } = makeReqRes();
      responseEnvelopeMiddleware(req, res, next);
      (res as any).success({ id: 'x' });
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('wraps data in envelope { data, error: null, meta }', () => {
      const { req, res, next } = makeReqRes();
      responseEnvelopeMiddleware(req, res, next);
      (res as any).success({ value: 42 });
      const body = getBody(res) as any;
      expect(body.data).toEqual({ value: 42 });
      expect(body.error).toBeNull();
      expect(body.meta).toBeDefined();
    });

    it('accepts custom status code', () => {
      const { req, res, next } = makeReqRes();
      responseEnvelopeMiddleware(req, res, next);
      (res as any).success({ ok: true }, 206);
      expect(res.status).toHaveBeenCalledWith(206);
    });
  });

  describe('res.created', () => {
    it('sends status 201', () => {
      const { req, res, next } = makeReqRes();
      responseEnvelopeMiddleware(req, res, next);
      (res as any).created({ id: 'new-1' });
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('includes data in envelope', () => {
      const { req, res, next } = makeReqRes();
      responseEnvelopeMiddleware(req, res, next);
      (res as any).created({ id: 'new-1' });
      expect(getBody(res) as any).toMatchObject({ data: { id: 'new-1' }, error: null });
    });
  });

  describe('res.accepted', () => {
    it('sends status 202', () => {
      const { req, res, next } = makeReqRes();
      responseEnvelopeMiddleware(req, res, next);
      (res as any).accepted({ jobId: 'job-1' });
      expect(res.status).toHaveBeenCalledWith(202);
    });
  });

  describe('meta', () => {
    it('uses x-correlation-id header when present', () => {
      const { req, res, next } = makeReqRes('corr-abc');
      responseEnvelopeMiddleware(req, res, next);
      (res as any).success({});
      const meta = (getBody(res) as any).meta;
      expect(meta.correlation_id).toBe('corr-abc');
    });

    it('generates a uuid correlation_id when header is absent', () => {
      const { req, res, next } = makeReqRes();
      responseEnvelopeMiddleware(req, res, next);
      (res as any).success({});
      const meta = (getBody(res) as any).meta;
      expect(meta.correlation_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
    });

    it('includes request_id (uuid)', () => {
      const { req, res, next } = makeReqRes();
      responseEnvelopeMiddleware(req, res, next);
      (res as any).success({});
      const meta = (getBody(res) as any).meta;
      expect(meta.request_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
    });

    it('includes timestamp (ISO string)', () => {
      const { req, res, next } = makeReqRes();
      responseEnvelopeMiddleware(req, res, next);
      (res as any).success({});
      const meta = (getBody(res) as any).meta;
      expect(new Date(meta.timestamp).toString()).not.toBe('Invalid Date');
    });

    it('all three methods share the same correlation_id and request_id', () => {
      const { req, res, next } = makeReqRes('corr-same');
      responseEnvelopeMiddleware(req, res, next);

      (res as any).success({});
      const meta1 = (getBody(res) as any).meta;

      (res as any).created({});
      const meta2 = (getBody(res) as any).meta;

      expect(meta1.correlation_id).toBe(meta2.correlation_id);
      expect(meta1.request_id).toBe(meta2.request_id);
    });
  });
});
