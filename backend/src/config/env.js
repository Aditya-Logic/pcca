/**
 * Environment configuration.
 *
 * Every secret the application needs is read here and nowhere else.
 * Missing or weak values kill the process at boot rather than surfacing
 * as a mystery at 2 a.m. (see docs/rules.md — "Fail loudly at boot").
 *
 * NOTHING in this file is ever sent to the browser.
 */
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  // Postgres
  PGHOST: z.string().min(1),
  PGPORT: z.coerce.number().int().positive().default(5432),
  PGDATABASE: z.string().min(1),
  PGUSER: z.string().min(1),
  PGPASSWORD: z.string().min(1),
  PGSSL: z.enum(['true', 'false']).default('false'),

  // Auth secrets — must be long. Generate with: npm run keys:generate
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  ACCESS_TTL_MIN: z.coerce.number().int().positive().default(15),
  REFRESH_TTL_HOURS: z.coerce.number().int().positive().default(8),

  // Where the browser app is served from — used for CORS and cookie scope
  PUBLIC_ORIGIN: z.string().url().default('http://localhost:8080'),
  COOKIE_DOMAIN: z.string().optional(),

  // Uploads
  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(25),

  // Optional integrations. Absent in the demo; required in production.
  SMTP_URL: z.string().optional(),
  SMS_GATEWAY_URL: z.string().optional(),
  SMS_GATEWAY_KEY: z.string().optional(),
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().int().optional(),

  // Demo mode. MUST be false in production — it prints OTPs to the log
  // instead of sending them, and seeds known demo accounts.
  DEMO_MODE: z.enum(['true', 'false']).default('false'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('\n  Configuration error — refusing to start.\n');
  for (const issue of parsed.error.issues) {
    console.error(`   ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('\n  Copy .env.example to .env and fill it in.\n');
  process.exit(1);
}

const env = parsed.data;

// Refuse to run demo mode in production. This is the single most
// dangerous misconfiguration possible here.
if (env.NODE_ENV === 'production' && env.DEMO_MODE === 'true') {
  console.error('\n  DEMO_MODE=true with NODE_ENV=production. Refusing to start.\n');
  process.exit(1);
}

// Refuse the placeholder secrets that ship in .env.example.
const placeholders = ['changeme', 'replace-me', 'your-secret-here'];
for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
  if (placeholders.some((p) => env[key].toLowerCase().includes(p))) {
    console.error(`\n  ${key} still holds a placeholder value. Run: npm run keys:generate\n`);
    process.exit(1);
  }
}

if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
  console.error('\n  JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ.\n');
  process.exit(1);
}

export const config = {
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  isDemo: env.DEMO_MODE === 'true',
  port: env.PORT,

  db: {
    host: env.PGHOST,
    port: env.PGPORT,
    database: env.PGDATABASE,
    user: env.PGUSER,
    password: env.PGPASSWORD,
    ssl: env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
  },

  jwt: {
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessTtlMin: env.ACCESS_TTL_MIN,
    refreshTtlHours: env.REFRESH_TTL_HOURS,
  },

  publicOrigin: env.PUBLIC_ORIGIN,
  cookieDomain: env.COOKIE_DOMAIN,

  upload: {
    dir: env.UPLOAD_DIR,
    maxBytes: env.MAX_UPLOAD_MB * 1024 * 1024,
    maxMb: env.MAX_UPLOAD_MB,
    allowedMime: [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
  },

  smtpUrl: env.SMTP_URL,
  sms: { url: env.SMS_GATEWAY_URL, key: env.SMS_GATEWAY_KEY },
  clamav: { host: env.CLAMAV_HOST, port: env.CLAMAV_PORT },
};
