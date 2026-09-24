/**
 * Seed the 85 offices from the source spreadsheet extract, and — in
 * demo mode only — a small set of known accounts.
 *
 * The office figures are the real ones from Staff_strength.xlsx:
 * 85 offices, 196 Sr. AOs, 253 AAOs, 912 Sr. Accountants/Accountants.
 *
 * `station` and `parent_org` are PARSED from the office name, not read
 * from the source. That is recorded in derived_fields so a super admin
 * can review all 85 rather than trust the parser.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';
import { config } from '../config/env.js';
import { hashPassword } from '../services/auth.service.js';
import { logger } from '../utils/logger.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Demo accounts. Created ONLY when DEMO_MODE=true.
 * env.js refuses to boot with DEMO_MODE=true under NODE_ENV=production,
 * so these cannot exist on a production server.
 */
const DEMO_USERS = [
  {
    email: 'superadmin@pcca.mha.gov.in',
    password: 'Demo@Pcca#2026',
    fullName: 'Demo Super Administrator',
    role: 'SUPER_ADMIN',
    officeId: null,
  },
  {
    email: 'pao.crpf@pcca.mha.gov.in',
    password: 'Demo@Crpf#2026',
    fullName: 'Demo PAO Administrator (CRPF)',
    role: 'PAO_ADMIN',
    officeId: 'pao-020',   // PAO(CRPF)
  },
  {
    email: 'pao.cisf@pcca.mha.gov.in',
    password: 'Demo@Cisf#2026',
    fullName: 'Demo PAO Administrator (CISF)',
    role: 'PAO_ADMIN',
    officeId: 'pao-007',   // PAO(CISF)
  },
];

async function seedOffices() {
  const raw = await fs.readFile(path.join(here, 'offices.seed.json'), 'utf8');
  const offices = JSON.parse(raw);

  for (const o of offices) {
    await pool.query(
      `INSERT INTO offices (id, name, parent_org, station, sr_ao, aao, acctt, status, derived_fields)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         sr_ao = EXCLUDED.sr_ao,
         aao = EXCLUDED.aao,
         acctt = EXCLUDED.acctt`,
      [
        o.id, o.name, o.force, o.location,
        o.srAO, o.aao, o.acctt, o.status ?? 'Active',
        // Flag both as parsed so they appear in the super admin review list
        JSON.stringify({ parent_org: 'parsed_from_name', station: 'parsed_from_name' }),
      ]
    );
  }

  const { rows } = await pool.query(`
    SELECT COUNT(*)::int AS offices,
           SUM(sr_ao)::int AS sr_ao,
           SUM(aao)::int AS aao,
           SUM(acctt)::int AS acctt
      FROM offices
  `);
  const t = rows[0];
  logger.info(t, 'offices seeded');

  // The source file's figures. If these ever stop matching, the seed is wrong.
  const expected = { offices: 85, sr_ao: 196, aao: 253, acctt: 912 };
  const mismatch = Object.entries(expected).filter(([k, v]) => t[k] !== v);
  if (mismatch.length) {
    logger.error({ expected, actual: t }, 'SEED TOTALS DO NOT MATCH THE SOURCE FILE');
    throw new Error('Seed verification failed.');
  }
  logger.info('totals verified against Staff_strength.xlsx: 85 / 196 / 253 / 912');
}

async function seedDemoUsers() {
  if (!config.isDemo) {
    logger.info('DEMO_MODE off — no demo accounts created');
    return;
  }

  logger.warn('DEMO_MODE on — creating known demo accounts');

  for (const u of DEMO_USERS) {
    await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, office_id, status, mobile)
       VALUES ($1,$2,$3,$4,$5,'ACTIVE','+91-0000000000')
       ON CONFLICT (email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         status = 'ACTIVE'`,
      [u.email, await hashPassword(u.password), u.fullName, u.role, u.officeId]
    );
    logger.info({ email: u.email, role: u.role }, 'demo account ready');
  }

  console.log('\n  Demo sign-in credentials');
  console.log('  ------------------------------------------------------');
  for (const u of DEMO_USERS) {
    console.log(`  ${u.role.padEnd(11)}  ${u.email}`);
    console.log(`  ${''.padEnd(11)}  ${u.password}\n`);
  }
  console.log('  Sign-in is two steps. After the password, the one-time');
  console.log('  code is printed in the API log (demo mode only).\n');
}

async function main() {
  await seedOffices();
  await seedDemoUsers();
  await pool.end();
}

main().catch(async (err) => {
  logger.error({ err }, 'seed failed');
  await pool.end().catch(() => {});
  process.exit(1);
});
