/**
 * Unit tests for validate/validateQuery middleware
 */

import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';
import { validate, validateQuery } from '../../../src/shared/validation/validate.middleware';
import { ValidationError } from '../../../src/shared/errors/app-errors';

function makeReq(body: unknown = {}, query: unknown = {}): Request {
  return { body, query } as unknown as Request;
}

const mockRes = {} as Response;

describe('validate middleware', () => {
  const schema = z.object({
    name: z.string().min(1),
    age: z.number().int().positive(),
  });

  it('calls next() with no error for valid body', () => {
    const req = makeReq({ name: 'Alice', age: 30 });
    const next = jest.fn() as NextFunction;
    validate(schema)(req, mockRes, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('replaces req.body with parsed/coerced data', () => {
    const req = makeReq({ name: 'Bob', age: 25, extra: 'stripped' });
    const next = jest.fn() as NextFunction;
    validate(schema)(req, mockRes, next);
    expect(req.body).toEqual({ name: 'Bob', age: 25 });
  });

  it('calls next(ValidationError) for missing required field', () => {
    const req = makeReq({ name: 'Alice' }); // missing age
    const next = jest.fn() as NextFunction;
    validate(schema)(req, mockRes, next);
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
    const err = (next as jest.Mock).mock.calls[0][0] as ValidationError;
    expect(err.statusCode).toBe(400);
  });

  it('calls next(ValidationError) for wrong type', () => {
    const req = makeReq({ name: 'Alice', age: 'not-a-number' });
    const next = jest.fn() as NextFunction;
    validate(schema)(req, mockRes, next);
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it('includes field path in error details', () => {
    const req = makeReq({ name: '', age: 25 }); // name too short
    const next = jest.fn() as NextFunction;
    validate(schema)(req, mockRes, next);
    const err = (next as jest.Mock).mock.calls[0][0] as ValidationError;
    const details = (err.details as { errors: { field: string }[] }).errors;
    expect(details.some(e => e.field === 'name')).toBe(true);
  });

  it('validates nested object fields', () => {
    const nestedSchema = z.object({ user: z.object({ email: z.string().email() }) });
    const req = makeReq({ user: { email: 'not-an-email' } });
    const next = jest.fn() as NextFunction;
    validate(nestedSchema)(req, mockRes, next);
    const err = (next as jest.Mock).mock.calls[0][0] as ValidationError;
    const details = (err.details as { errors: { field: string }[] }).errors;
    expect(details.some(e => e.field === 'user.email')).toBe(true);
  });
});

describe('validateQuery middleware', () => {
  const querySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  });

  it('calls next() for valid query params', () => {
    const req = makeReq({}, { limit: '10', offset: '0' });
    const next = jest.fn() as NextFunction;
    validateQuery(querySchema)(req, mockRes, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('coerces string numbers to integers', () => {
    const req = makeReq({}, { limit: '50' });
    const next = jest.fn() as NextFunction;
    validateQuery(querySchema)(req, mockRes, next);
    expect((req.query as unknown as { limit: number }).limit).toBe(50);
  });

  it('calls next(ValidationError) when limit exceeds max', () => {
    const req = makeReq({}, { limit: '999' });
    const next = jest.fn() as NextFunction;
    validateQuery(querySchema)(req, mockRes, next);
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it('calls next(ValidationError) for negative offset', () => {
    const req = makeReq({}, { offset: '-5' });
    const next = jest.fn() as NextFunction;
    validateQuery(querySchema)(req, mockRes, next);
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it('passes with empty query (all optional)', () => {
    const req = makeReq({}, {});
    const next = jest.fn() as NextFunction;
    validateQuery(querySchema)(req, mockRes, next);
    expect(next).toHaveBeenCalledWith();
  });
});
