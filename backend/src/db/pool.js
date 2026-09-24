/**
 * Single Postgres connection pool.
 *
 * Every query in the application goes through `query()` or `tx()`.
 * Both use parameterised statements — string-concatenated SQL appears
 * nowhere in this codebase (see docs/rules.md).
 */
import pg from 'pg';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

export const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  ssl: config.db.ssl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  // An idle client blew up. Log it; do not crash the process.
  logger.error({ err }, 'unexpected postgres pool error');
});

/** Run a parameterised query. */
export async function query(text, params = []) {
  const started = Date.now();
  const res = await pool.query(text, params);
  const ms = Date.now() - started;
  if (ms > 500) logger.warn({ ms, text: text.slice(0, 80) }, 'slow query');
  return res;
}

/** Convenience: first row or null. */
export async function one(text, params = []) {
  const { rows } = await query(text, params);
  return rows[0] ?? null;
}

/** Run a function inside a transaction, rolling back on throw. */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function healthcheck() {
  const { rows } = await pool.query('SELECT 1 AS ok');
  return rows[0]?.ok === 1;
}
