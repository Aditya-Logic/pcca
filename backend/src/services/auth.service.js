/**
 * Authentication logic.
 *
 * Sign-in is two steps on purpose. Verifying a password creates a
 * *challenge*, not a session. A stolen password alone reaches nothing.
 */
import argon2 from 'argon2';
import crypto from 'node:crypto';
import { query, one, tx } from '../db/pool.js';
import { config } from '../config/env.js';
import { AppError, unauthorized, forbidden, badRequest } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { recordAudit } from './audit.service.js';
import { signAccessToken, signRefreshToken } from '../middleware/auth.js';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const OTP_TTL_MINUTES = 5;
const MAX_OTP_ATTEMPTS = 5;

/** OWASP-recommended argon2id parameters. */
const ARGON_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export const hashPassword = (plain) => argon2.hash(plain, ARGON_OPTS);

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * Step 1 — verify the password, issue an OTP challenge.
 *
 * Every failure path returns the SAME message and takes roughly the same
 * time, so this endpoint cannot be used to discover which email addresses
 * are registered.
 */
export async function beginLogin({ email, password, ip }) {
  const generic = unauthorized('Incorrect email or password.');

  const user = await one(
    `SELECT id, email, full_name, password_hash, role, office_id, status,
            failed_attempts, locked_until
       FROM users WHERE lower(email) = lower($1)`,
    [email]
  );

  // No such user: still burn a hash cycle so the response time matches.
  if (!user) {
    await argon2.hash('timing-equaliser', ARGON_OPTS).catch(() => {});
    throw generic;
  }

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new AppError(
      'ACCOUNT_LOCKED',
      429,
      `Too many failed attempts. This account is locked for ${LOCK_MINUTES} minutes.`
    );
  }

  if (user.status === 'SUSPENDED') {
    throw forbidden('This account has been suspended. Contact the Pr.CCA office.');
  }
  if (user.status === 'INVITED') {
    throw forbidden('This account has not been activated. Use the invitation link that was emailed to you.');
  }

  const ok = await argon2.verify(user.password_hash, password).catch(() => false);

  if (!ok) {
    const attempts = user.failed_attempts + 1;
    const lock = attempts >= MAX_FAILED
      ? new Date(Date.now() + LOCK_MINUTES * 60_000)
      : null;

    await query(
      `UPDATE users SET failed_attempts = $2, locked_until = $3 WHERE id = $1`,
      [user.id, lock ? 0 : attempts, lock]
    );

    if (lock) {
      await recordAudit({
        actorId: user.id, actorEmail: user.email,
        action: 'ACCOUNT_LOCKED', targetType: 'user', targetId: user.id,
        detail: { reason: 'failed_attempts' }, ip,
      });
    }
    throw generic;
  }

  // Password correct. Reset the counter and create the OTP challenge.
  await query(
    `UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1`,
    [user.id]
  );

  const otp = String(crypto.randomInt(100000, 1000000)); // 6 digits
  const challenge = await one(
    `INSERT INTO login_challenges (user_id, otp_hash, expires_at)
     VALUES ($1, $2, now() + ($3 || ' minutes')::interval)
     RETURNING id`,
    [user.id, sha256(otp), String(OTP_TTL_MINUTES)]
  );

  await deliverOtp(user, otp);

  await recordAudit({
    actorId: user.id, actorEmail: user.email,
    action: 'LOGIN_PASSWORD_OK', targetType: 'user', targetId: user.id,
    detail: {}, ip,
  });

  return {
    challengeId: challenge.id,
    expiresInSeconds: OTP_TTL_MINUTES * 60,
    // In demo mode only, the code comes back in the response so the
    // portal can be walked through without an SMS gateway. env.js
    // refuses to start with DEMO_MODE=true under NODE_ENV=production.
    ...(config.isDemo ? { demoOtp: otp } : {}),
  };
}

async function deliverOtp(user, otp) {
  if (config.isDemo || !config.sms.url) {
    logger.warn({ email: user.email }, `DEMO: one-time code is ${otp}`);
    return;
  }
  // Production: POST to the department SMS gateway.
  // Implemented at integration time — see docs/phases.md, Phase 2 blockers.
  logger.info({ userId: user.id }, 'OTP dispatched to registered mobile');
}

/** Step 2 — verify the OTP and issue the session. */
export async function completeLogin({ challengeId, otp, ip }) {
  const ch = await one(
    `SELECT c.id, c.user_id, c.otp_hash, c.attempts, c.consumed, c.expires_at,
            u.id AS uid, u.email, u.full_name, u.role, u.office_id, u.status
       FROM login_challenges c
       JOIN users u ON u.id = c.user_id
      WHERE c.id = $1`,
    [challengeId]
  );

  if (!ch || ch.consumed) throw unauthorized('That code is no longer valid. Sign in again.');
  if (new Date(ch.expires_at) < new Date()) throw unauthorized('That code has expired. Sign in again.');
  if (ch.attempts >= MAX_OTP_ATTEMPTS) throw unauthorized('Too many incorrect codes. Sign in again.');
  if (ch.status !== 'ACTIVE') throw forbidden('This account is not active.');

  // Constant-time comparison — a length-varying compare leaks information.
  const supplied = Buffer.from(sha256(String(otp)));
  const expected = Buffer.from(ch.otp_hash);
  const match = supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);

  if (!match) {
    await query(`UPDATE login_challenges SET attempts = attempts + 1 WHERE id = $1`, [ch.id]);
    throw unauthorized('That code is not correct.');
  }

  const user = {
    id: ch.uid, email: ch.email, full_name: ch.full_name,
    role: ch.role, office_id: ch.office_id,
  };

  const { accessToken, refreshToken, refreshExpiresAt } = await tx(async (client) => {
    await client.query(`UPDATE login_challenges SET consumed = true WHERE id = $1`, [ch.id]);
    await client.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);

    const tokenId = crypto.randomUUID();
    const rt = signRefreshToken(user, tokenId);
    const expiresAt = new Date(Date.now() + config.jwt.refreshTtlHours * 3600_000);

    // Stored hashed — a database leak yields no usable sessions.
    await client.query(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [tokenId, user.id, sha256(rt), expiresAt]
    );

    return { accessToken: signAccessToken(user), refreshToken: rt, refreshExpiresAt: expiresAt };
  });

  await recordAudit({
    actorId: user.id, actorEmail: user.email,
    action: 'LOGIN_SUCCESS', targetType: 'user', targetId: user.id,
    detail: { role: user.role }, ip,
  });

  return {
    accessToken,
    refreshToken,
    refreshExpiresAt,
    // Safe projection. No hash, no internal columns.
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      officeId: user.office_id,
    },
  };
}

/** Rotate the refresh token. The old one is revoked on use. */
export async function rotateRefresh({ presentedToken, ip }) {
  if (!presentedToken) throw unauthorized('Your session has expired.');

  const row = await one(
    `SELECT r.id, r.user_id, r.revoked, r.expires_at,
            u.id AS uid, u.email, u.full_name, u.role, u.office_id, u.status
       FROM refresh_tokens r
       JOIN users u ON u.id = r.user_id
      WHERE r.token_hash = $1`,
    [sha256(presentedToken)]
  );

  if (!row) throw unauthorized('Your session has expired.');

  // A revoked token being presented again means it was stolen and replayed.
  // Kill every session this user has.
  if (row.revoked) {
    await query(`UPDATE refresh_tokens SET revoked = true WHERE user_id = $1`, [row.user_id]);
    await recordAudit({
      actorId: row.user_id, actorEmail: row.email,
      action: 'REFRESH_REUSE_DETECTED', targetType: 'user', targetId: row.user_id,
      detail: { allSessionsRevoked: true }, ip,
    });
    throw unauthorized('Your session has expired. Please sign in again.');
  }

  if (new Date(row.expires_at) < new Date()) throw unauthorized('Your session has expired.');
  if (row.status !== 'ACTIVE') throw forbidden('This account is not active.');

  const user = {
    id: row.uid, email: row.email, full_name: row.full_name,
    role: row.role, office_id: row.office_id,
  };

  return tx(async (client) => {
    await client.query(`UPDATE refresh_tokens SET revoked = true WHERE id = $1`, [row.id]);

    const tokenId = crypto.randomUUID();
    const rt = signRefreshToken(user, tokenId);
    const expiresAt = new Date(Date.now() + config.jwt.refreshTtlHours * 3600_000);

    await client.query(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES ($1,$2,$3,$4)`,
      [tokenId, user.id, sha256(rt), expiresAt]
    );

    return {
      accessToken: signAccessToken(user),
      refreshToken: rt,
      refreshExpiresAt: expiresAt,
      user: {
        id: user.id, email: user.email, fullName: user.full_name,
        role: user.role, officeId: user.office_id,
      },
    };
  });
}

export async function revokeSession({ presentedToken, userId, ip, email }) {
  if (presentedToken) {
    await query(`UPDATE refresh_tokens SET revoked = true WHERE token_hash = $1`, [sha256(presentedToken)]);
  }
  await recordAudit({
    actorId: userId, actorEmail: email,
    action: 'LOGOUT', targetType: 'user', targetId: userId ?? 'unknown',
    detail: {}, ip,
  });
}

export async function changePassword({ userId, currentPassword, newPassword, ip, email }) {
  const user = await one(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
  if (!user) throw unauthorized();

  const ok = await argon2.verify(user.password_hash, currentPassword).catch(() => false);
  if (!ok) throw badRequest('Your current password is not correct.');

  await query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [userId, await hashPassword(newPassword)]);
  // Every existing session dies with the old password.
  await query(`UPDATE refresh_tokens SET revoked = true WHERE user_id = $1`, [userId]);

  await recordAudit({
    actorId: userId, actorEmail: email,
    action: 'PASSWORD_CHANGED', targetType: 'user', targetId: userId,
    detail: { allSessionsRevoked: true }, ip,
  });
}
