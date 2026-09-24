/**
 * The single error exit for the whole API.
 *
 * Controllers do not catch. Services throw AppError. Everything lands here.
 * The client never receives a stack trace, a SQL fragment, or a file path.
 */
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/env.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such endpoint.' } });
}

// eslint-disable-next-line no-unused-vars -- Express needs the 4-arg signature
export function errorHandler(err, req, res, _next) {
  const correlationId = randomUUID();

  // Validation failure — safe to return field detail, it is the user's own input
  if (err instanceof ZodError) {
    const fields = err.issues.map((i) => ({
      field: i.path.join('.'),
      message: i.message,
    }));
    logger.info({ correlationId, fields }, 'validation failed');
    return res.status(400).json({
      error: { code: 'VALIDATION_FAILED', message: 'Please correct the highlighted fields.', fields, correlationId },
    });
  }

  // Known, expected failure
  if (err instanceof AppError) {
    logger.info({ correlationId, code: err.code, meta: err.meta }, err.message);
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, correlationId },
    });
  }

  // Multer file-size rejection
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: `File must be under ${config.upload.maxMb} MB.`,
        correlationId,
      },
    });
  }

  // Postgres unique violation
  if (err?.code === '23505') {
    logger.warn({ correlationId, constraint: err.constraint }, 'unique violation');
    return res.status(409).json({
      error: { code: 'CONFLICT', message: 'That record already exists.', correlationId },
    });
  }

  // Anything else is a bug. Log everything, tell the user nothing.
  logger.error({ correlationId, err }, 'unhandled error');
  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong at our end. Quote the reference below if you contact support.',
      correlationId,
    },
  });
}
