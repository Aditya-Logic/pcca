/**
 * Virus scanning.
 *
 * Talks to ClamAV over its TCP INSTREAM protocol when CLAMAV_HOST is set.
 * When it is not set (local development, demo), scanning is SKIPPED and
 * the version row records that honestly as scan_status = 'SKIPPED' —
 * it never claims a file was scanned when it was not.
 *
 * Production must set CLAMAV_HOST. See docs/phases.md, Phase 2 blockers.
 */
import net from 'node:net';
import fs from 'node:fs';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

export async function scanFile(filePath) {
  if (!config.clamav.host) {
    logger.warn('CLAMAV_HOST not configured — upload scanning skipped');
    return { status: 'SKIPPED', signature: null };
  }

  return new Promise((resolve) => {
    const socket = net.createConnection(
      { host: config.clamav.host, port: config.clamav.port ?? 3310 },
      () => socket.write('zINSTREAM\0')
    );

    let reply = '';
    socket.setTimeout(30_000);

    socket.on('connect', () => {
      const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });
      stream.on('data', (chunk) => {
        const size = Buffer.alloc(4);
        size.writeUInt32BE(chunk.length, 0);
        socket.write(size);
        socket.write(chunk);
      });
      stream.on('end', () => socket.write(Buffer.from([0, 0, 0, 0])));
      stream.on('error', (err) => {
        logger.error({ err }, 'read error during virus scan');
        socket.destroy();
        resolve({ status: 'PENDING', signature: null });
      });
    });

    socket.on('data', (d) => { reply += d.toString(); });

    socket.on('end', () => {
      if (reply.includes('OK') && !reply.includes('FOUND')) {
        return resolve({ status: 'CLEAN', signature: null });
      }
      if (reply.includes('FOUND')) {
        const signature = reply.split(':')[1]?.replace('FOUND', '').trim() ?? 'unknown';
        logger.warn({ signature }, 'infected upload rejected');
        return resolve({ status: 'INFECTED', signature });
      }
      resolve({ status: 'PENDING', signature: null });
    });

    socket.on('timeout', () => {
      logger.error('virus scan timed out');
      socket.destroy();
      // Fail closed: an unscanned file is never marked clean.
      resolve({ status: 'PENDING', signature: null });
    });

    socket.on('error', (err) => {
      logger.error({ err }, 'clamav connection failed');
      resolve({ status: 'PENDING', signature: null });
    });
  });
}
