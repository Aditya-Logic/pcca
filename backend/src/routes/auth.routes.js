import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate.js';
import { loginLimiter, otpLimiter, writeLimiter } from '../middleware/rateLimit.js';
import {
  authenticate, requireCsrfHeader, cookieOptions,
  ACCESS_COOKIE, REFRESH_COOKIE,
} from '../middleware/auth.js';
import * as auth from '../services/auth.service.js';
import { config } from '../config/env.js';

export const authRouter = Router();

const accessMaxAge = () => config.jwt.accessTtlMin * 60_000;

/** POST /api/auth/login — password step. Returns a challenge, NOT a session. */
authRouter.post(
  '/login',
  loginLimiter,
  validateBody(z.object({
    email: z.string().email('Enter a valid email address.'),
    password: z.string().min(1, 'Enter your password.'),
  })),
  async (req, res, next) => {
    try {
      const result = await auth.beginLogin({
        email: req.body.email,
        password: req.body.password,
        ip: req.ip,
      });
      res.json(result);
    } catch (err) { next(err); }
  }
);

/** POST /api/auth/verify-otp — second step. Sets the session cookies. */
authRouter.post(
  '/verify-otp',
  otpLimiter,
  validateBody(z.object({
    challengeId: z.string().uuid('That sign-in attempt is no longer valid.'),
    otp: z.string().regex(/^\d{6}$/, 'The code is six digits.'),
  })),
  async (req, res, next) => {
    try {
      const { accessToken, refreshToken, refreshExpiresAt, user } =
        await auth.completeLogin({ ...req.body, ip: req.ip });

      res.cookie(ACCESS_COOKIE, accessToken, cookieOptions(accessMaxAge()));
      res.cookie(REFRESH_COOKIE, refreshToken,
        cookieOptions(refreshExpiresAt.getTime() - Date.now()));

      // The body carries only what the UI needs to render. No token.
      res.json({ user });
    } catch (err) { next(err); }
  }
);

/** POST /api/auth/refresh */
authRouter.post('/refresh', writeLimiter, async (req, res, next) => {
  try {
    const { accessToken, refreshToken, refreshExpiresAt, user } =
      await auth.rotateRefresh({ presentedToken: req.cookies?.[REFRESH_COOKIE], ip: req.ip });

    res.cookie(ACCESS_COOKIE, accessToken, cookieOptions(accessMaxAge()));
    res.cookie(REFRESH_COOKIE, refreshToken,
      cookieOptions(refreshExpiresAt.getTime() - Date.now()));
    res.json({ user });
  } catch (err) { next(err); }
});

/** POST /api/auth/logout */
authRouter.post('/logout', async (req, res, next) => {
  try {
    await auth.revokeSession({
      presentedToken: req.cookies?.[REFRESH_COOKIE],
      userId: req.user?.id ?? null,
      email: req.user?.email ?? null,
      ip: req.ip,
    });
    res.clearCookie(ACCESS_COOKIE, cookieOptions(0));
    res.clearCookie(REFRESH_COOKIE, cookieOptions(0));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/** GET /api/auth/me — who am I. Safe projection only. */
authRouter.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

/** POST /api/auth/change-password */
authRouter.post(
  '/change-password',
  authenticate, requireCsrfHeader, writeLimiter,
  validateBody(z.object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    newPassword: z.string()
      .min(12, 'Use at least 12 characters.')
      .regex(/[A-Z]/, 'Include an uppercase letter.')
      .regex(/[a-z]/, 'Include a lowercase letter.')
      .regex(/\d/, 'Include a digit.')
      .regex(/[^A-Za-z0-9]/, 'Include a symbol.'),
  })),
  async (req, res, next) => {
    try {
      await auth.changePassword({
        userId: req.user.id, email: req.user.email,
        currentPassword: req.body.currentPassword,
        newPassword: req.body.newPassword,
        ip: req.ip,
      });
      res.clearCookie(ACCESS_COOKIE, cookieOptions(0));
      res.clearCookie(REFRESH_COOKIE, cookieOptions(0));
      res.json({ ok: true, message: 'Password changed. Please sign in again.' });
    } catch (err) { next(err); }
  }
);
