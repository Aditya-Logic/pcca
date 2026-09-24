/**
 * Administration. Every route here is behind requireSuperAdmin —
 * the guard is applied once at the router level so a new route
 * cannot be added unprotected by accident.
 */
import { Router } from 'express';
import { z } from 'zod';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js';
import { writeLimiter } from '../middleware/rateLimit.js';
import { authenticate, requireSuperAdmin, requireCsrfHeader } from '../middleware/auth.js';
import * as users from '../services/user.service.js';
import * as docs from '../services/document.service.js';
import * as queries from '../services/query.service.js';
import { listAudit } from '../services/audit.service.js';
import { query } from '../db/pool.js';

export const adminRouter = Router();

adminRouter.use(authenticate, requireSuperAdmin);

const uuidParam = (name) => z.object({ [name]: z.string().uuid() });

/* ---------- accounts ---------- */

adminRouter.get('/users',
  validateQuery(z.object({
    status: z.enum(['INVITED', 'ACTIVE', 'SUSPENDED']).optional(),
    role: z.enum(['SUPER_ADMIN', 'PAO_ADMIN']).optional(),
  })),
  async (req, res, next) => {
    try { res.json({ users: await users.listUsers(req.validatedQuery) }); }
    catch (err) { next(err); }
  }
);

adminRouter.post('/users',
  requireCsrfHeader, writeLimiter,
  validateBody(z.object({
    email: z.string().email('Enter a valid email address.'),
    fullName: z.string().min(2, 'Enter the officer\u2019s name.').max(120),
    role: z.enum(['SUPER_ADMIN', 'PAO_ADMIN']),
    officeId: z.string().regex(/^[a-z0-9-]{3,40}$/).optional(),
    mobile: z.string().regex(/^[0-9+\- ]{8,20}$/, 'Enter a valid mobile number.').optional(),
  })),
  async (req, res, next) => {
    try {
      res.status(201).json(await users.createUser({ ...req.body, actor: req.user, ip: req.ip }));
    } catch (err) { next(err); }
  }
);

adminRouter.patch('/users/:userId/status',
  requireCsrfHeader, writeLimiter,
  validateParams(uuidParam('userId')),
  validateBody(z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']) })),
  async (req, res, next) => {
    try {
      res.json(await users.setUserStatus({
        userId: req.params.userId, status: req.body.status, actor: req.user, ip: req.ip,
      }));
    } catch (err) { next(err); }
  }
);

/* ---------- moderation ---------- */

adminRouter.get('/moderation/documents', async (_req, res, next) => {
  try { res.json({ documents: await docs.moderationQueue() }); } catch (err) { next(err); }
});

adminRouter.post('/moderation/documents/:documentId',
  requireCsrfHeader, writeLimiter,
  validateParams(uuidParam('documentId')),
  validateBody(z.object({
    decision: z.enum(['PUBLISH', 'REJECT']),
    remark: z.string().max(1000).optional(),
  })),
  async (req, res, next) => {
    try {
      res.json(await docs.moderate({
        documentId: req.params.documentId, ...req.body, actor: req.user, ip: req.ip,
      }));
    } catch (err) { next(err); }
  }
);

adminRouter.get('/moderation/queries', async (_req, res, next) => {
  try { res.json({ queries: await queries.pendingQueries() }); } catch (err) { next(err); }
});

adminRouter.post('/moderation/queries/:queryId',
  requireCsrfHeader, writeLimiter,
  validateParams(uuidParam('queryId')),
  validateBody(z.object({ decision: z.enum(['APPROVE', 'REJECT']) })),
  async (req, res, next) => {
    try {
      res.json(await queries.moderateQuery({
        queryId: req.params.queryId, decision: req.body.decision, actor: req.user, ip: req.ip,
      }));
    } catch (err) { next(err); }
  }
);

/* ---------- audit ---------- */

adminRouter.get('/audit',
  validateQuery(z.object({
    limit: z.coerce.number().int().min(1).max(500).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    action: z.string().max(60).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  })),
  async (req, res, next) => {
    try { res.json({ entries: await listAudit(req.validatedQuery) }); }
    catch (err) { next(err); }
  }
);

/* ---------- analytics (aggregate only — never per-visitor) ---------- */

adminRouter.get('/analytics', async (_req, res, next) => {
  try {
    const uploads = await query(`
      SELECT date_trunc('day', uploaded_at)::date AS day, COUNT(*)::int AS n
        FROM document_versions
       WHERE uploaded_at > now() - interval '90 days'
       GROUP BY day ORDER BY day
    `);
    const topDocs = await query(`
      SELECT d.title, d.download_count AS "downloadCount", o.name AS "officeName"
        FROM documents d JOIN offices o ON o.id = d.office_id
       WHERE d.status = 'PUBLISHED'
       ORDER BY d.download_count DESC LIMIT 10
    `);
    const silent = await query(`
      SELECT o.id, o.name FROM offices o
       WHERE NOT EXISTS (SELECT 1 FROM documents d WHERE d.office_id = o.id)
       ORDER BY o.name
    `);
    res.json({
      uploadsByDay: uploads.rows,
      mostDownloaded: topDocs.rows,
      officesWithNoDocuments: silent.rows,
    });
  } catch (err) { next(err); }
});
