import { Router } from 'express';
import { z } from 'zod';
import { validateBody, validateParams } from '../middleware/validate.js';
import { queryLimiter, publicLimiter } from '../middleware/rateLimit.js';
import * as queries from '../services/query.service.js';

export const queriesRouter = Router();

const docParam = z.object({ documentId: z.string().uuid() });

/** GET approved queries — public projection, no author email */
queriesRouter.get(
  '/document/:documentId',
  publicLimiter, validateParams(docParam),
  async (req, res, next) => {
    try { res.json({ queries: await queries.listApproved(req.params.documentId) }); }
    catch (err) { next(err); }
  }
);

/** POST a query — five an hour, held for moderation */
queriesRouter.post(
  '/',
  queryLimiter,
  validateBody(z.object({
    documentId: z.string().uuid('Choose a document to raise the query against.'),
    body: z.string().min(20, 'Describe the issue in at least 20 characters.').max(2000),
    authorName: z.string().min(2, 'Enter your name.').max(120),
    authorEmail: z.string().email('Enter a valid email address so the office can reply.'),
  })),
  async (req, res, next) => {
    try {
      const result = await queries.submitQuery({ ...req.body, ip: req.ip });
      res.status(201).json({
        ...result,
        message: 'Your query has been sent to the office for review.',
      });
    } catch (err) { next(err); }
  }
);
