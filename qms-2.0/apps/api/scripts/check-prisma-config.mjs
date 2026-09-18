import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const env = {
  ...process.env,
  DATABASE_URL: '',
  // Never load a developer's local .env during this guard verification.
  DOTENV_CONFIG_PATH: fileURLToPath(new URL('./nonexistent-config-test.env', import.meta.url)),
};

for (const [label, command] of [
  ['db:migrate:deploy', scripts['db:migrate:deploy']],
  ['db:seed', scripts['db:seed']],
  ['db push', 'node node_modules/prisma/build/index.js db push'],
]) {
  const result = spawnSync(command, { cwd, env, shell: true, encoding: 'utf8', timeout: 15_000 });
  assert.ifError(result.error);
  assert.notEqual(result.status, 0, `${label} must fail without DATABASE_URL`);
  assert.match(result.stdout + result.stderr, /DATABASE_URL is required for database commands/);
  console.info(`${label}: rejected without DATABASE_URL within 15 seconds`);
}

for (const label of ['db:validate', 'db:generate']) {
  const result = spawnSync(scripts[label], { cwd, env, shell: true, encoding: 'utf8', timeout: 30_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  console.info(`${label}: passed without DATABASE_URL`);
}
