/**
 * Account administration. Super admin only — every route that reaches
 * this module is behind requireSuperAdmin.
 *
 * There is no public sign-up. Accounts are created here and activated
 * by the recipient through an invitation link.
 */
import crypto from 'node:crypto';
import { query, one } from '../db/pool.js';
import { notFound, conflict, badRequest } from '../utils/AppError.js';
import { hashPassword } from './auth.service.js';
import { recordAudit } from './audit.service.js';

/** Safe projection — password_hash is never selected. */
const USER_COLUMNS = `
  u.id, u.email, u.full_name AS "fullName", u.role,
  u.office_id AS "officeId", u.status, u.mobile,
  u.last_login_at AS "lastLoginAt", u.created_at AS "createdAt",
  o.name AS "officeName"
`;

export async function listUsers({ status, role }) {
  const where = [];
  const params = [];
  if (status) { params.push(status); where.push(`u.status = $${params.length}`); }
  if (role)   { params.push(role);   where.push(`u.role = $${params.length}`); }

  const { rows } = await query(
    `SELECT ${USER_COLUMNS}
       FROM users u LEFT JOIN offices o ON o.id = u.office_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY u.created_at DESC`,
    params
  );
  return rows;
}

export async function createUser({ email, fullName, role, officeId, mobile, actor, ip }) {
  if (role === 'PAO_ADMIN' && !officeId) {
    throw badRequest('A PAO administrator must be attached to an office.');
  }
  if (role === 'SUPER_ADMIN' && officeId) {
    throw badRequest('A super administrator is not attached to an office.');
  }

  const existing = await one(`SELECT id FROM users WHERE lower(email) = lower($1)`, [email]);
  if (existing) throw conflict('An account with that email already exists.');

  if (officeId) {
    const office = await one(`SELECT id FROM offices WHERE id = $1`, [officeId]);
    if (!office) throw notFound('No office with that code.');

    const already = await one(
      `SELECT id FROM users WHERE office_id = $1 AND status <> 'SUSPENDED'`, [officeId]
    );
    if (already) throw conflict('That office already has an active administrator.');
  }

  // A random unusable password. The real one is set through the
  // invitation link — it is never chosen by an administrator for someone else.
  const placeholder = crypto.randomBytes(32).toString('hex');

  const user = await one(
    `INSERT INTO users (email, password_hash, full_name, role, office_id, mobile, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'INVITED')
     RETURNING id, email, full_name AS "fullName", role, office_id AS "officeId", status`,
    [email.toLowerCase(), await hashPassword(placeholder), fullName, role, officeId ?? null, mobile ?? null]
  );

  await recordAudit({
    actorId: actor.id, actorEmail: actor.email,
    action: 'USER_CREATED', targetType: 'user', targetId: user.id,
    detail: { email: user.email, role, officeId: officeId ?? null }, ip,
  });

  return user;
}

export async function setUserStatus({ userId, status, actor, ip }) {
  const user = await one(`SELECT id, email, role, status FROM users WHERE id = $1`, [userId]);
  if (!user) throw notFound('No such account.');

  if (user.id === actor.id) {
    throw badRequest('You cannot change the status of your own account.');
  }

  // Never leave the system with no way in.
  if (user.role === 'SUPER_ADMIN' && status === 'SUSPENDED') {
    const remaining = await one(
      `SELECT COUNT(*)::int AS n FROM users
        WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE' AND id <> $1`, [userId]
    );
    if (remaining.n === 0) {
      throw badRequest('This is the last active super administrator and cannot be suspended.');
    }
  }

  await query(`UPDATE users SET status = $2 WHERE id = $1`, [userId, status]);

  // Suspension kills live sessions immediately.
  if (status === 'SUSPENDED') {
    await query(`UPDATE refresh_tokens SET revoked = true WHERE user_id = $1`, [userId]);
  }

  await recordAudit({
    actorId: actor.id, actorEmail: actor.email,
    action: status === 'SUSPENDED' ? 'USER_SUSPENDED' : 'USER_STATUS_CHANGED',
    targetType: 'user', targetId: userId,
    detail: { from: user.status, to: status, email: user.email }, ip,
  });

  return { id: userId, status };
}
