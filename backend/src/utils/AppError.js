/**
 * The only error type services throw.
 *
 * `message` is shown to the user, so it must be safe to display and
 * must tell them what to do next. Internal detail goes in `meta`,
 * which is logged but never serialised to the client.
 */
export class AppError extends Error {
  constructor(code, status, message, meta = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.meta = meta;
    this.expected = true;
  }
}

export const badRequest   = (msg, meta) => new AppError('BAD_REQUEST', 400, msg, meta);
export const unauthorized = (msg = 'Please sign in to continue.') => new AppError('UNAUTHORIZED', 401, msg);
export const forbidden    = (msg = 'You do not have access to this office.') => new AppError('FORBIDDEN', 403, msg);
export const notFound     = (msg = 'Not found.') => new AppError('NOT_FOUND', 404, msg);
export const conflict     = (msg, meta) => new AppError('CONFLICT', 409, msg, meta);
export const tooLarge     = (msg) => new AppError('PAYLOAD_TOO_LARGE', 413, msg);
export const rateLimited  = (msg) => new AppError('RATE_LIMITED', 429, msg);
