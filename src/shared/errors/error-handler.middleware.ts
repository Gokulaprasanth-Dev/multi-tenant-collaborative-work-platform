import { Request, Response, NextFunction } from 'express';
import { AppError } from './app-errors';
import { logger } from '../observability/logger';
import { ZodError } from 'zod';
import { v4 as uuidv4 } from 'uuid';

export function errorHandlerMiddleware(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const requestId = (req as any).id || uuidv4();
  const meta = { request_id: requestId };

  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message, details: err.details }, meta });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Input validation failed', details: err.flatten() }, meta });
    return;
  }
  if ((err as any).code === '23505') {
    res.status(409).json({ error: { code: 'DUPLICATE_ENTRY', message: 'Resource already exists' }, meta });
    return;
  }
  // Body parser errors (malformed JSON, payload too large)
  if ((err as any).type === 'entity.parse.failed' || err instanceof SyntaxError) {
    res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body contains invalid JSON' }, meta });
    return;
  }
  if ((err as any).type === 'entity.too.large' || (err as any).status === 413) {
    res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds size limit' }, meta });
    return;
  }
  logger.error({ err, requestId }, 'Unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' }, meta });
}
