import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';

const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const posix = (path) => path.replaceAll('\\', '/').replace(/^([a-z]):/i, (_, drive) => `/${drive.toLowerCase()}`);
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const helper = new URL('../deployment/deploy-cleanup.sh', import.meta.url);
const sha = (number) => number.toString(16).padStart(40, '0');
const imageId = (number) => `sha256:${number.toString(16).padStart(64, '0')}`;
const image = (service, number, id = number, index = number, repository = `qms2-foundation-${service}`) =>
  `${repository}|${sha(number)}|${imageId(id)}|2024-01-${String(index).padStart(2, '0')} 00:00:00 +0000 UTC`;
const tag = (service, number) => `qms2-foundation-${service}:${sha(number)}`;
const keyCanary = 'aB9/'.repeat(16);

async function fixture(context, { images = [], containers = [] } = {}) {
  assert.ok(existsSync(helper), 'deployment cleanup helper must exist');
  const directory = await mkdtemp(join(tmpdir(), 'qms-retention-'));
  context.after(async () => {
    const resolved = await realpath(directory);
    assert.equal(dirname(resolved), await realpath(tmpdir()));
    assert.match(basename(resolved), /^qms-retention-[a-zA-Z0-9]+$/);
    await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const root = await realpath(directory);
  const trace = join(root, 'trace');
  const source = (await readFile(helper, 'utf8')).replaceAll('\r', '').replaceAll('/opt/qms2', posix(root));
  const snapshots = join(root, 'migration-backups-v1');
  const keys = join(root, 'migration-backup-keys-v1');
  await mkdir(snapshots, { mode: 0o700 });
  await mkdir(keys, { mode: 0o700 });
  await writeFile(join(root, 'deployed-sha'), `${sha(1)}\n`);
  const run = async ({ args = [], dry = '0', dedicated = '0', fault = '', inherited = false } = {}) => {
    await writeFile(trace, '');
    const wrapper = `
trace=${quote(posix(trace))}
root=${quote(posix(root))}
record() { printf '%s\n' "$*" >> "$trace"; }
id() { [[ "$*" == -u ]] && printf '0\n'; }
stat() {
  case "$1 $2" in
    '-c %u') printf '0\n';;
    '-c %a') if [[ -d "\${!#}" ]]; then printf '700\n'; else printf '600\n'; fi;;
    *) command stat "$@";;
  esac
}
flock() {
  record "flock $*"
  [[ "$FAULT" != lock ]] || return 1
  ${process.platform === 'win32' ? ': >&9' : 'command flock "$@"'}
}
docker() {
  record "docker $*"
  case "$*" in
    'info --format '*DockerRootDir*) printf '%s\n' "$root";;
    'container ls '*--all*--quiet*--no-trunc*)
      ${containers.map((_, index) => `printf '%s\n' ${quote(imageId(index + 100).slice(7))}`).join('\n      ') || ':'} ;;
    'container inspect '*'.Image'*'.Config.Image'*)
      [[ "$FAULT" != inspect ]] || return 31
      ${containers.map((line) => `printf '%s\n' ${quote(line)}`).join('\n      ') || ':'} ;;
    'image ls '*'.CreatedAt'*)
      ${images.map((line) => `printf '%s\n' ${quote(line)}`).join('\n      ') || ':'} ;;
    'image rm --no-prune qms2-foundation-'*) [[ "$FAULT" != image ]];;
    'context show') if [[ "$FAULT" == context ]]; then printf 'alternate\n'; else printf 'default\n'; fi;;
    'context inspect default '*'.Endpoints.docker.Host'*) printf 'unix:///var/run/docker.sock\n';;
    'buildx inspect default')
      if [[ "$FAULT" == builder ]]; then printf 'Name: default\nDriver: docker-container\n';
      else printf 'Name: default\nDriver: docker\nNodes:\nName: default\nEndpoint: default\nStatus: running\nDevices:\n Name: example/gpu\n'; fi;;
    '--context default builder prune --builder default --force'|'--context alternate builder prune --builder alternate --force'|'--context default buildx prune --builder default --all --force') :;;
    *) printf 'Unexpected Docker operation\n' >&2; return 66;;
  esac
}
rm() {
  record "rm $*"
  [[ "$FAULT" != snapshot || "$*" != *database.dump.enc* ]] || return 32
  command rm "$@"
}
${inherited ? 'exec 9<>"$root/deploy.lock"\nflock -n 9' : ''}
set -- ${args.map(quote).join(' ')}
${source}
`;
    const result = spawnSync(bash, ['-s'], {
      input: wrapper,
      env: { ...process.env, BUILDX_BUILDER: '', DOCKER_HOST: '', DOCKER_CONTEXT: '', DRY_RUN: dry, QMS_DEDICATED_BUILDER: dedicated, FAULT: fault },
      encoding: 'utf8', timeout: 30000,
    });
    assert.ifError(result.error);
    return { ...result, calls: (await readFile(trace, 'utf8')).trim().split('\n'), output: result.stdout + result.stderr };
  };
  const snapshot = async (number, suffix, days, { partial, unknown, orphan, unsafeOwner } = {}) => {
    const name = `snapshot.${suffix}`;
    const parent = join(snapshots, sha(number));
    const leaf = join(parent, name);
    const key = join(keys, `${sha(number)}.${name}.key`);
    const stamp = new Date(Date.now() - days * 86400000);
    const file = async (path, content) => {
      await writeFile(path, content, { mode: 0o600 });
      await utimes(path, stamp, stamp);
    };
    await file(key, `${keyCanary}\n`);
    if (orphan) return { leaf, key };
    await mkdir(parent, { mode: 0o700, recursive: true });
    await mkdir(leaf, { mode: 0o700 });
    await file(join(leaf, 'database.dump.enc'), `Salted__${'x'.repeat(24)}`);
    if (!partial) await file(join(leaf, 'database.sha256'), `${'a'.repeat(64)}\n`);
    if (unknown) await file(join(leaf, 'PRIVATE_FILENAME_CANARY'), 'PRIVATE_CONTENT_CANARY');
    if (unsafeOwner) await symlink(key, join(leaf, 'PRIVATE_SYMLINK_CANARY'), 'file');
    await utimes(leaf, stamp, stamp);
    return { leaf, key };
  };
  return { run, snapshot };
}

test('preview takes deployment lock, prints disk readings and identifies candidates without mutations', async (context) => {
  const current = await fixture(context, { images: [image('api', 2)] });
  const expired = await current.snapshot(1, 'expired1', 16);
  await current.snapshot(2, 'latest01', 1);
  const result = await current.run({ dry: '1' });
  assert.equal(result.status, 0, result.output);
  assert.equal(result.calls[0], 'flock -w 600 9');
  assert.match(result.stdout, /Disk usage before cleanup/);
  assert.match(result.stdout, /Disk usage after cleanup/);
  assert.match(result.stdout, /Candidate image qms2-foundation-api:/);
  assert.match(result.stdout, /Candidate snapshot .*snapshot\.expired1/);
  assert.ok(existsSync(expired.leaf) && existsSync(expired.key));
  assert.ok(!result.calls.some((call) => /\b(?:rm|prune)\b/.test(call)));
});

test('actual mode requires authorization and refuses an unheld or unavailable deployment lock', async (context) => {
  const current = await fixture(context);
  for (const options of [{}, { args: ['--lock-held'] }, { dry: '1', fault: 'lock' }, { args: ['--apply'], fault: 'lock' }]) {
    const result = await current.run(options);
    assert.notEqual(result.status, 0, result.output);
    assert.ok(!result.calls.some((call) => call.startsWith('docker ')));
  }
});

test('the deploy entry point defaults to preview under the inherited lock', async (context) => {
  const current = await fixture(context, { images: [image('api', 2)] });
  const result = await current.run({ args: ['--lock-held'], inherited: true, dry: '' });
  assert.equal(result.status, 0, result.output);
  assert.equal(result.calls[0], 'flock -n 9');
  assert.match(result.stdout, /Disk usage after cleanup/);
  assert.ok(!result.calls.some((call) => /\b(?:rm|prune)\b/.test(call)));
});

test('preview and apply select the same old QMS tags and protect container IDs and the newest three complete histories', async (context) => {
  const images = [
    ...[1, 2, 3, 4, 5, 6, 7].flatMap((number) => [image('api', number), image('web', number, number + 40)]),
    image('api', 8, 80), image('api', 9, 90), image('api', 10, 100), image('api', 11, 110),
    image('api', 12, 120, 12, 'other/qms2-foundation-api'),
    image('web', 13).replace(sha(13), 'latest'),
    image('api', 14).replace(sha(14), `${sha(14)}x`),
  ];
  const current = await fixture(context, {
    images,
    containers: [`${imageId(80)}|${tag('api', 9)}`, `${imageId(100)}|other/stopped:old`],
  });
  const preview = await current.run({ args: ['--lock-held'], inherited: true, dry: '1' });
  const result = await current.run({ args: ['--lock-held'], inherited: true, dry: '0' });
  assert.equal(preview.status, 0, preview.output);
  assert.equal(result.status, 0, result.output);
  const removals = result.calls.filter((call) => call.startsWith('docker image rm ')).sort();
  assert.deepEqual(removals, [
    ...[2, 3, 4].flatMap((number) => [`docker image rm --no-prune ${tag('api', number)}`, `docker image rm --no-prune ${tag('web', number)}`]),
    `docker image rm --no-prune ${tag('api', 11)}`,
  ].sort());
  assert.deepEqual([...preview.stdout.matchAll(/^Candidate image (.*)$/gm)].map((match) => `docker image rm --no-prune ${match[1]}`).sort(), removals);
  assert.match(result.stdout, /Skip image .*container image ID/);
  assert.match(result.stdout, /Skip image .*runtime SHA/);
});

test('keeps the deterministic top three complete histories when creation timestamps tie', async (context) => {
  const images = [2, 5, 3, 4].flatMap((number) => [image('web', number, number + 40, 2), image('api', number, number, 2)]);
  const current = await fixture(context, { images });
  const result = await current.run({ args: ['--apply'] });
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(result.calls.filter((call) => call.startsWith('docker image rm ')).sort(), [
    `docker image rm --no-prune ${tag('api', 5)}`, `docker image rm --no-prune ${tag('web', 5)}`,
  ]);
});

test('refuses to delete images when container image inspection is incomplete', async (context) => {
  const current = await fixture(context, { images: [image('api', 2)], containers: [`${imageId(99)}|other/stopped:old`] });
  const result = await current.run({ args: ['--apply'], fault: 'inspect' });
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.stderr, /container.*inspect|inspect.*container/i);
  assert.ok(!result.calls.some((call) => call.startsWith('docker image rm ')));
});

test('removes only expired exact backup pairs and leaves the latest valid snapshot and anomalies', async (context) => {
  const current = await fixture(context);
  const expired = await current.snapshot(1, 'expired1', 20);
  const floor = await current.snapshot(1, 'latest01', 16);
  const partial = await current.snapshot(2, 'partial1', 1, { partial: true });
  const unknown = await current.snapshot(3, 'unknown1', 25, { unknown: true });
  const linked = await current.snapshot(4, 'symlink1', 30, { unsafeOwner: true });
  const orphan = await current.snapshot(5, 'orphan01', 25, { orphan: true });
  const result = await current.run({ args: ['--apply'] });
  assert.equal(result.status, 0, result.output);
  assert.ok(!existsSync(expired.leaf) && !existsSync(expired.key));
  for (const kept of [floor, partial, unknown, linked]) assert.ok(existsSync(kept.leaf) && existsSync(kept.key));
  assert.ok(existsSync(orphan.key));
  assert.match(result.stdout, /Skip snapshot .*latest valid/);
  assert.match(result.stderr, /Warning: .*snapshot.*partial1/i);
  assert.match(result.stderr, /Warning: .*orphan/i);
  assert.doesNotMatch(result.output, /PRIVATE_|aB9\//);
  const removals = result.calls.filter((call) => call.startsWith('rm '));
  assert.equal(removals.length, 2);
  assert.match(removals[0], /expired1.*database\.dump\.enc/);
  assert.match(removals[1], /expired1\.key$/);
});

test('preserves a key when snapshot deletion fails and still reports after-cleanup filesystem use', async (context) => {
  const current = await fixture(context);
  const expired = await current.snapshot(1, 'expired1', 20);
  const recent = await current.snapshot(2, 'latest01', 3);
  const result = await current.run({ args: ['--apply'], fault: 'snapshot' });
  assert.notEqual(result.status, 0, result.output);
  assert.ok(existsSync(expired.leaf) && existsSync(expired.key));
  assert.ok(existsSync(recent.leaf) && existsSync(recent.key));
  assert.match(result.stdout, /Skip snapshot .*latest valid/);
  assert.match(result.stdout, /Disk usage after cleanup/);
});

test('uses the existing prune unless full prune is opted in with confirmed default local builder scope', async (context) => {
  const current = await fixture(context);
  for (const [options, expected] of [
    [{}, 'docker --context default builder prune --builder default --force'],
    [{ dedicated: '1', fault: 'builder' }, 'docker --context default builder prune --builder default --force'],
    [{ dedicated: '1', fault: 'context' }, 'docker --context alternate builder prune --builder alternate --force'],
    [{ dedicated: '1' }, 'docker --context default buildx prune --builder default --all --force'],
  ]) {
    const result = await current.run({ args: ['--apply'], ...options });
    assert.equal(result.status, 0, result.output);
    assert.deepEqual(result.calls.filter((call) => /\bprune\b/.test(call)), [expected]);
  }
});
