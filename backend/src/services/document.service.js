/**
 * Documents.
 *
 * Three things this file exists to guarantee:
 *
 *  1. Visibility is applied IN THE QUERY, not filtered afterwards. A
 *     RESTRICTED row never leaves the database on a public request.
 *  2. Replacement creates a new version. Nothing is overwritten, nothing
 *     is deleted — this is a government record system.
 *  3. A file's real type is decided by its magic bytes, not its extension.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { query, one, tx } from '../db/pool.js';
import { config } from '../config/env.js';
import { notFound, badRequest, forbidden } from '../utils/AppError.js';
import { recordAudit } from './audit.service.js';
import { scanFile } from './scan.service.js';

const DOC_COLUMNS = `
  d.id, d.office_id AS "officeId", d.title, d.doc_type AS "docType",
  d.doc_date AS "docDate", d.visibility, d.status,
  d.download_count AS "downloadCount", d.created_at AS "createdAt",
  v.version, v.original_name AS "originalName", v.mime_type AS "mimeType",
  v.size_bytes AS "sizeBytes", v.uploaded_at AS "uploadedAt"
`;

/**
 * Magic-byte check. A .pdf that is really a script is the obvious attack
 * on an upload portal, and the browser-reported MIME type is attacker-controlled.
 *
 * PDF  -> %PDF
 * DOCX/XLSX are ZIP containers -> PK\x03\x04
 */
export async function detectRealType(filePath) {
  const fh = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(8);
    await fh.read(buf, 0, 8, 0);

    if (buf.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';
    if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return 'zip';
    return 'unknown';
  } finally {
    await fh.close();
  }
}

const MIME_TO_FAMILY = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'zip',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'zip',
};

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fh = await fs.open(filePath, 'r');
  try {
    const stream = fh.createReadStream();
    for await (const chunk of stream) hash.update(chunk);
    return hash.digest('hex');
  } finally {
    await fh.close();
  }
}

/**
 * Build the visibility clause for whoever is asking.
 *
 * Anonymous          -> PUBLIC + PUBLISHED only
 * PAO admin          -> the above, plus everything belonging to THEIR office
 * Super admin        -> everything
 */
function visibilityClause(user, params, officeId) {
  if (user?.role === 'SUPER_ADMIN') return '1=1';

  if (user?.role === 'PAO_ADMIN') {
    params.push(user.officeId);
    return `(
      (d.visibility = 'PUBLIC' AND d.status = 'PUBLISHED')
      OR d.office_id = $${params.length}
    )`;
  }

  return `(d.visibility = 'PUBLIC' AND d.status = 'PUBLISHED')`;
}

export async function listByOffice({ officeId, user }) {
  const params = [officeId];
  const clause = visibilityClause(user, params, officeId);

  const { rows } = await query(
    `SELECT ${DOC_COLUMNS}
       FROM documents d
       LEFT JOIN document_versions v ON v.id = d.current_version_id
      WHERE d.office_id = $1
        AND d.status <> 'WITHDRAWN'
        AND ${clause}
      ORDER BY d.doc_date DESC NULLS LAST, d.created_at DESC`,
    params
  );
  return rows;
}

export async function getDocument({ documentId, user }) {
  const params = [documentId];
  const clause = visibilityClause(user, params);

  const doc = await one(
    `SELECT ${DOC_COLUMNS}, v.storage_key AS "storageKey", v.scan_status AS "scanStatus"
       FROM documents d
       LEFT JOIN document_versions v ON v.id = d.current_version_id
      WHERE d.id = $1 AND ${clause}`,
    params
  );

  // Identical 404 whether the document is missing or merely invisible,
  // so this cannot be used to confirm that a restricted file exists.
  if (!doc) throw notFound('No such document.');
  return doc;
}

/**
 * Create a document, or add a version to an existing one.
 * `file` is the multer temp-file descriptor.
 */
export async function createOrReplace({
  officeId, documentId, title, docType, docDate, visibility, file, actor, ip,
}) {
  if (!file) throw badRequest('No file was received.');

  const tempPath = file.path;

  try {
    if (file.size > config.upload.maxBytes) {
      throw badRequest(`File must be under ${config.upload.maxMb} MB.`);
    }

    if (!config.upload.allowedMime.includes(file.mimetype)) {
      throw badRequest('File must be a PDF, DOCX or XLSX.');
    }

    // The declared type must match what the bytes actually say.
    const real = await detectRealType(tempPath);
    if (real !== MIME_TO_FAMILY[file.mimetype]) {
      await recordAudit({
        actorId: actor.id, actorEmail: actor.email,
        action: 'UPLOAD_TYPE_MISMATCH', targetType: 'office', targetId: officeId,
        detail: { declared: file.mimetype, detected: real, name: file.originalname }, ip,
      });
      throw badRequest('That file is not a valid PDF, DOCX or XLSX.');
    }

    const sha = await sha256File(tempPath);
    const scan = await scanFile(tempPath);

    if (scan.status === 'INFECTED') {
      await fs.unlink(tempPath).catch(() => {});
      await recordAudit({
        actorId: actor.id, actorEmail: actor.email,
        action: 'UPLOAD_INFECTED', targetType: 'office', targetId: officeId,
        detail: { name: file.originalname, signature: scan.signature }, ip,
      });
      throw badRequest('That file failed the virus scan and has been discarded.');
    }

    // Move out of the temp dir into per-office storage.
    const officeDir = path.join(config.upload.dir, officeId);
    await fs.mkdir(officeDir, { recursive: true });
    const storageKey = path.join(officeId, `${crypto.randomUUID()}.bin`);
    await fs.rename(tempPath, path.join(config.upload.dir, storageKey));

    const result = await tx(async (client) => {
      let docId = documentId;
      let isNew = false;

      if (docId) {
        const existing = await client.query(
          `SELECT id, office_id FROM documents WHERE id = $1`, [docId]
        );
        if (!existing.rows[0]) throw notFound('No such document.');
        // Scope check repeated at the data layer, not only at the route.
        if (existing.rows[0].office_id !== officeId) {
          throw forbidden('That document belongs to another office.');
        }
      } else {
        isNew = true;
        const created = await client.query(
          `INSERT INTO documents (office_id, title, doc_type, doc_date, visibility, status, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, 'PENDING', $6) RETURNING id`,
          [officeId, title, docType, docDate || null, visibility, actor.id]
        );
        docId = created.rows[0].id;
      }

      const nextVersion = await client.query(
        `SELECT COALESCE(MAX(version), 0) + 1 AS v FROM document_versions WHERE document_id = $1`,
        [docId]
      );
      const version = nextVersion.rows[0].v;

      const ver = await client.query(
        `INSERT INTO document_versions
           (document_id, version, storage_key, original_name, mime_type, size_bytes, sha256, scan_status, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [docId, version, storageKey, file.originalname, file.mimetype, file.size, sha, scan.status, actor.id]
      );

      // Point the document at the new version. Previous rows stay put.
      await client.query(
        `UPDATE documents
            SET current_version_id = $2,
                status = 'PENDING',
                title = COALESCE($3, title),
                doc_type = COALESCE($4, doc_type),
                doc_date = COALESCE($5, doc_date),
                visibility = COALESCE($6, visibility)
          WHERE id = $1`,
        [docId, ver.rows[0].id, title ?? null, docType ?? null, docDate || null, visibility ?? null]
      );

      return { documentId: docId, version, isNew };
    });

    await recordAudit({
      actorId: actor.id, actorEmail: actor.email,
      action: result.isNew ? 'DOCUMENT_UPLOADED' : 'DOCUMENT_VERSION_ADDED',
      targetType: 'document', targetId: result.documentId,
      detail: { version: result.version, officeId, sizeBytes: file.size, sha256: sha }, ip,
    });

    return result;
  } catch (err) {
    await fs.unlink(tempPath).catch(() => {});
    throw err;
  }
}

/** Version history. Old versions remain retrievable — nothing is deleted. */
export async function listVersions({ documentId, user }) {
  const doc = await getDocument({ documentId, user });
  const { rows } = await query(
    `SELECT id, version, original_name AS "originalName", size_bytes AS "sizeBytes",
            mime_type AS "mimeType", scan_status AS "scanStatus", uploaded_at AS "uploadedAt"
       FROM document_versions WHERE document_id = $1 ORDER BY version DESC`,
    [doc.id]
  );
  return rows;
}

/**
 * Resolve a file for download. Permission is checked HERE, on every
 * request — the browser never touches storage directly.
 */
export async function resolveDownload({ documentId, versionId, user }) {
  const doc = await getDocument({ documentId, user });

  let version;
  if (versionId) {
    version = await one(
      `SELECT * FROM document_versions WHERE id = $1 AND document_id = $2`,
      [versionId, doc.id]
    );
  } else {
    version = await one(`SELECT * FROM document_versions WHERE id = $1`, [doc.current_version_id ?? doc.currentVersionId ?? null]);
    if (!version) {
      version = await one(
        `SELECT * FROM document_versions WHERE document_id = $1 ORDER BY version DESC LIMIT 1`,
        [doc.id]
      );
    }
  }

  if (!version) throw notFound('That document has no stored file.');
  if (version.scan_status === 'INFECTED') throw forbidden('That file is not available.');

  const absolute = path.resolve(config.upload.dir, version.storage_key);
  const root = path.resolve(config.upload.dir);

  // Defence against a crafted storage_key escaping the upload root.
  if (!absolute.startsWith(root + path.sep)) {
    throw forbidden('That file is not available.');
  }

  await query(`UPDATE documents SET download_count = download_count + 1 WHERE id = $1`, [doc.id]);

  return {
    absolutePath: absolute,
    filename: version.original_name,
    mimeType: version.mime_type,
    sizeBytes: version.size_bytes,
  };
}

/** Super admin moderation. */
export async function moderate({ documentId, decision, remark, actor, ip }) {
  const doc = await one(`SELECT id, office_id, title FROM documents WHERE id = $1`, [documentId]);
  if (!doc) throw notFound('No such document.');

  const status = decision === 'PUBLISH' ? 'PUBLISHED' : 'REJECTED';

  await query(
    `UPDATE documents SET status = $2, moderated_by = $3, moderation_remark = $4 WHERE id = $1`,
    [documentId, status, actor.id, remark ?? null]
  );

  await recordAudit({
    actorId: actor.id, actorEmail: actor.email,
    action: status === 'PUBLISHED' ? 'DOCUMENT_PUBLISHED' : 'DOCUMENT_REJECTED',
    targetType: 'document', targetId: documentId,
    detail: { officeId: doc.office_id, remark: remark ?? null }, ip,
  });

  return { documentId, status };
}

/** Withdrawal, not deletion. The bytes and the history stay. */
export async function withdraw({ documentId, actor, ip }) {
  const doc = await one(`SELECT id, office_id FROM documents WHERE id = $1`, [documentId]);
  if (!doc) throw notFound('No such document.');

  if (actor.role !== 'SUPER_ADMIN' && doc.office_id !== actor.officeId) {
    throw forbidden('You do not have access to this office.');
  }

  await query(`UPDATE documents SET status = 'WITHDRAWN' WHERE id = $1`, [documentId]);
  await recordAudit({
    actorId: actor.id, actorEmail: actor.email,
    action: 'DOCUMENT_WITHDRAWN', targetType: 'document', targetId: documentId,
    detail: { officeId: doc.office_id }, ip,
  });
}

export async function moderationQueue() {
  const { rows } = await query(
    `SELECT d.id, d.title, d.visibility, d.status, d.created_at AS "createdAt",
            o.name AS "officeName", o.id AS "officeId"
       FROM documents d JOIN offices o ON o.id = d.office_id
      WHERE d.status = 'PENDING'
      ORDER BY d.created_at ASC`
  );
  return rows;
}
