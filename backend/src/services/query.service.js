/**
 * Public queries against published documents.
 *
 * author_email is collected so the office can reply. It is NEVER
 * returned by a public endpoint — see listApproved below.
 */
import { query, one } from '../db/pool.js';
import { notFound, badRequest } from '../utils/AppError.js';
import { recordAudit } from './audit.service.js';

const SPAM_MARKERS = [
  'http://', 'https://', 'www.', '<a ', 'viagra', 'casino', 'bitcoin', 'crypto wallet',
];

export async function submitQuery({ documentId, body, authorName, authorEmail, ip }) {
  const doc = await one(
    `SELECT id FROM documents WHERE id = $1 AND visibility = 'PUBLIC' AND status = 'PUBLISHED'`,
    [documentId]
  );
  if (!doc) throw notFound('You can only raise a query against a published document.');

  const lower = body.toLowerCase();
  if (SPAM_MARKERS.some((m) => lower.includes(m))) {
    throw badRequest('Links are not allowed in queries. Describe the issue in words.');
  }

  const row = await one(
    `INSERT INTO queries (document_id, body, author_name, author_email, status)
     VALUES ($1, $2, $3, $4, 'PENDING') RETURNING id`,
    [documentId, body, authorName, authorEmail.toLowerCase()]
  );

  await recordAudit({
    action: 'QUERY_SUBMITTED', targetType: 'query', targetId: row.id,
    detail: { documentId }, ip,
  });

  return { id: row.id, status: 'PENDING' };
}

/** Public projection. Note the absence of author_email. */
export async function listApproved(documentId) {
  const { rows } = await query(
    `SELECT id, body, author_name AS "authorName", created_at AS "createdAt"
       FROM queries
      WHERE document_id = $1 AND status = 'APPROVED'
      ORDER BY created_at DESC`,
    [documentId]
  );
  return rows;
}

/** Super admin view — includes the email, because replying needs it. */
export async function pendingQueries() {
  const { rows } = await query(
    `SELECT q.id, q.body, q.author_name AS "authorName", q.author_email AS "authorEmail",
            q.created_at AS "createdAt", d.title AS "documentTitle", o.name AS "officeName"
       FROM queries q
       JOIN documents d ON d.id = q.document_id
       JOIN offices o ON o.id = d.office_id
      WHERE q.status = 'PENDING'
      ORDER BY q.created_at ASC`
  );
  return rows;
}

export async function moderateQuery({ queryId, decision, actor, ip }) {
  const q = await one(`SELECT id FROM queries WHERE id = $1`, [queryId]);
  if (!q) throw notFound('No such query.');

  const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  await query(`UPDATE queries SET status = $2, moderated_by = $3 WHERE id = $1`, [queryId, status, actor.id]);

  await recordAudit({
    actorId: actor.id, actorEmail: actor.email,
    action: `QUERY_${status}`, targetType: 'query', targetId: queryId, detail: {}, ip,
  });

  return { id: queryId, status };
}
