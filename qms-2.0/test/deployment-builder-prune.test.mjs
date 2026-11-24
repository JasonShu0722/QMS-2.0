import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const source = (await readFile(new URL('../deployment/deploy.sh', import.meta.url), 'utf8')).replaceAll('\r', '');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const posix = (path) => path.replaceAll('\\', '/').replace(/^([a-z]):/i, (_, drive) => `/${drive.toLowerCase()}`);
const sha = 'a'.repeat(40);
const previous = 'b'.repeat(40);

async function deploy(context, scenario = '') {
  const temp = await realpath(tmpdir());
  const directory = await mkdtemp(join(temp, 'qms-deploy-flow-'));
  context.after(async () => {
    assert.equal(await realpath(directory), directory);
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  await writeFile(join(directory, 'deployed-sha'), `${scenario === 'same-sha' ? sha : previous}\n`);
  if (scenario === 'pending') await writeFile(join(directory, 'migration-started-sha'), `${sha}\n`);
  const root = posix(directory);
  const checkpointStart = source.indexOf('# Migration backup checkpoint:');
  const checkpointEnd = source.indexOf('# End migration backup checkpoint');
  assert.ok(checkpointStart > 0 && checkpointEnd > checkpointStart);
  const wrapper = `set -- ${sha}
export PATH="$PATH"
flock() { return 0; }
git() {
  case "$*" in
    *branch*) printf 'main\\n' ;;
    *status*|*fetch*|*merge*|*show*) : ;;
    *rev-parse*) printf '${sha}\\n' ;;
    *) return 40 ;;
  esac
}
docker() {
  printf 'docker %s\\n' "$*" >> '${root}/trace'
  case "$*" in
    'info '*) printf '${root}\\n' ;;
    'inspect '*State.StartedAt*) printf 'running|time\\n' ;;
    'image inspect --format '*) printf 'sha256:previous\\n' ;;
    'inspect '*'.Image'*)
      if [[ "$SCENARIO" == restore && ! -f '${root}/restored' ]]; then
        printf 'sha256:other|running|healthy\\n'
      else
        printf 'sha256:previous|running|healthy\\n'
      fi ;;
    'logs '*) printf 'QMS_WORKER_READY\\n' ;;
    *' ps -q '*) printf 'fixture\\n' ;;
    *' up '*'--pull never'*) touch '${root}/restored' ;;
    *' run '*migrate*) [[ "$SCENARIO" != migrate ]] ;;
    *) : ;;
  esac
}
df() { printf 'Available\\n%s\\n' "$([[ "$SCENARIO" == disk ]] && printf 100 || printf 99999999999)"; }
curl() { if [[ "$SCENARIO" == health ]]; then printf 503; else printf 200; fi; }
bash() {
  printf 'cleanup %s\\n' "$*" >> '${root}/trace'
  [[ $(cat '${root}/deployed-sha') == '${sha}' ]] || return 65
  [[ "$SCENARIO" != cleanup ]] || return 73
}
${(source.slice(0, checkpointStart) + '[[ "$SCENARIO" != backup && "$SCENARIO" != pending && "$SCENARIO" != restore ]]\n' + source.slice(checkpointEnd))
    .replaceAll('/opt/qms2', root)
    .replace('cd "$app"', ':')
    .replace('test -f "$env_file"', ':')}
`;
  const result = spawnSync(bash, ['-s'], { input: wrapper, env: { ...process.env, SCENARIO: scenario }, encoding: 'utf8', timeout: 30000 });
  const marker = (await readFile(join(directory, 'deployed-sha'), 'utf8')).trim();
  const pending = await readFile(join(directory, 'migration-started-sha'), 'utf8').catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return '';
  });
  const trace = await readFile(join(directory, 'trace'), 'utf8');
  return { result, marker, pending: pending.trim(), trace };
}

test('successful deployment and cleanup warning both retain the healthy SHA and exit successfully', async (context) => {
  for (const scenario of ['', 'cleanup']) {
    const { result, marker, pending, trace } = await deploy(context, scenario);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(marker, sha);
    assert.equal(pending, '');
    assert.match(trace, /cleanup .*deploy-cleanup\.sh --lock-held\n/);
    assert.match(result.stdout, /Deployment successful:/);
    if (scenario) assert.match(result.stderr, /cleanup failed/i);
  }
});

test('low disk aborts before building, migrating or pruning', async (context) => {
  const { result, marker, trace } = await deploy(context, 'disk');
  assert.notEqual(result.status, 0);
  assert.equal(marker, previous);
  assert.doesNotMatch(trace, / build | migrate /);
  assert.match(trace, /cleanup .*deploy-cleanup\.sh --lock-held/);
  assert.match(result.stderr, /Insufficient deployment disk space/);
});

test('retrying the current successful SHA never rebuilds its rollback tags', async (context) => {
  const { result, marker, pending, trace } = await deploy(context, 'same-sha');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(marker, sha);
  assert.equal(pending, '');
  assert.doesNotMatch(trace, / build /);
  assert.match(trace, /image inspect qms2-foundation-api:/);
});

test('pre-migration failure preserves a healthy previous application or restores its exact version', async (context) => {
  for (const scenario of ['backup', 'restore']) {
    const { result, marker, pending, trace } = await deploy(context, scenario);
    assert.notEqual(result.status, 0);
    assert.equal(marker, previous);
    assert.equal(pending, '');
    assert.doesNotMatch(trace, / migrate |cleanup/);
    if (scenario === 'backup') {
      assert.doesNotMatch(trace, /--pull never/);
      assert.match(result.stdout, /Previous deployment is still healthy/);
    } else {
      assert.match(trace, / up -d --no-deps --no-build --pull never --wait --wait-timeout 180 api worker web/);
      assert.match(result.stdout, /Previous deployment restored and verified/);
    }
  }
});

for (const scenario of ['migrate', 'health', 'pending']) {
  test(`${scenario} failure preserves the previous successful SHA and blocks automatic rollback and cleanup`, async (context) => {
    const { result, marker, pending, trace } = await deploy(context, scenario);
    assert.notEqual(result.status, 0);
    assert.equal(marker, previous);
    assert.equal(pending, sha);
    assert.match(result.stderr, /Automatic rollback disabled/);
    assert.doesNotMatch(trace, /cleanup|--pull never/);
  });
}
