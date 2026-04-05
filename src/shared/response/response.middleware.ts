import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Response {
      success(data: unknown, statusCode?: number): void;
      created(data: unknown): void;
      accepted(data: unknown): void;
    }
  }
}

export function responseEnvelopeMiddleware(req: Request, res: Response, next: NextFunction): void {
  const correlationId = (req.headers['x-correlation-id'] as string) || uuidv4();
  const requestId = uuidv4();

  const makeMeta = () => ({ correlation_id: correlationId, request_id: requestId, timestamp: new Date().toISOString() });

  res.success = (data: unknown, statusCode = 200) => {
    res.status(statusCode).json({ data, error: null, meta: makeMeta() });
  };
  res.created = (data: unknown) => {
    res.status(201).json({ data, error: null, meta: makeMeta() });
  };
  res.accepted = (data: unknown) => {
    res.status(202).json({ data, error: null, meta: makeMeta() });
  };
  next();
}
