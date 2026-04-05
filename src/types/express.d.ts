import 'express';

declare global {
  namespace Express {
    // Augment User so passport's req.user?: User picks up our fields
    interface User {
      userId: string;
      orgId: string;
      role: string;
      isPlatformAdmin: boolean;
      jti: string;
      exp: number;
      authTime?: number;
      mfaVerifiedAt?: number;
    }

    interface Request {
      orgContext?: {
        orgId: string;
        orgStatus: string;
        memberRole: string;
      };
    }
  }
}
