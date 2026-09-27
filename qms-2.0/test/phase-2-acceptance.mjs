import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, realpath } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const loopback = (value) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(value);
const required = (name) => {
  assert.ok(process.env[name]?.trim(), `Required environment variable missing: ${name}`);
  return process.env[name];
};
function database(name) {
  const value = new URL(required(name));
  assert.ok(['postgres:', 'postgresql:'].includes(value.protocol) && loopback(value.hostname), `${name} must use disposable loopback PostgreSQL`);
  assert.notEqual(value.port, '55440', 'The preserved preview database is forbidden');
  return value;
}
async function externalFile(name) {
  const file = await realpath(required(name));
  const path = relative(await realpath(join(root, '..')), file);
  assert.ok(path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path), `${name} must remain outside Git`);
  await access(file);
}
async function gateway(name) {
  const value = new URL(required(name));
  assert.ok(['http:', 'https:'].includes(value.protocol) && loopback(value.hostname) && !value.username && !value.password, `${name} requires a loopback gateway without URL credentials`);
  const response = await fetch(new URL('/api/v1/auth/csrf', value), { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200, `${name} must reach the real API`);
  assert.equal(typeof (await response.json()).csrfToken, 'string');
}
async function scanner() {
  const host = required('QMS_FILE_SCANNER_HOST');
  const port = Number(required('QMS_FILE_SCANNER_PORT'));
  assert.ok(loopback(host) && Number.isInteger(port) && port > 0 && port < 65536, 'Use the disposable loopback ClamAV service');
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    let response = '';
    const finish = (error) => { socket.destroy(); error ? reject(error) : resolve(); };
    socket.setTimeout(10000, () => finish(new Error('ClamAV preflight timed out')));
    socket.once('error', () => finish(new Error('ClamAV is unavailable')));
    socket.once('connect', () => socket.write('zPING\0'));
    socket.on('data', (chunk) => {
      response += chunk.toString();
      if (response.length > 100) return finish(new Error('Invalid ClamAV response'));
      if (response.includes('\0')) finish(response === 'PONG\0' ? undefined : new Error('Invalid ClamAV response'));
    });
    socket.once('end', () => { if (response !== 'PONG\0') finish(new Error('Incomplete ClamAV response')); });
  });
}
async function step(name, run) {
  console.log(`RUN PHASE2 ${name}`);
  const started = Date.now();
  try { await run(); results.push({ name, status: 'PASS', seconds: Math.round((Date.now() - started) / 1000) }); }
  catch (error) { results.push({ name, status: 'FAIL' }); throw error; }
}
try {
  await step('Real service prerequisites', async () => {
    assert.equal(process.env.QMS_ACCEPTANCE_DISPOSABLE_DATABASE, 'true', 'Explicit disposable acceptance configuration is required');
    assert.equal(process.env.NODE_ENV, 'development');
    required('npm_execpath');
    const main = database('DATABASE_URL');
    const file = database('QMS_FILE_BROWSER_DATABASE_URL');
    const problem = database('QMS_PROBLEM_BROWSER_DATABASE_URL');
    assert.equal(new Set([main, file, problem].map((value) => `${value.port || '5432'}${value.pathname}`)).size, 3, 'Main, file and problem browser databases must be isolated');
    assert.match(file.pathname, /^\/qms_file_browser_[a-f0-9]+$/);
    assert.match(problem.pathname, /^\/qms_problem_browser_[a-f0-9]+$/);
    required('QMS_FILE_BROWSER_PASSWORD'); required('QMS_PROBLEM_BROWSER_PASSWORD');
    await Promise.all([
      externalFile('QMS_FILE_BROWSER_FIXTURE_PATH'), externalFile('QMS_PROBLEM_BROWSER_FIXTURE_PATH'), externalFile('QMS_FILE_TEST_ENCRYPTED_PATH'),
    ]);
    await Promise.all([
      gateway('QMS_ACCEPTANCE_BASE_URL'), gateway('QMS_FILE_BROWSER_BASE_URL'), gateway('QMS_PROBLEM_BROWSER_BASE_URL'), scanner(),
    ]);
    const storage = new URL(required('QMS_OBJECT_STORAGE_ENDPOINT'));
    assert.ok(loopback(storage.hostname), 'Use disposable loopback object storage');
    assert.equal((await fetch(new URL('/health', storage), { signal: AbortSignal.timeout(10000) })).status, 200, 'Real object storage must be ready');
    required('QMS_ACCEPTANCE_MAILPIT_URL');
  });
  await step('Full foundation and phase 2 regression', () => execFileSync(process.execPath, [process.env.npm_execpath, 'acceptance:phase-1'], { cwd: root, stdio: 'inherit', env: process.env }));
  await step('Test domain Swagger contract synchronization', () => execFileSync(process.execPath, [process.env.npm_execpath, '--filter', '@qms/contracts', 'testing:problem-browser:check'], { cwd: root, stdio: 'inherit', env: process.env }));
  await step('Production scanning Compose configuration', () => execFileSync('docker', ['compose', '-f', 'deployment/docker-compose.foundation.yml', '-f', 'deployment/docker-compose.scanning.yml', 'config', '--quiet'], { cwd: root, stdio: 'inherit', env: process.env }));
} catch (error) {
  console.error(`Phase 2 acceptance: FAIL (${error.message})`);
  process.exitCode = 1;
} finally {
  console.table(results);
  console.log(`Phase 2 automated acceptance: ${process.exitCode ? 'FAIL' : 'PASS'}`);
}
