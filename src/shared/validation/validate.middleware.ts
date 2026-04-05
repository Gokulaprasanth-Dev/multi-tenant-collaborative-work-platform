import { ZodSchema } from 'zod';
import { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../errors/app-errors';

export function validate(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details = result.error.errors.map(e => ({ field: e.path.join('.'), message: e.message }));
      return next(new ValidationError({ errors: details }));
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const details = result.error.errors.map(e => ({ field: e.path.join('.'), message: e.message }));
      return next(new ValidationError({ errors: details }));
    }
    req.query = result.data;
    next();
  };
}
