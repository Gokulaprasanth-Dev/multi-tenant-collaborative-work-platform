import { Request, Response, NextFunction } from 'express';
import ipaddr from 'ipaddr.js';
import { config } from '../../shared/config';
import { ForbiddenError } from '../../shared/errors/app-errors';

function ipInCidr(ip: string, cidr: string): boolean {
  try {
    const parsed = ipaddr.parse(ip);
    const [range, prefix] = cidr.split('/') as [string, string];
    const parsedRange = ipaddr.parse(range);
    return parsed.match(parsedRange, parseInt(prefix));
  } catch {
    return false;
  }
}

export function platformAdminMiddleware(req: Request, _res: Response, next: NextFunction): void {
  // 1. JWT must be valid (already applied jwtMiddleware)
  if (!req.user) return next(new ForbiddenError('UNAUTHENTICATED', 'Authentication required'));

  // 2. Must be platform admin
  if (!req.user.isPlatformAdmin) {
    return next(new ForbiddenError('PLATFORM_ADMIN_REQUIRED', 'Platform admin access required'));
  }

  // 3. IP allowlist check
  // app.set('trust proxy', config.platformAdminTrustedProxy) in app.ts ensures req.ip is correct
  if (config.platformAdminIpAllowlist) {
    const allowedCidrs = config.platformAdminIpAllowlist.split(',').map(c => c.trim());
    const clientIp = req.ip ?? '';
    const allowed = allowedCidrs.some(cidr => {
      if (cidr.includes('/')) return ipInCidr(clientIp, cidr);
      return clientIp === cidr;
    });
    if (!allowed) {
      return next(new ForbiddenError('IP_NOT_ALLOWED', 'Your IP address is not allowed to access this endpoint'));
    }
  }

  // 4. Hard 1-hour expiry from mfa_verified_at — NOT an inactivity timeout
  // Activity does NOT extend the session. After 1 hour, re-MFA is required.
  const mfaVerifiedAt = req.user.mfaVerifiedAt;
  if (!mfaVerifiedAt) return next(new ForbiddenError('MFA_REQUIRED', 'MFA verification required for platform admin access'));
  const mfaAge = Math.floor(Date.now() / 1000) - mfaVerifiedAt;
  if (mfaAge > 3600) return next(new ForbiddenError('MFA_SESSION_EXPIRED', 'MFA session expired — re-authenticate with MFA'));

  next();
}
