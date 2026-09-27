import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { closeSync, openSync, readFileSync } from 'node:fs';
import { access, realpath } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const loopback = (value) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(value);
const pnpm = process.env.npm_execpath;

function required(name) {
  assert.ok(process.env[name]?.trim(), `Required environment variable missing: ${name}`);
  return process.env[name];
}

function disposableDatabase(name) {
  const value = new URL(required(name));
  assert.ok(['postgres:', 'postgresql:'].includes(value.protocol), `${name} must use PostgreSQL`);
  assert.ok(loopback(value.hostname), `${name} must use disposable loopback PostgreSQL`);
  assert.notEqual(value.port, '55440', `${name} must not use the preserved preview database`);
  return value;
}

function loopbackUrl(name) {
  const value = new URL(required(name));
  assert.ok(['http:', 'https:'].includes(value.protocol), `${name} must use HTTP(S)`);
  assert.ok(loopback(value.hostname), `${name} must use a disposable loopback service`);
  assert.ok(!value.username && !value.password, `${name} must not contain URL credentials`);
  return value;
}

async function externalFile(name) {
  const file = await realpath(required(name));
  const repositoryParent = await realpath(join(root, '..'));
  const path = relative(repositoryParent, file);
  assert.ok(path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path), `${name} must remain outside Git`);
  await access(file);
}

async function probe(name, url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  assert.ok(response.ok, `${name} returned HTTP ${response.status}`);
}

async function scanner() {
  const host = required('QMS_FILE_SCANNER_HOST');
  const port = Number(required('QMS_FILE_SCANNER_PORT'));
  assert.ok(loopback(host) && Number.isInteger(port) && port > 0 && port < 65536, 'Use a disposable loopback ClamAV service');
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    let response = '';
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      error ? reject(error) : resolve();
    };
    socket.setTimeout(10000, () => finish(new Error('ClamAV preflight timed out')));
    socket.once('error', () => finish(new Error('ClamAV is unavailable')));
    socket.once('connect', () => socket.write('zPING\0'));
    socket.on('data', (chunk) => {
      response += chunk.toString();
      if (response.length > 100) return finish(new Error('Invalid ClamAV response'));
      if (response.includes('\0')) finish(response === 'PONG\0' ? undefined : new Error('Invalid ClamAV response'));
    });
    socket.once('end', () => {
      if (response !== 'PONG\0') finish(new Error('Incomplete ClamAV response'));
    });
  });
}

async function chromium() {
  const modulePath = pathToFileURL(join(root, 'apps', 'web', 'node_modules', '@playwright', 'test', 'index.mjs')).href;
  const { chromium: browserType } = await import(modulePath);
  const browser = await browserType.launch({ headless: true });
  await browser.close();
}

async function preflight() {
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  assert.ok(major === 24 && (minor > 21 || (minor === 21 && patch >= 0)), 'Use Node.js >=24.21.0 <25');
  assert.ok(pnpm, 'Run through pnpm acceptance:phase-5');
  assert.equal(process.env.NODE_ENV, 'development', 'Acceptance requires disposable development services');
  assert.equal(process.env.QMS_ACCEPTANCE_DISPOSABLE_DATABASE, 'true', 'Explicit disposable acceptance configuration is required');
  assert.equal(process.env.QMS_DISPOSABLE_TEST_DB, 'true', 'Integration tests require QMS_DISPOSABLE_TEST_DB=true');
  assert.equal(execFileSync(process.execPath, [pnpm, '--version'], { cwd: root, encoding: 'utf8' }).trim(), '11.19.0');

  const main = disposableDatabase('DATABASE_URL');
  const file = disposableDatabase('QMS_FILE_BROWSER_DATABASE_URL');
  const problem = disposableDatabase('QMS_PROBLEM_BROWSER_DATABASE_URL');
  assert.equal(new Set([main, file, problem].map((value) => `${value.port || '5432'}${value.pathname}`)).size, 3, 'Acceptance databases must be isolated');
  for (const name of [
    'QMS_SEED_INTERNAL_PASSWORD', 'QMS_SEED_SUPPLIER_PASSWORD', 'POSTGRES_PASSWORD',
    'MINIO_ROOT_USER', 'MINIO_ROOT_PASSWORD', 'QMS_RATE_LIMIT_SECRET',
    'QMS_SECURITY_CURRENT_KEY_ID', 'QMS_SECURITY_KEYRING', 'QMS_OBJECT_STORAGE_ACCESS_KEY',
    'QMS_OBJECT_STORAGE_SECRET_KEY', 'QMS_ACCEPTANCE_MFA_CACHE_FILE', 'QMS_BACKUP_KEY',
    'QMS_FILE_BROWSER_PASSWORD', 'QMS_PROBLEM_BROWSER_PASSWORD',
  ]) required(name);
  for (const name of ['QMS_FILE_BROWSER_FIXTURE_PATH', 'QMS_PROBLEM_BROWSER_FIXTURE_PATH', 'QMS_FILE_TEST_ENCRYPTED_PATH']) await externalFile(name);

  const gateway = loopbackUrl('QMS_ACCEPTANCE_BASE_URL');
  const fileGateway = loopbackUrl('QMS_FILE_BROWSER_BASE_URL');
  const problemGateway = loopbackUrl('QMS_PROBLEM_BROWSER_BASE_URL');
  await Promise.all([
    probe('QMS_ACCEPTANCE_BASE_URL', new URL('/api/v1/auth/csrf', gateway)),
    probe('QMS_FILE_BROWSER_BASE_URL', new URL('/api/v1/auth/csrf', fileGateway)),
    probe('QMS_PROBLEM_BROWSER_BASE_URL', new URL('/api/v1/auth/csrf', problemGateway)),
  ]);
  const csrf = await fetch(new URL('/api/v1/auth/csrf', gateway), { signal: AbortSignal.timeout(10000) });
  assert.equal(typeof (await csrf.json()).csrfToken, 'string', 'Acceptance gateway must return a CSRF token');

  const storage = loopbackUrl('QMS_OBJECT_STORAGE_ENDPOINT');
  await probe('QMS_OBJECT_STORAGE_ENDPOINT', new URL('/minio/health/ready', storage));
  required('QMS_ACCEPTANCE_MAILPIT_URL');
  const mailpit = loopbackUrl('QMS_ACCEPTANCE_MAILPIT_URL');
  await probe('QMS_ACCEPTANCE_MAILPIT_URL', new URL('/api/v1/messages?limit=1', mailpit));
  await scanner();
  await chromium();
  process.env.PLAYWRIGHT_BASE_URL = gateway.origin;
}

function commandLine(executable, args) {
  return [executable, ...args].join(' ');
}

function runStep(name, executable, args) {
  const command = commandLine(executable, args);
  const started = Date.now();
  console.log(`\nRUN PHASE5 ${name}: ${command}`);
  try {
    execFileSync(executable, args, { cwd: root, stdio: 'inherit', env: process.env });
    results.push({ name, command, status: 'PASS', seconds: Math.round((Date.now() - started) / 1000) });
  } catch (error) {
    results.push({ name, command, status: 'FAIL', reason: error?.message || 'Command failed' });
    process.exitCode = 1;
  }
}

async function runBrowserStep(name, executable, args) {
  const logPath = join(dirname(required('QMS_ACCEPTANCE_MFA_CACHE_FILE')), 'phase5-gate-worker.log');
  const log = openSync(logPath, 'w');
  const worker = spawn(process.execPath, ['dist/worker.js'], {
    cwd: join(root, 'apps', 'api'), env: process.env, stdio: ['ignore', log, log], windowsHide: true,
  });
  let workerError;
  worker.once('error', (error) => { workerError = error; });
  closeSync(log);
  try {
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (workerError) throw workerError;
      if (worker.exitCode !== null) break;
      if (readFileSync(logPath, 'utf8').includes('QMS_WORKER_READY')) { ready = true; break; }
      await delay(1000);
    }
    if (!ready) throw new Error(`Real acceptance worker did not become ready; inspect ${logPath}`);
    runStep(name, executable, args);
  } catch (error) {
    results.push({ name, command: commandLine(executable, args), status: 'FAIL', reason: error?.message || 'Worker startup failed' });
    process.exitCode = 1;
  } finally {
    if (worker.exitCode === null) {
      worker.kill('SIGTERM');
      await Promise.race([new Promise((resolve) => worker.once('exit', resolve)), delay(5000)]);
    }
  }
}

const commandSteps = [
  ['Governance consistency', [pnpm, 'check:governance']],
  ['Archive isolation', [pnpm, 'check:archive-isolation']],
  ['OpenAPI synchronization', [pnpm, 'contracts:check']],
  ['Workspace lint', [pnpm, 'lint']],
  ['Workspace tests', [pnpm, 'test']],
  ['Production builds', [pnpm, 'build']],
  ['API integration and phase-5 domain tests', [pnpm, '--filter', '@qms/api', 'test:integration']],
  ['Real worker process lifecycle', [pnpm, '--filter', '@qms/api', 'test:worker-process']],
  ['Real browser login, scope and phase-5 flows', [pnpm, '--filter', '@qms/web', 'test:e2e']],
  ['Foundation Compose configuration', ['docker', 'compose', '-f', 'deployment/docker-compose.foundation.yml', 'config', '--quiet']],
  ['Scanning Compose configuration', ['docker', 'compose', '-f', 'deployment/docker-compose.foundation.yml', '-f', 'deployment/docker-compose.scanning.yml', 'config', '--quiet']],
];

try {
  await preflight();
  results.push({ name: 'Disposable acceptance resources', status: 'PASS' });
  for (const [name, [executable, ...args]] of commandSteps) {
    const binary = executable === pnpm ? process.execPath : executable;
    const parameters = executable === pnpm ? [pnpm, ...args] : args;
    if (name === 'Real browser login, scope and phase-5 flows') await runBrowserStep(name, binary, parameters);
    else runStep(name, binary, parameters);
  }
} catch (error) {
  process.exitCode = 1;
  results.push({ name: 'Disposable acceptance resources', status: 'FAIL', reason: error?.message || 'Resource preflight failed' });
  for (const [name, [executable, ...args]] of commandSteps) {
    results.push({ name, command: commandLine(executable, args), status: 'NOT_RUN', reason: 'Resource preflight failed' });
  }
}

console.table(results);
console.log(`Phase 5 automated acceptance: ${process.exitCode ? 'FAIL' : 'PASS'}`);
if (process.exitCode) console.error('Phase 5 acceptance requires real disposable services; no mock or skip path is available.');
