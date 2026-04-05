import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../shared/validation/validate.middleware';
import { jwtMiddleware } from '../../shared/auth-middleware/jwt.middleware';
import {
  authRateLimit,
  registerRateLimit,
  passwordResetRateLimit,
  magicLinkRateLimit,
  verifyEmailResendRateLimit,
} from '../../shared/redis/rate-limiter';
import {
  verifyEmailHandler,
  resendVerificationEmailHandler,
  requestPasswordResetHandler,
  confirmPasswordResetHandler,
  logoutHandler,
  refreshHandler,
  registerHandler,
  loginHandler,
  googleOAuthHandler,
  magicLinkRequestHandler,
  magicLinkVerifyHandler,
  samlCallbackHandler,
} from './controllers/auth.controller';

const router = Router();

// ── Registration & Login ──────────────────────────────────────────────────

router.post(
  '/register',
  ...(process.env.NODE_ENV !== 'test' ? [registerRateLimit] : []),
  validate(z.object({
    email: z.string().email(),
    password: z.string().min(8).max(128),
    name: z.string().min(1).max(255),
  })),
  registerHandler
);

router.post(
  '/login',
  ...(process.env.NODE_ENV !== 'test' ? [authRateLimit] : []),
  validate(z.object({
    email: z.string().email(),
    password: z.string().min(1),
    orgId: z.string().uuid().optional(),
  })),
  loginHandler
);

// ── Token management ─────────────────────────────────────────────────────

router.post(
  '/refresh',
  validate(z.object({ refreshToken: z.string().min(1) })),
  refreshHandler
);

router.post(
  '/logout',
  jwtMiddleware,
  validate(z.object({ refreshToken: z.string().min(1) })),
  logoutHandler
);

// ── Email verification ────────────────────────────────────────────────────

router.get('/verify-email', verifyEmailHandler);

router.post(
  '/verify-email/resend',
  ...(process.env.NODE_ENV !== 'test' ? [verifyEmailResendRateLimit] : []),
  validate(z.object({ email: z.string().email() })),
  resendVerificationEmailHandler
);

// ── Password reset ────────────────────────────────────────────────────────

router.post(
  '/password-reset/request',
  ...(process.env.NODE_ENV !== 'test' ? [passwordResetRateLimit] : []),
  validate(z.object({ email: z.string().email() })),
  requestPasswordResetHandler
);

router.post(
  '/password-reset/confirm',
  validate(z.object({
    token: z.string().min(1),
    newPassword: z.string().min(8).max(128),
  })),
  confirmPasswordResetHandler
);

// ── Google OAuth ──────────────────────────────────────────────────────────

router.post(
  '/oauth/google',
  validate(z.object({ idToken: z.string().min(1) })),
  googleOAuthHandler
);

// ── Magic link ────────────────────────────────────────────────────────────

router.post(
  '/magic-link/request',
  ...(process.env.NODE_ENV !== 'test' ? [magicLinkRateLimit] : []),
  validate(z.object({
    email: z.string().email(),
    orgId: z.string().uuid().optional(),
  })),
  magicLinkRequestHandler
);

router.post(
  '/magic-link/verify',
  validate(z.object({ token: z.string().min(1) })),
  magicLinkVerifyHandler
);

// ── SAML ──────────────────────────────────────────────────────────────────

router.post(
  '/saml/:orgId/callback',
  samlCallbackHandler
);

export default router;
