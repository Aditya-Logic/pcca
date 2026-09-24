import { Router } from 'express';
import { z } from 'zod';
import { validateQuery, validateBody, validateParams } from '../middleware/validate.js';
import { publicLimiter, writeLimiter } from '../middleware/rateLimit.js';
import {
  authenticate, requireSuperAdmin, requireOfficeAccess, requireCsrfHeader,
} from '../middleware/auth.js';
import * as offices from '../services/office.service.js';

export const officesRouter = Router();

const idParam = z.object({ officeId: z.string().regex(/^[a-z0-9-]{3,40}$/) });

/** GET /api/offices — public directory */
officesRouter.get(
  '/',
  publicLimiter,
  validateQuery(z.object({
    search: z.string().max(100).optional(),
    parentOrg: z.string().max(60).optional(),
    station: z.string().max(60).optional(),
    sort: z.enum(['name', 'srAO', 'aao', 'acctt', 'total', 'station']).optional(),
    dir: z.enum(['asc', 'desc']).optional(),
  })),
  async (req, res, next) => {
    try { res.json({ offices: await offices.listOffices(req.validatedQuery) }); }
    catch (err) { next(err); }
  }
);

/** GET /api/offices/totals — COMPUTED, never stored */
officesRouter.get('/totals', publicLimiter, async (_req, res, next) => {
  try { res.json(await offices.getTotals()); } catch (err) { next(err); }
});

officesRouter.get('/facets', publicLimiter, async (_req, res, next) => {
  try { res.json(await offices.getFacets()); } catch (err) { next(err); }
});

officesRouter.get('/strength-by-org', publicLimiter, async (_req, res, next) => {
  try { res.json({ data: await offices.getStrengthByOrg() }); } catch (err) { next(err); }
});

/** Super admin: the 85 parsed station/organisation values, for human review */
officesRouter.get('/derived-review', authenticate, requireSuperAdmin, async (_req, res, next) => {
  try { res.json({ offices: await offices.listDerivedForReview() }); } catch (err) { next(err); }
});

officesRouter.get('/:officeId', publicLimiter, validateParams(idParam), async (req, res, next) => {
  try { res.json(await offices.getOffice(req.params.officeId)); } catch (err) { next(err); }
});

/** PATCH contact — the office's own admin, or a super admin */
officesRouter.patch(
  '/:officeId/contact',
  authenticate, requireCsrfHeader, requireOfficeAccess(), writeLimiter,
  validateParams(idParam),
  validateBody(z.object({
    phone: z.string().max(40).optional().nullable(),
    email: z.string().email('Enter a valid email address.').optional().nullable(),
    address: z.string().max(500).optional().nullable(),
  })),
  async (req, res, next) => {
    try {
      res.json(await offices.updateContact({
        officeId: req.params.officeId, ...req.body, actor: req.user, ip: req.ip,
      }));
    } catch (err) { next(err); }
  }
);

/** PATCH strength — SUPER ADMIN ONLY. This is the system of record. */
officesRouter.patch(
  '/:officeId/strength',
  authenticate, requireCsrfHeader, requireSuperAdmin, writeLimiter,
  validateParams(idParam),
  validateBody(z.object({
    srAO: z.number().int().min(0).max(999).optional(),
    aao: z.number().int().min(0).max(999).optional(),
    acctt: z.number().int().min(0).max(9999).optional(),
    status: z.enum(['Active', 'Inactive']).optional(),
    parentOrg: z.string().max(60).optional(),
    station: z.string().max(60).optional(),
  })),
  async (req, res, next) => {
    try {
      res.json(await offices.updateStrength({
        officeId: req.params.officeId, ...req.body, actor: req.user, ip: req.ip,
      }));
    } catch (err) { next(err); }
  }
);
