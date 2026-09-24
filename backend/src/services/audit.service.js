/**
 * Audit log.
 *
 * This module is the ONLY place that writes to audit_log, and it only
 * ever inserts. No update or delete path exists anywhere in the codebase.
 *
 * A failed audit write must never fail the user's action, so errors are
 * logged and swallowed here — the one place in this codebase where that
 * is correct.
 */
import { query } from '../db/pool.js';
import { logger } from '../utils/logger.js';

export async function recordAudit({
  actorId = null, actorEmail = null, action,
  targetType, targetId, detail = {}, ip = null,
}) {
  try {
    await query(
      `INSERT INTO audit_log (actor_id, actor_email, action, target_type, target_id, detail, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [actorId, actorEmail, action, targetType, String(targetId), JSON.stringify(detail), ip]
    );
  } catch (err) {
    logger.error({ err, action, targetType, targetId }, 'audit write failed');
  }
}

export async function listAudit({ limit = 100, offset = 0, actorId, action, from, to }) {
  const where = [];
  const params = [];

  if (actorId) { params.push(actorId); where.push(`actor_id = $${params.length}`); }
  if (action)  { params.push(action);  where.push(`action = $${params.length}`); }
  if (from)    { params.push(from);    where.push(`created_at >= $${params.length}`); }
  if (to)      { params.push(to);      where.push(`created_at <= $${params.length}`); }

  params.push(limit, offset);
  const { rows } = await query(
    `SELECT id, actor_email, action, target_type, target_id, detail, created_at
       FROM audit_log
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}
