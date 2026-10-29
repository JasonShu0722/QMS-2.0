import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { isDisposableLoopbackPostgres } from './disposable-postgres.js';

export async function createDisposableAppDatabase(prefix: string): Promise<string> {
  const originalUrl = process.env.DATABASE_URL;
  if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(originalUrl)) {
    throw new Error('App fixtures require explicitly disposable loopback PostgreSQL, never preview 55440 or URL overrides.');
  }
  if (!/^[a-z][a-z0-9_]{0,29}$/.test(prefix)) throw new Error('Unsafe disposable database prefix.');
  const database = `${prefix}_${randomUUID().replaceAll('-', '')}`;
  const target = new URL(originalUrl!);
  const control = new URL(originalUrl!);
  control.pathname = '/postgres';
  target.pathname = `/${database}`;
  const admin = new Client({ connectionString: control.toString(), connectionTimeoutMillis: 5000 });
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}"`);
  } finally {
    await admin.end();
  }
  // Keep each created database for evidence, including failed migration/seed attempts.
  console.info(`QMS_TEST_DATABASE_CREATED ${database}`);
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  const env = { ...process.env, DATABASE_URL: target.toString(), NODE_ENV: 'development' };
  for (const args of [['migrate', 'deploy'], ['db', 'seed']]) {
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', ...args], {
      cwd, env, timeout: 120000, windowsHide: true, stdio: 'inherit',
    });
  }
  console.info(`QMS_TEST_DATABASE_READY ${database}`);
  return target.toString();
}
