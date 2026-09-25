import pg from 'pg';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const repo = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const database = `worktruth_release_audit_${Date.now()}`;
const originalUrl = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(originalUrl.hostname)) throw new Error('Release audit requires local PostgreSQL');
const auditUrl = new URL(originalUrl);
auditUrl.pathname = `/${database}`;
const admin = new pg.Client({ connectionString: originalUrl.toString() });
let created = false;
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  process.env.DATABASE_URL = auditUrl.toString();
  process.env.SEED_DEMO_DATA = 'true';
  process.env.SEED_ADMIN_EMAIL = 'release-admin@example.test';
  process.env.SEED_ADMIN_NAME = 'Release Admin';
  process.env.SEED_ADMIN_PASSWORD = randomBytes(24).toString('hex');
  for (const command of ['db:migrate', 'db:seed']) {
    const windows = process.platform === 'win32';
    const result = spawnSync(windows ? (process.env.ComSpec ?? 'cmd.exe') : 'pnpm', windows ? ['/d', '/s', '/c', `pnpm ${command}`] : [command], { cwd: repo, env: process.env, stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`${command} failed: ${result.status}`);
  }

  const smoke = spawnSync(process.execPath, ['release-api-smoke.mjs'], { cwd: path.dirname(fileURLToPath(import.meta.url)), env: { ...process.env, LOG_LEVEL: 'silent' }, stdio: 'inherit' });
  if (smoke.status !== 0) throw new Error('API smoke failed');
} finally {
  if (created) {
    await admin.query(`DROP DATABASE "${database}"`);
  }
  await admin.end();
}
