/**
 * Application logger.
 *
 * Redaction list is not optional. Passwords, tokens, OTPs and cookies
 * must never reach a log file (docs/rules.md).
 */
import pino from 'pino';
import { config } from '../config/env.js';

export const logger = pino({
  level: config.isProd ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.newPassword',
      'req.body.otp',
      'password',
      'password_hash',
      'passwordHash',
      'otp',
      'otp_hash',
      'token',
      'refreshToken',
      'accessToken',
    ],
    censor: '[redacted]',
  },
  transport: config.isProd
    ? undefined
    : { target: 'pino/file', options: { destination: 1 } },
});
