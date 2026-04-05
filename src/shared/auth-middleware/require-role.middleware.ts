import { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from '../errors/app-errors';

export function requireRole(roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const memberRole = req.orgContext?.memberRole;
    if (!memberRole || !roles.includes(memberRole)) {
      return next(new ForbiddenError('INSUFFICIENT_ROLE', `This action requires one of: ${roles.join(', ')}`));
    }
    next();
  };
}
