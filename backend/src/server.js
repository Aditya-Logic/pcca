/**
 * PCCA Portal API — pcca.mha.gov.in
 *
 * Security posture, in the order it is applied below:
 *   helmet        — CSP, HSTS, frame denial, MIME sniff protection
 *   CORS          — single allowed origin, credentials on, no wildcard
 *   body limits   — 100 kB on JSON, so a huge body cannot exhaust memory
 *   rate limits   — applied per route group
 *   cookies       — httpOnly, Secure, SameSite=strict
 *   error handler — one exit, no stack traces to the client
 */
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';

import { config } from './config/env.js';
import { logger } from './utils/logger.js';
import { healthcheck, pool } from './db/pool.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

import { authRouter } from './routes/auth.routes.js';
import { officesRouter } from './routes/offices.routes.js';
import { documentsRouter } from './routes/documents.routes.js';
import { queriesRouter } from './routes/queries.routes.js';
import { adminRouter } from './routes/admin.routes.js';

const app = express();

// Behind Nginx. Required for req.ip and rate limiting to see the real client.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],   // inline styles in the static page
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],                 // no framing — clickjacking
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: config.isProd ? [] : null,
    },
  },
  hsts: config.isProd
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
  referrerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-site' },
}));

// Single origin. No wildcard — credentials are in play.
app.use(cors({
  origin: config.publicOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Requested-With'],
  maxAge: 600,
}));

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(cookieParser());

app.use(pinoHttp({
  logger,
  autoLogging: { ignore: (req) => req.url === '/api/health' },
}));

/* ---------- routes ---------- */

app.get('/api/health', async (_req, res) => {
  try {
    const db = await healthcheck();
    res.json({ status: db ? 'ok' : 'degraded', db, time: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'down' });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/offices', officesRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/queries', queriesRouter);
app.use('/api/admin', adminRouter);

app.use(notFoundHandler);
app.use(errorHandler);

/* ---------- lifecycle ---------- */

const server = app.listen(config.port, () => {
  logger.info(
    { port: config.port, env: config.env, demo: config.isDemo },
    'PCCA API listening'
  );
  if (config.isDemo) {
    logger.warn('DEMO_MODE is on. One-time codes are written to this log. Never use in production.');
  }
});

async function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  server.close(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
  // Do not hang forever if a connection refuses to close.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandled promise rejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception — exiting');
  process.exit(1);
});

export { app };
