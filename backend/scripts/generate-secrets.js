#!/usr/bin/env node
/**
 * Generate cryptographically random secrets for .env.
 * Run: npm run keys:generate
 */
import crypto from 'node:crypto';

const k = () => crypto.randomBytes(48).toString('base64url');

console.log('\n# Paste these into your .env — never commit them.\n');
console.log(`JWT_ACCESS_SECRET=${k()}`);
console.log(`JWT_REFRESH_SECRET=${k()}`);
console.log(`PGPASSWORD=${crypto.randomBytes(24).toString('base64url')}`);
console.log('');
