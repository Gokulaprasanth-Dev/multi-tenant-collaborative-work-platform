import { Request, Response, NextFunction } from 'express';
import * as AuthService from '../services/auth.service';
import { refreshTokenPair } from '../services/jwt.service';
import { loginWithGoogle } from '../services/oauth.service';
import { requestLink, verifyLink } from '../services/magic-link.service';
import { handleCallback } from '../services/saml.service';

// POST /api/v1/auth/register
export async function registerHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password, name } = req.body as { email: string; password: string; name: string };
    const user = await AuthService.register(email, password, name);
    res.created(user);
  } catch (err) {
    next(err);
  }
}

// POST /api/v1/auth/login
export async function loginHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password, orgId } = req.body as { email: string; password: string; orgId?: string };
    const result = await AuthService.login(email, password, orgId);
    res.success(result);
  } catch (err) {
    next(err);
  }
}

// GET /api/v1/auth/verify-email?token=...
export async function verifyEmailHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.query['token'] as string | undefined;
    if (!token) {
      res.status(400).json({ data: null, error: { code: 'MISSING_TOKEN', message: 'token query parameter is required' }, meta: {} });
      return;
    }
    await AuthService.verifyEmail(token);
    res.success({ message: 'Email verified successfully' });
  } catch (err) {
    next(err);
  }
}

// POST /api/v1/auth/verify-email/resend
export async function resendVerificationEmailHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email } = req.body as { email: string };
    const user = await AuthService.findUserByEmailForResend(email);
    if (user) {
      await AuthService.resendVerificationEmail(user.id);
    }
    res.success({ message: 'If an account exists and is unverified, a verification email has been sent' });
  } catch (err) {
    next(err);
  }
}

// POST /api/v1/auth/password-reset/request
export async function requestPasswordResetHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email } = req.body as { email: string };
    await AuthService.requestPasswordReset(email);
    res.success({ message: 'If an account exists, a password reset email has been sent' });
  } catch (err) {
    next(err);
  }
}

// POST /api/v1/auth/password-reset/confirm
export async function confirmPasswordResetHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token, newPassword } = req.body as { token: string; newPassword: string };
    await AuthService.confirmPasswordReset(token, newPassword);
    res.success({ message: 'Password has been reset successfully' });
  } catch (err) {
    next(err);
  }
}

// POST /api/v1/auth/logout  (JWT required)
export async function logoutHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { refreshToken } = req.body as { refreshToken: string };
    const user = req.user!;
    const remainingTtl = Math.max(0, user.exp - Math.floor(Date.now() / 1000));
    await AuthService.logout(refreshToken, user.jti, remainingTtl);
    res.success({ message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
}

// POST /api/v1/auth/refresh
export async function refreshHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { refreshToken } = req.body as { refreshToken: string };
    const tokens = await refreshTokenPair(refreshToken);
    res.success(tokens);
  } catch (err) {
    next(err);
  }
}

// POST /api/v1/auth/oauth/google
export async function googleOAuthHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { idToken } = req.body as { idToken: string };
    const tokens = await loginWithGoogle(idToken);
    res.success(tokens);
  } catch (err) {
    next(err);
  }
}

// POST /api/v1/auth/magic-link/request
export async function magicLinkRequestHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, orgId } = req.body as { email: string; orgId?: string };
    await requestLink(email, orgId);
    res.success({ message: 'If an account exists, a magic link has been sent' });
  } catch (err) {
    next(err);
  }
}

// POST /api/v1/auth/magic-link/verify
export async function magicLinkVerifyHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token } = req.body as { token: string };
    const tokens = await verifyLink(token);
    res.success(tokens);
  } catch (err) {
    next(err);
  }
}

// POST /api/v1/auth/saml/:orgId/callback
export async function samlCallbackHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.params as { orgId: string };
    const { SAMLResponse } = req.body as { SAMLResponse: string };
    if (!SAMLResponse) {
      res.status(400).json({ data: null, error: { code: 'MISSING_SAML_RESPONSE', message: 'SAMLResponse is required' }, meta: {} });
      return;
    }
    const tokens = await handleCallback(orgId, SAMLResponse);
    res.success(tokens);
  } catch (err) {
    next(err);
  }
}
