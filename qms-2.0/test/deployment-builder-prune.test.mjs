import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';

const source = (await readFile(new URL('../deployment/deploy.sh', import.meta.url), 'utf8')).replaceAll('\r', '');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const posix = (path) => path.replaceAll('\\', '/').replace(/^([a-z]):/i, (_, drive) => `/${drive.toLowerCase()}`);
const sha = 'a'.repeat(40);
const tail = source.slice(source.indexOf('for path in /login /api/v1/openapi.json; do'));

test('cleanup follows health and SHA recording inside the deployment lock, and only prunes default builder cache', () => {
  const cleanup = source.indexOf('docker builder prune --force');
  assert.ok(cleanup > source.indexOf('mv -- "$marker_tmp" /opt/qms2/deployed-sha'));
  assert.ok(cleanup < source.indexOf('echo "Deployment successful: $sha"'));
  assert.ok(source.indexOf('flock -w 600 9') < source.indexOf('worker_ready=false'));
  assert.ok(source.indexOf('worker_ready=false') < source.indexOf(tail));
  assert.equal(source.match(/docker builder prune --force/g)?.length, 1);
  assert.doesNotMatch(source, /(?:system|image|container|volume)\s+prune|prune[^\n]*(?:--all|--volumes)|flock\s+-u/);
});

async function runTail(context, failure = '') {
  assert.ok(process.platform !== 'win32' || existsSync(bash), 'Git Bash required for shell control-flow test');
  const directory = await mkdtemp(join(tmpdir(), 'qms-deploy-prune-'));
  context.after(async () => {
    const resolved = await realpath(directory);
    assert.equal(dirname(resolved), await realpath(tmpdir()));
    assert.match(basename(resolved), /^qms-deploy-prune-[a-zA-Z0-9]+$/);
    await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  // Execute the real health/marker/cleanup tail; Docker is always intercepted, never invoked on the host.
  const wrapper = `set -euo pipefail
sha=${sha}
compose() { [[ "$FAILURE" != compose ]] || return 62; }
compose=(compose)
curl() { if [[ "$FAILURE" == health ]]; then printf 503; else printf 200; fi; }
docker() {
  printf '%s\\n' "$*" >> '${posix(join(directory, 'trace'))}'
  [[ "$#" == 3 && "$1" == builder && "$2" == prune && "$3" == --force ]] || return 64
  [[ $(cat '${posix(join(directory, 'deployed-sha'))}') == "$sha" ]] || return 65
  [[ "$FAILURE" != cleanup ]] || return 73
  printf 'Total reclaimed space: 1GB\\n'
}
${tail.replaceAll('/opt/qms2', posix(directory))}
`;
  const result = spawnSync(bash, ['-s'], { input: wrapper, env: { ...process.env, FAILURE: failure }, encoding: 'utf8', timeout: 30000 });
  return { directory, result };
}

test('successful deployment prunes exactly once after the SHA marker and reports reclaimed space', async (context) => {
  const { directory, result } = await runTail(context);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(join(directory, 'trace'), 'utf8'), 'builder prune --force\n');
  assert.equal(await readFile(join(directory, 'deployed-sha'), 'utf8'), `${sha}\n`);
  assert.match(result.stdout, /Total reclaimed space: 1GB/);
  assert.match(result.stdout, /Deployment successful:/);
});

test('cleanup failure fails automation without losing the deployed SHA or claiming deployment success', async (context) => {
  const { directory, result } = await runTail(context, 'cleanup');
  assert.notEqual(result.status, 0);
  assert.equal(await readFile(join(directory, 'trace'), 'utf8'), 'builder prune --force\n');
  assert.equal(await readFile(join(directory, 'deployed-sha'), 'utf8'), `${sha}\n`);
  assert.match(result.stderr, /Deployment healthy.*builder cache cleanup failed/);
  assert.doesNotMatch(result.stdout, /Deployment successful:/);
});

for (const failure of ['health', 'compose']) {
  test(`${failure} failure does not prune or record a successful SHA`, async (context) => {
    const { directory, result } = await runTail(context, failure);
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(join(directory, 'trace')), false);
    assert.equal(existsSync(join(directory, 'deployed-sha')), false);
    assert.doesNotMatch(result.stdout, /Deployment successful:/);
  });
}
