/**
 * Apply schema.sql. Idempotent — safe to run repeatedly.
 *
 * Run as a one-shot task on deploy, NOT from application startup:
 * a crash-looping app must not be able to half-apply a migration.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';
import { logger } from '../utils/logger.js';

const here = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const force = process.argv.includes('--force');

  if (force) {
    logger.warn('--force: dropping all tables');
    await pool.query(`
      DROP TABLE IF EXISTS audit_log, queries, document_versions, documents,
        refresh_tokens, login_challenges, users, offices CASCADE;
    `);
  }

  const sql = await fs.readFile(path.join(here, 'schema.sql'), 'utf8');
  await pool.query(sql);
  logger.info('schema applied');
  await pool.end();
}

main().catch(async (err) => {
  logger.error({ err }, 'migration failed');
  await pool.end().catch(() => {});
  process.exit(1);
});
