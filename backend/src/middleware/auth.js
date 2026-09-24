/**
 * Authentication and authorisation.
 *
 * Two rules this file exists to enforce:
 *
 *  1. The token is read from an httpOnly cookie, never from localStorage
 *     and never from a request body. JavaScript in the page cannot read it,
 *     so an XSS hole is not also a session theft.
 *
 *  2. Office scope is taken from the TOKEN, never from the request. A client
 *     that sends `officeId` in a body cannot widen its own access — the
 *     comparison below uses req.user.officeId, which the server signed.
 */
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { unauthorized, forbidden } from '../utils/AppError.js';
import { one } from '../db/pool.js';

export const ACCESS_COOKIE = 'pcca_at';
export const REFRESH_COOKIE = 'pcca_rt';

/** Cookie options. Secure + httpOnly + sameSite are not negotiable. */
export function cookieOptions(maxAgeMs) {
  return {
    httpOnly: true,
    secure: config.isProd,        // HTTPS-only in production
    sameSite: 'strict',           // blocks cross-site submission
    path: '/',
    maxAge: maxAgeMs,
    ...(config.cookieDomain ? { domain: config.cookieDomain } : {}),
  };
}

export function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      officeId: user.office_id ?? null,
    },
    config.jwt.accessSecret,
    { expiresIn: `${config.jwt.accessTtlMin}m`, issuer: 'pcca.mha.gov.in' }
  );
}

export function signRefreshToken(user, tokenId) {
  return jwt.sign(
    { sub: user.id, jti: tokenId },
    config.jwt.refreshSecret,
    { expiresIn: `${config.jwt.refreshTtlHours}h`, issuer: 'pcca.mha.gov.in' }
  );
}

/**
 * Require a valid session. Re-reads the user on every request so a
 * suspension takes effect immediately rather than at token expiry.
 */
export async function authenticate(req, _res, next) {
  try {
    const token = req.cookies?.[ACCESS_COOKIE];
    if (!token) throw unauthorized('Please sign in to continue.');

    let payload;
    try {
      payload = jwt.verify(token, config.jwt.accessSecret, { issuer: 'pcca.mha.gov.in' });
    } catch {
      throw unauthorized('Your session has expired. Please sign in again.');
    }

    const user = await one(
      `SELECT id, email, full_name, role, office_id, status
         FROM users WHERE id = $1`,
      [payload.sub]
    );

    if (!user) throw unauthorized('Your session is no longer valid.');
    if (user.status !== 'ACTIVE') {
      throw forbidden('This account is not active. Contact the Pr.CCA office.');
    }

    req.user = {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      officeId: user.office_id,
    };
    next();
  } catch (err) {
    next(err);
  }
}

/** Restrict a route to specific roles. */
export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!roles.includes(req.user.role)) {
    return next(forbidden('You do not have permission for this action.'));
  }
  next();
};

export const requireSuperAdmin = requireRole('SUPER_ADMIN');

/**
 * Office scoping. A super admin passes for any office. A PAO admin passes
 * only for their own. The office being requested comes from the URL param;
 * the office the user owns comes from the signed token.
 *
 * Returns 403 identically whether the office exists or not, so this
 * cannot be used to enumerate office codes.
 */
export const requireOfficeAccess = (paramName = 'officeId') => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (req.user.role === 'SUPER_ADMIN') return next();

  const requested = req.params[paramName] ?? req.body?.officeId;
  if (!requested || requested !== req.user.officeId) {
    return next(forbidden('You do not have access to this office.'));
  }
  next();
};

/**
 * Optional authentication. Used on public document routes so that a
 * signed-in office also sees its own INTERNAL files, while an anonymous
 * visitor sees only PUBLIC ones. Never throws.
 */
export async function optionalAuth(req, _res, next) {
  const token = req.cookies?.[ACCESS_COOKIE];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, config.jwt.accessSecret, { issuer: 'pcca.mha.gov.in' });
    const user = await one(
      `SELECT id, email, full_name, role, office_id, status FROM users WHERE id = $1`,
      [payload.sub]
    );
    if (user && user.status === 'ACTIVE') {
      req.user = {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        officeId: user.office_id,
      };
    }
  } catch {
    // An invalid token on a public route is simply an anonymous visitor.
  }
  next();
}

/**
 * CSRF defence for cookie-authenticated state changes.
 *
 * SameSite=strict already blocks cross-site cookie submission in every
 * supported browser. This is the second layer: a custom header that a
 * cross-origin form post cannot set without a successful CORS preflight,
 * which our CORS policy refuses.
 */
export function requireCsrfHeader(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'XMLHttpRequest') {
    return next(forbidden('Request rejected. Refresh the page and try again.'));
  }
  next();
}
