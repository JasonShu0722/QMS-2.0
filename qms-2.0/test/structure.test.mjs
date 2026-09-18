import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function exists(relativePath) {
  try {
    await access(join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

assert.equal(await exists('package.json'), true, 'qms-2.0/package.json must exist');
assert.equal(await exists('pnpm-workspace.yaml'), true, 'workspace manifest must exist');
assert.equal(await exists('apps/api/package.json'), true, 'API package must exist');
assert.equal(await exists('apps/web/package.json'), true, 'web package must exist');
assert.equal(await exists('packages/contracts/package.json'), true, 'contracts package must exist');

const workspaceManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
assert.match(
  workspaceManifest.scripts.test,
  /node --test test[\\/]structure\.test\.mjs/,
  'default test must run the qms-2.0 structure test',
);

for (const directory of ['apps', 'apps/api', 'apps/web', 'packages', 'packages/contracts', 'test', 'scripts']) {
  assert.equal(await exists(directory), true, `${directory} must exist`);
}

const workspacePackages = await readdir(join(root, 'apps'));
assert.deepEqual(workspacePackages.sort(), ['api', 'web']);
const sharedPackages = await readdir(join(root, 'packages'));
assert.deepEqual(sharedPackages.sort(), ['contracts']);

const archiveDirectory = ['archive', ['qms', '1.0'].join('-')].join('/');
assert.equal(await exists(archiveDirectory), false, 'archive must not be nested in qms-2.0');
console.log('qms-2.0 structure: PASS');
