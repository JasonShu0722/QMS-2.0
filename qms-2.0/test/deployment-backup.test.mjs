import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import test from 'node:test';

const source = (await readFile(new URL('../deployment/deploy.sh', import.meta.url), 'utf8')).replaceAll('\r', '');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const posix = (path) => path.replaceAll('\\', '/').replace(/^([a-z]):/i, (_, drive) => `/${drive.toLowerCase()}`);
const sha = 'a'.repeat(40);

function checkpoint() {
  const start = source.indexOf('# Migration backup checkpoint');
  const end = source.indexOf('# End migration backup checkpoint');
  assert.ok(start >= 0 && end > start, 'deployment needs a mandatory pre-migration backup checkpoint');
  return source.slice(start, end);
}

test('native encrypted checkpoint runs after PostgreSQL is ready and before migrate', () => {
  const block = checkpoint();
  assert.ok(source.indexOf('postgres rustfs clamav') < source.indexOf(block));
  assert.ok(source.indexOf(block) < source.indexOf('migrate deploy'));
  assert.match(block, /pg_dump.*--format=custom/);
  assert.match(block, /pg_dump[^\n]*\n\s*>[^\n]*<\/dev\/null/, 'pg_dump must not consume the remaining SSH bash -s deployment script');
  assert.match(block, /pg_restore --list/);
  assert.match(block, /openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000/);
  assert.match(block, /openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000/);
  assert.match(block, /cmp --/);
  assert.match(block, /backup-keys/);
  assert.match(block, /umask 077/);
  assert.match(block, /stat -c %u/);
  assert.match(block, /stat -c %a/);
  assert.doesNotMatch(block, /QMS_SECURITY|QMS_BACKUP_KEY|POSTGRES_PASSWORD|rm\s+-[a-z]*r/);
});

async function fixture(context, failure = '') {
  assert.ok(process.platform !== 'win32' || existsSync(bash), 'Git Bash required for shell control-flow test');
  const directory = await mkdtemp(join(tmpdir(), 'qms-deploy-backup-'));
  context.after(async () => {
    const resolved = await realpath(directory);
    assert.ok(isAbsolute(resolved));
    assert.equal(dirname(resolved), await realpath(tmpdir()));
    assert.match(basename(resolved), /^qms-deploy-backup-[a-zA-Z0-9]+$/);
    await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const bin = join(directory, 'bin');
  const root = join(directory, 'qms2');
  await mkdir(bin);
  await mkdir(root);
  // Only identity/mode probes and Docker are stubbed; these tests prove control flow, not production permissions or PostgreSQL recovery.
  await writeFile(join(bin, 'id'), '#!/usr/bin/env bash\nprintf 0\n', { mode: 0o755 });
  await writeFile(join(bin, 'stat'), '#!/usr/bin/env bash\ncase "$2" in %u) printf 0;; %a) printf 700;; *) exit 1;; esac\n', { mode: 0o755 });
  const wrapper = `set -euo pipefail
sha=${sha}
export PATH='${posix(bin)}':$PATH
compose() {
  printf '%s\\n' "$*" >> '${posix(join(directory, 'trace'))}'
  case "$*" in
    *pg_dump*) [[ "$FAILURE" != dump ]] || return 31; cat >/dev/null; printf 'PRIVATE_DUMP_SENTINEL';;
    *pg_restore*) cat >/dev/null; [[ "$FAILURE" != list ]] || return 32;;
  esac
}
compose=(compose)
openssl() {
  [[ "$FAILURE" != encrypt || "$1" != enc || "$2" == -d ]] || return 33
  [[ "$FAILURE" != decrypt || "$1" != enc || "$2" != -d ]] || return 34
  local args=() argument
  for argument in "$@"; do
    ${process.platform === 'win32' ? '[[ "$argument" != file:/* ]] || argument="file:$(cygpath -m "${argument#file:}")"' : ':'}
    args+=("$argument")
  done
  command openssl "\${args[@]}"
}
${checkpoint().replaceAll('/opt/qms2', posix(root))}
printf 'MIGRATED\\n' >> '${posix(join(directory, 'trace'))}'
`;
  const run = () => spawnSync(bash, ['-s'], { input: wrapper, env: { ...process.env, FAILURE: failure }, encoding: 'utf8', timeout: 30000 });
  return { root, directory, run };
}

test('successful checkpoint leaves encrypted snapshots and separate keys, never plaintext/log contents', async (context) => {
  const current = await fixture(context);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = current.run();
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_DUMP_SENTINEL|BEGIN.*KEY/);
  }
  const snapshots = await readdir(join(current.root, 'migration-backups-v1', sha));
  assert.equal(snapshots.length, 2, 'same-SHA retries preserve earlier snapshots');
  for (const snapshot of snapshots) {
    const files = await readdir(join(current.root, 'migration-backups-v1', sha, snapshot));
    assert.deepEqual(files.sort(), ['database.dump.enc', 'database.sha256']);
    const encrypted = await readFile(join(current.root, 'migration-backups-v1', sha, snapshot, 'database.dump.enc'));
    assert.equal(encrypted.subarray(0, 8).toString(), 'Salted__');
    assert.ok(!encrypted.includes(Buffer.from('PRIVATE_DUMP_SENTINEL')));
  }
  assert.equal((await readdir(join(current.root, 'migration-backup-keys-v1'))).length, 2);
  assert.match(await readFile(join(current.directory, 'trace'), 'utf8'), /MIGRATED/);
});

for (const failure of ['dump', 'list', 'encrypt', 'decrypt']) {
  test(`${failure} failure blocks migration and cleans its plaintext`, async (context) => {
    const current = await fixture(context, failure);
    const result = current.run();
    assert.notEqual(result.status, 0);
    const trace = await readFile(join(current.directory, 'trace'), 'utf8');
    assert.doesNotMatch(trace, /MIGRATED/);
    const snapshots = await readdir(join(current.root, 'migration-backups-v1', sha));
    for (const snapshot of snapshots) {
      const files = await readdir(join(current.root, 'migration-backups-v1', sha, snapshot));
      assert.ok(!files.includes('database.dump') && !files.includes('database.verify.dump'));
    }
    assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_DUMP_SENTINEL/);
  });
}
