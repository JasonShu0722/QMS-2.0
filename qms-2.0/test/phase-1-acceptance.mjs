import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const pnpm = process.env.npm_execpath;
const steps = [
  ['Frozen dependencies', ['install', '--frozen-lockfile']],
  ['PostgreSQL migration, seed, persistence and recovery', ['--filter', '@qms/api', 'test:integration']],
  ['API and Web behavior', ['test']],
  ['Production builds', ['build']],
  ['Real worker process lifecycle', ['--filter', '@qms/api', 'test:worker-process']],
  ['Compose configuration', null],
  ['Archive isolation', ['check:archive-isolation']],
  ['OpenAPI synchronization', ['contracts:check']],
  ['Real browser login, scope and session lifecycle', ['--filter', '@qms/web', 'test:e2e']],
];

try {
  assert.match(process.version, /^v22\./, 'Use Node.js >=22.22.0 <23');
  assert.ok(Number(process.versions.node.split('.')[1]) >= 22, 'Use Node.js >=22.22.0 <23');
  assert.ok(pnpm, 'Run through pnpm acceptance:phase-1');
  for (const name of [
    'DATABASE_URL', 'QMS_SEED_INTERNAL_PASSWORD', 'QMS_SEED_SUPPLIER_PASSWORD',
    'POSTGRES_PASSWORD', 'MINIO_ROOT_USER', 'MINIO_ROOT_PASSWORD',
    'QMS_RATE_LIMIT_SECRET', 'QMS_ACCEPTANCE_BASE_URL', 'QMS_SECURITY_CURRENT_KEY_ID', 'QMS_SECURITY_KEYRING',
    'QMS_OBJECT_STORAGE_ACCESS_KEY', 'QMS_OBJECT_STORAGE_SECRET_KEY', 'QMS_ACCEPTANCE_MFA_CACHE_FILE', 'QMS_BACKUP_KEY',
  ]) assert.ok(process.env[name]?.trim(), `Required environment variable missing: ${name}`);
  assert.equal(process.env.NODE_ENV, 'development', 'Acceptance requires disposable development services');
  const database = new URL(process.env.DATABASE_URL);
  assert.ok(['postgres:', 'postgresql:'].includes(database.protocol), 'Real PostgreSQL is required');
  assert.notEqual(database.port, '55440', 'The preserved preview database is forbidden');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(database.hostname), 'Use a disposable loopback PostgreSQL database');
  const gateway = new URL(process.env.QMS_ACCEPTANCE_BASE_URL);
  assert.ok(['http:', 'https:'].includes(gateway.protocol), 'Use an HTTP(S) gateway');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(gateway.hostname), 'Use a disposable loopback gateway');
  assert.ok(!gateway.username && !gateway.password, 'Do not place credentials in the gateway URL');
  assert.equal(execFileSync(process.execPath, [pnpm, '--version'], { cwd: root, encoding: 'utf8' }).trim(), '11.19.0');
  execFileSync('docker', ['compose', 'version'], { cwd: root, stdio: 'pipe' });
  process.env.PLAYWRIGHT_BASE_URL = gateway.origin;
  for (const [name, args] of steps) {
    const started = Date.now();
    const command = args ? `pnpm ${args.join(' ')}` : 'docker compose -f deployment/docker-compose.foundation.yml config --quiet';
    console.log(`\nRUN ${name}: ${command}`);
    try {
      execFileSync(args ? process.execPath : 'docker', args
        ? [pnpm, ...args]
        : ['compose', '-f', 'deployment/docker-compose.foundation.yml', 'config', '--quiet'], {
        cwd: root, stdio: 'inherit', env: process.env,
      });
      results.push({ name, command, status: 'PASS', seconds: Math.round((Date.now() - started) / 1000) });
    } catch {
      results.push({ name, command, status: 'FAIL' });
      throw new Error(`${name} failed; remaining steps were not run`);
    }
  }
} catch (error) {
  console.error(`Phase 1 acceptance: FAIL (${error.message})`);
  process.exitCode = 1;
} finally {
  for (const [name] of steps) {
    if (!results.some((result) => result.name === name)) {
      results.push({ name, status: 'FAIL', reason: 'Not run: prerequisite or earlier command failed' });
    }
  }
  console.table(results);
  console.log(`Phase 1 automated acceptance: ${process.exitCode ? 'FAIL' : 'PASS'}`);
  console.log('Container image build and lifecycle evidence are recorded separately in docs/FOUNDATION.md.');
}
