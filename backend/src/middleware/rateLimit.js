/**
 * Rate limiting.
 *
 * The login limiter is deliberately strict: five attempts per fifteen
 * minutes per IP. Per-account lockout is enforced separately in
 * auth.service.js, so rotating IPs does not defeat it.
 */
import rateLimit from 'express-rate-limit';

const json = (message) => (req, res) =>
  res.status(429).json({ error: { code: 'RATE_LIMITED', message } });

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  handler: json('Too many sign-in attempts. Try again in 15 minutes.'),
});

export const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  handler: json('Too many code attempts. Request a new code.'),
});

export const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  handler: json('You are sending requests too quickly. Wait a moment.'),
});

export const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 200,
  handler: json('Too many requests. Wait a moment and try again.'),
});

export const queryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  handler: json('You may submit up to 5 queries an hour.'),
});
