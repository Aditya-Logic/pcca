import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { validateBody, validateParams } from '../middleware/validate.js';
import { publicLimiter, writeLimiter } from '../middleware/rateLimit.js';
import {
  authenticate, optionalAuth, requireOfficeAccess, requireCsrfHeader,
} from '../middleware/auth.js';
import * as docs from '../services/document.service.js';
import { config } from '../config/env.js';

export const documentsRouter = Router();

const tmpDir = path.join(config.upload.dir, '_incoming');
fs.mkdirSync(tmpDir, { recursive: true });

/**
 * Multer writes to a temp directory with a generated name. The
 * client-supplied filename is NEVER used as a path — it is stored as
 * metadata only, so "../../etc/passwd" as a filename is inert.
 */
const upload = multer({
  dest: tmpDir,
  limits: { fileSize: config.upload.maxBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!config.upload.allowedMime.includes(file.mimetype)) {
      return cb(new Error('File must be a PDF, DOCX or XLSX.'));
    }
    cb(null, true);
  },
});

const officeParam = z.object({ officeId: z.string().regex(/^[a-z0-9-]{3,40}$/) });
const docParam = z.object({ documentId: z.string().uuid() });

/** GET /api/documents/office/:officeId — visibility applied in the query */
documentsRouter.get(
  '/office/:officeId',
  publicLimiter, optionalAuth, validateParams(officeParam),
  async (req, res, next) => {
    try {
      res.json({ documents: await docs.listByOffice({ officeId: req.params.officeId, user: req.user }) });
    } catch (err) { next(err); }
  }
);

documentsRouter.get(
  '/:documentId',
  publicLimiter, optionalAuth, validateParams(docParam),
  async (req, res, next) => {
    try {
      const doc = await docs.getDocument({ documentId: req.params.documentId, user: req.user });
      delete doc.storageKey;   // never leaves the server
      res.json(doc);
    } catch (err) { next(err); }
  }
);

documentsRouter.get(
  '/:documentId/versions',
  authenticate, validateParams(docParam),
  async (req, res, next) => {
    try {
      res.json({ versions: await docs.listVersions({ documentId: req.params.documentId, user: req.user }) });
    } catch (err) { next(err); }
  }
);

/**
 * GET /api/documents/:documentId/download
 * Streamed through the API so permission is checked per request.
 * The browser never touches storage directly.
 */
documentsRouter.get(
  '/:documentId/download',
  publicLimiter, optionalAuth, validateParams(docParam),
  async (req, res, next) => {
    try {
      const file = await docs.resolveDownload({
        documentId: req.params.documentId,
        versionId: req.query.versionId || null,
        user: req.user,
      });

      // Always an attachment, never inline — an inline PDF or HTML
      // rendered on our origin is an XSS vector.
      res.setHeader('Content-Type', file.mimeType);
      res.setHeader('Content-Length', file.sizeBytes);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${file.filename.replace(/["\\\r\n]/g, '_')}"`
      );
      fs.createReadStream(file.absolutePath).pipe(res);
    } catch (err) { next(err); }
  }
);

/** POST /api/documents/office/:officeId — upload or add a version */
documentsRouter.post(
  '/office/:officeId',
  authenticate, requireCsrfHeader, requireOfficeAccess(), writeLimiter,
  validateParams(officeParam),
  upload.single('file'),
  async (req, res, next) => {
    try {
      const schema = z.object({
        documentId: z.string().uuid().optional(),
        title: z.string().min(3, 'Give the document a title of at least 3 characters.').max(200),
        docType: z.string().min(1).max(60),
        docDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
        visibility: z.enum(['PUBLIC', 'INTERNAL', 'RESTRICTED']),
      });
      const body = schema.parse(req.body);

      const result = await docs.createOrReplace({
        officeId: req.params.officeId, ...body,
        file: req.file, actor: req.user, ip: req.ip,
      });

      res.status(201).json({
        ...result,
        message: 'Uploaded. It will appear once a super administrator publishes it.',
      });
    } catch (err) { next(err); }
  }
);

documentsRouter.post(
  '/:documentId/withdraw',
  authenticate, requireCsrfHeader, writeLimiter, validateParams(docParam),
  async (req, res, next) => {
    try {
      await docs.withdraw({ documentId: req.params.documentId, actor: req.user, ip: req.ip });
      res.json({ ok: true });
    } catch (err) { next(err); }
  }
);
