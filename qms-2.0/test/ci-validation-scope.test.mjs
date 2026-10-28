import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const script = join(root, 'scripts/ci-validation-scope.mjs');
const foundation = await readFile(join(root, '../.github/workflows/qms-2-foundation.yml'), 'utf8');
const deploy = await readFile(join(root, '../.github/workflows/qms-2-deploy.yml'), 'utf8');
const policy = JSON.parse(await readFile(join(root, 'governance/validation-impact.json'), 'utf8'));
const ci = existsSync(script) ? await import(pathToFileURL(script).href) : {};
const sha = 'a'.repeat(40);
const source = { headSha: sha, runId: '123', runAttempt: '2' };
const businessNames = ['web-tests (1)', 'web-tests (2)', 'web-tests (3)', 'web-tests (4)', 'api-unit', 'integration'];
const jobsFor = (conclusion = 'success') => ['scope', 'checks', 'foundation', ...(conclusion === 'skipped' ? ['web-tests', 'api-unit', 'integration'] : businessNames)].map((name, index) => ({
  id: 100 + index,
  name, status: 'completed', conclusion: ['scope', 'checks', 'foundation'].includes(name) ? 'success' : conclusion,
  head_sha: sha, run_id: 123, run_attempt: 2,
}));
const businessIds = ['web-tests', 'api-unit', 'integration'];
const needsFor = (result = 'success') => ({ scope: 'success', checks: 'success', ...Object.fromEntries(businessIds.map((name) => [name, result])) });

async function repository(context) {
  const cwd = await mkdtemp(join(tmpdir(), 'qms-ci-scope-'));
  context.after(() => rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--quiet');
  git('config', 'core.autocrlf', 'false');
  async function commit(path, content = path) {
    await mkdir(resolve(cwd, path, '..'), { recursive: true });
    await writeFile(join(cwd, path), content);
    git('add', '.');
    git('-c', 'user.name=CI Test', '-c', 'user.email=ci@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
    return git('rev-parse', 'HEAD');
  }
  const base = await commit('README.md', 'base');
  const scope = (before, after, eventName = 'push') => ci.classifyScope({ cwd, policy, eventName,
    event: eventName === 'pull_request' ? { pull_request: { base: { sha: before }, head: { sha: after } } } : { before, after },
  });
  return { cwd, git, commit, base, scope };
}

test('CI scope implementation exists', () => assert.ok(existsSync(script), 'missing scope/gate/deploy implementation'));

test('documentation uses the existing whitelist AND .md; empty and unknown paths stay full', () => {
  for (const path of ['README.md', 'AGENTS.md', 'docs/superpowers/specs/a.md', 'qms-2.0/docs/说明.md', 'qms-2.0/.agents/skills/a/SKILL.md']) {
    assert.equal(ci.classifyPaths([path], policy), 'documentation', path);
  }
  for (const paths of [[], ['unknown.md'], ['qms-2.0/docs/run.mjs'], ['qms-2.0/.agents/skills/a/run.ps1'], ['README.md', 'qms-2.0/apps/api/src/a.ts']]) {
    assert.equal(ci.classifyPaths(paths, policy), 'full', JSON.stringify(paths));
  }
  const changedPolicy = structuredClone(policy);
  changedPolicy.rules.find(({ id }) => id === 'documentation').files.push('new-guide.md');
  assert.equal(ci.classifyPaths(['new-guide.md'], changedPolicy), 'documentation');
});

test('real Git: documentation, mixed changes, deletions and unusual names', async (context) => {
  const repo = await repository(context);
  const docs = await repo.commit('qms-2.0/docs/带 空格.md');
  assert.equal(repo.scope(repo.base, docs), 'documentation');
  const business = await repo.commit('qms-2.0/apps/api/src/a.ts');
  assert.equal(repo.scope(docs, business), 'full');
  await rm(join(repo.cwd, 'qms-2.0/apps/api/src/a.ts'));
  const deleted = await repo.commit('qms-2.0/docs/another.md');
  assert.equal(repo.scope(business, deleted), 'full');
  if (process.platform !== 'win32') {
    const newline = await repo.commit('qms-2.0/docs/name\nwith-newline.md');
    assert.equal(repo.scope(deleted, newline), 'documentation');
  }
});

test('real Git: renaming code into documentation checks both old and new paths', async (context) => {
  const repo = await repository(context);
  const before = await repo.commit('qms-2.0/apps/api/src/old.md');
  await mkdir(join(repo.cwd, 'qms-2.0/docs'), { recursive: true });
  await rename(join(repo.cwd, 'qms-2.0/apps/api/src/old.md'), join(repo.cwd, 'qms-2.0/docs/new.md'));
  const after = await repo.commit('README.md', 'renamed');
  assert.equal(repo.scope(before, after), 'full');
  const next = await repo.commit('qms-2.0/docs/old.md');
  await rename(join(repo.cwd, 'qms-2.0/docs/old.md'), join(repo.cwd, 'qms-2.0/docs/newer.md'));
  assert.equal(repo.scope(next, await repo.commit('README.md', 'docs rename')), 'documentation');
});

test('real Git: multi-commit push and business PR followed by docs remain full', async (context) => {
  const repo = await repository(context);
  const business = await repo.commit('qms-2.0/apps/api/src/a.ts');
  const head = await repo.commit('qms-2.0/docs/last.md');
  assert.equal(repo.scope(repo.base, head), 'full');
  assert.equal(repo.scope(repo.base, head, 'pull_request'), 'full');
  assert.equal(repo.scope(business, head), 'documentation');
  // A PR compares from the merge base; unrelated base-branch code is not part of this PR.
  repo.git('checkout', '--quiet', '-b', 'base-side', repo.base);
  const baseHead = await repo.commit('qms-2.0/apps/web/base-only.ts');
  repo.git('checkout', '--quiet', '-b', 'docs-side', repo.base);
  const docsHead = await repo.commit('qms-2.0/docs/pr.md');
  assert.equal(repo.scope(baseHead, docsHead, 'pull_request'), 'documentation');
});

test('real Git: empty diff, invalid SHA, missing history, unknown event and comparison failure stay full', async (context) => {
  const repo = await repository(context);
  const head = await repo.commit('qms-2.0/docs/a.md');
  for (const before of [repo.base, '', '0'.repeat(40), 'f'.repeat(40), '--output=escape', 'HEAD~1']) {
    assert.equal(repo.scope(before, head), before === repo.base ? 'documentation' : 'full');
  }
  assert.equal(repo.scope(head, head), 'full');
  assert.equal(repo.scope(repo.base, head, 'workflow_dispatch'), 'full');
  assert.equal(ci.classifyScope({ cwd: join(repo.cwd, 'absent'), policy, eventName: 'push', event: { before: repo.base, after: head } }), 'full');
  const shallow = join(repo.cwd, 'shallow');
  repo.git('clone', '--quiet', '--depth=1', new URL(`file:///${repo.cwd.replaceAll('\\', '/').replace(/^\//, '')}`).href, shallow);
  assert.equal(ci.classifyScope({ cwd: shallow, policy, eventName: 'push', event: { before: repo.base, after: head } }), 'full');
});

test('foundation gate only accepts full success or explicitly planned documentation skips', () => {
  assert.equal(ci.evaluateFoundation('full', needsFor()), 'full');
  assert.equal(ci.evaluateFoundation('documentation', needsFor('skipped')), 'documentation');
  for (const scope of ['', undefined, 'docs', 'other']) assert.throws(() => ci.evaluateFoundation(scope, needsFor()));
  for (const scope of ['full', 'documentation']) {
    const expected = scope === 'full' ? 'success' : 'skipped';
    for (const name of Object.keys(needsFor())) {
      for (const result of ['failure', 'cancelled', undefined, '']) {
        assert.throws(() => ci.evaluateFoundation(scope, { ...needsFor(expected), [name]: result }), `${scope}/${name}/${result}`);
      }
    }
    for (const name of businessIds) {
      assert.throws(() => ci.evaluateFoundation(scope, { ...needsFor(expected), [name]: expected === 'success' ? 'skipped' : 'success' }));
    }
  }
});

test('deploy gate requires unique complete successful jobs from the exact source run, attempt and SHA', () => {
  assert.equal(ci.evaluateDeployJobs(jobsFor(), source), 'full');
  assert.equal(ci.evaluateDeployJobs(jobsFor('skipped'), source), 'documentation');
  for (const name of jobsFor().map((job) => job.name)) {
    assert.throws(() => ci.evaluateDeployJobs(jobsFor().filter((job) => job.name !== name), source), name);
    assert.throws(() => ci.evaluateDeployJobs([...jobsFor(), jobsFor().find((job) => job.name === name)], source), name);
    for (const conclusion of ['failure', 'cancelled', 'neutral', null]) {
      assert.throws(() => ci.evaluateDeployJobs(jobsFor().map((job) => job.name === name ? { ...job, conclusion } : job), source));
    }
    for (const altered of [{ head_sha: 'b'.repeat(40) }, { run_id: 122 }, { run_attempt: 1 }, { status: 'in_progress' }]) {
      assert.throws(() => ci.evaluateDeployJobs(jobsFor().map((job) => job.name === name ? { ...job, ...altered } : job), source));
    }
  }
  assert.throws(() => ci.evaluateDeployJobs(jobsFor('skipped').map((job) => job.name === 'api-unit' ? { ...job, conclusion: 'success' } : job), source));
  assert.throws(() => ci.evaluateDeployJobs(jobsFor('skipped').map((job) => job.name === 'scope' ? { ...job, conclusion: 'skipped' } : job), source));
  for (const job of jobsFor('skipped')) {
    assert.throws(() => ci.evaluateDeployJobs(jobsFor('skipped').filter(({ name }) => name !== job.name), source));
    assert.throws(() => ci.evaluateDeployJobs([...jobsFor('skipped'), job], source));
    assert.throws(() => ci.evaluateDeployJobs(jobsFor('skipped').map((item) => item.name === job.name ? { ...item, conclusion: 'cancelled' } : item), source));
  }
  for (const name of ['web-tests (not-required)', 'web-tests ()', "web-tests (${{ matrix.shard || 'not-required' }})", 'web-tests (${{ matrix.shard }})', 'web-tests (1)']) {
    assert.throws(() => ci.evaluateDeployJobs(jobsFor('skipped').map((job) => job.name === 'web-tests' ? { ...job, name } : job), source));
  }
  assert.throws(() => ci.evaluateDeployJobs(jobsFor().map((job) => businessNames.includes(job.name) ? { ...job, conclusion: 'skipped' } : job), source));
  assert.throws(() => ci.evaluateDeployJobs(jobsFor('skipped').map((job) => job.name === 'web-tests' ? { ...job, conclusion: 'success' } : job), source));
  assert.throws(() => ci.evaluateDeployJobs([...jobsFor('skipped'), { ...jobsFor()[3], id: 999 }], source));
  assert.throws(() => ci.evaluateDeployJobs([], source));
  assert.throws(() => ci.evaluateDeployJobs([...jobsFor(), { ...jobsFor()[0], id: 999, name: 'unrecognized' }], source));
});

test('Actions HTTP boundary paginates only the specified attempt, and rejects API/malformed/truncated responses', async (context) => {
  let handler;
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    assert.equal(request.headers.authorization, 'Bearer test-token');
    handler(request, response);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  context.after(() => new Promise((done) => server.close(done)));
  const apiUrl = `http://127.0.0.1:${server.address().port}`;
  const options = { ...source, repository: 'owner/repo', token: 'test-token', apiUrl };
  handler = (request, response) => {
    const page = Number(new URL(request.url, apiUrl).searchParams.get('page'));
    response.setHeader('content-type', 'application/json');
    if (page === 1) response.setHeader('link', `<${apiUrl}/repos/owner/repo/actions/runs/123/attempts/2/jobs?per_page=100&page=2>; rel="next"`);
    response.end(JSON.stringify({ total_count: 9, jobs: page === 1 ? jobsFor().slice(0, 3) : jobsFor().slice(3) }));
  };
  assert.equal(ci.evaluateDeployJobs(await ci.fetchAttemptJobs(options), source), 'full');
  assert.deepEqual(requests, [1, 2].map((page) => `/repos/owner/repo/actions/runs/123/attempts/2/jobs?per_page=100&page=${page}`));
  for (const respond of [
    (request, response) => { response.writeHead(403); response.end('denied'); },
    (request, response) => response.end('not JSON'),
    (request, response) => response.end(JSON.stringify({ total_count: 9, jobs: jobsFor().slice(0, 2) })),
    (request, response) => response.end(JSON.stringify({ jobs: jobsFor() })),
    (request, response) => { response.setHeader('link', '<https://other.invalid/steal>; rel="next"'); response.end(JSON.stringify({ total_count: 9, jobs: jobsFor().slice(0, 2) })); },
  ]) {
    handler = respond;
    await assert.rejects(() => ci.fetchAttemptJobs(options));
  }
  for (const altered of [{ runId: '../latest' }, { runAttempt: '0' }, { headSha: '' }, { repository: '../other' }, { token: '' }]) {
    await assert.rejects(() => ci.fetchAttemptJobs({ ...options, ...altered }));
  }
});

const jobBlock = (workflow, name) => workflow.match(new RegExp(`^  ${name}:\\r?\\n([\\s\\S]*?)(?=^  [a-z][a-z-]*:|$(?![\\s\\S]))`, 'm'))?.[1];

test('workflow wiring preserves full business coverage, unconditional safety checks and stable fail-closed aggregation', () => {
  const scope = jobBlock(foundation, 'scope');
  assert.ok(scope, 'scope job must exist');
  assert.match(scope, /fetch-depth: 0/);
  assert.match(scope, /GITHUB_EVENT_PATH|ci-validation-scope\.mjs scope/);
  const checks = jobBlock(foundation, 'checks');
  assert.match(checks, /needs:.*scope/);
  for (const command of ['check:archive-isolation', 'check:governance', 'test/ci-validation-scope.test.mjs', 'test:governance', 'contracts:check', 'test/\*.test.mjs', '@qms/contracts test']) {
    assert.ok(checks.includes(command.replace('\\', '')), command);
  }
  for (const name of businessIds) {
    const job = jobBlock(foundation, name);
    assert.match(job, /needs:.*scope/);
    assert.match(job, /if:.*needs\.scope\.outputs\.scope == 'full'/);
  }
  const web = jobBlock(foundation, 'web-tests');
  // Early-skipped matrix job names keep expressions unevaluated; use the default job name.
  assert.doesNotMatch(web, /^    name:/m);
  assert.match(web, /shard: \[1, 2, 3, 4\]/);
  assert.match(web, /--shard=\$\{\{ matrix.shard \}\}\/4 --maxWorkers=1/);
  assert.doesNotMatch(web, /continue-on-error:/);
  assert.match(checks, /name: CI scope and result gate tests\r?\n\s+if: needs.scope.outputs.scope == 'documentation'\r?\n\s+run: node --test test\/ci-validation-scope.test.mjs/);
  const integration = jobBlock(foundation, 'integration');
  for (const retained of ['pnpm --recursive build', 'test:integration', 'test:worker-process:built', 'postgres:18', 'rustfs/rustfs:1.0.0', 'clamav/clamav@sha256:', 'prepare-ci-object-storage.mjs', 'SMTP_PORT=51026', 'docker compose -f deployment/docker-compose.foundation.yml config --quiet', 'Destroy ephemeral integration services']) assert.ok(integration.includes(retained), retained);
  assert.match(integration, /for shard in 1 2 3 4/);
  assert.match(integration, /test:integration --shard="\$shard\/4"/);
  assert.equal((integration.match(/pnpm --recursive build/g) ?? []).length, 1);
  assert.doesNotMatch(integration, /test:worker-process\s*$/m);
  const aggregate = jobBlock(foundation, 'foundation');
  assert.match(aggregate, /needs: \[scope, checks, web-tests, api-unit, integration\]/);
  assert.match(aggregate, /if: always\(\)/);
  assert.match(aggregate, /ci-validation-scope\.mjs gate/);
  assert.match(aggregate, /toJSON\(needs\)/);
});

test('standalone CI Worker lifecycle uses a fresh migrated and seeded database after the original integration shards', () => {
  const integration = jobBlock(foundation, 'integration');
  const step = (name) => integration.match(new RegExp(`^      - name: ${name}\\r?\\n([\\s\\S]*?)(?=^      - |$(?![\\s\\S]))`, 'm'))?.[1];
  const shards = step('Real PostgreSQL integration tests');
  const worker = step('Real worker process lifecycle');
  assert.ok(shards && worker, 'both real database test steps must exist');
  assert.match(integration, /-e POSTGRES_DB=qms2/);
  assert.match(integration, /DATABASE_URL="postgresql:\/\/qms:\$POSTGRES_PASSWORD@127\.0\.0\.1:\$PG_PORT\/qms2"/);
  assert.match(shards, /for shard in 1 2 3 4; do\s+pnpm --filter @qms\/api test:integration --shard="\$shard\/4"\s+done/);
  assert.doesNotMatch(shards, /DATABASE_URL|qms_worker_lifecycle|GITHUB_ENV/);
  assert.match(worker, /^        env:\r?\n          NODE_ENV: development\r?\n        run: \|\r?\n          set -euo pipefail\r?\n/);
  const ordered = [
    'docker exec "$PG_CONTAINER" psql -U qms -d qms2 -v ON_ERROR_STOP=1 -c \'CREATE DATABASE qms_worker_lifecycle\'',
    'WORKER_DATABASE_URL=$(node -e \'const url = new URL(process.env.DATABASE_URL); url.pathname = "/qms_worker_lifecycle"; process.stdout.write(url.href);\')',
    'echo "::add-mask::$WORKER_DATABASE_URL"',
    'export DATABASE_URL="$WORKER_DATABASE_URL"',
    'pnpm --filter @qms/api db:migrate:deploy',
    'pnpm --filter @qms/api db:seed',
    'pnpm --filter @qms/api test:worker-process:built',
  ];
  let previous = -1;
  for (const command of ordered) {
    const index = worker.indexOf(command);
    assert.ok(index > previous, `Worker step must execute in order: ${command}`);
    previous = index;
  }
  assert.doesNotMatch(worker, /GITHUB_ENV|docker run|DROP|TRUNCATE|DELETE|continue-on-error|\|\| true/);
  assert.ok(integration.indexOf('name: Real PostgreSQL integration tests') < integration.indexOf('name: Real worker process lifecycle'));
  assert.ok(integration.indexOf('name: Real worker process lifecycle') < integration.indexOf('name: Validate foundation Compose'));
});

test('deploy workflow checks the source attempt before SSH and preserves repository/main/push restrictions', () => {
  for (const guard of ["workflow_run.event == 'push'", "workflow_run.head_branch == 'main'", 'workflow_run.head_repository.full_name == github.repository', "workflow_run.conclusion == 'success'"]) assert.ok(deploy.includes(guard), guard);
  assert.match(deploy, /actions: read/);
  assert.match(deploy, /RUN_ID: \$\{\{ github.event.workflow_run.id \}\}/);
  assert.match(deploy, /RUN_ATTEMPT: \$\{\{ github.event.workflow_run.run_attempt \}\}/);
  assert.match(deploy, /HEAD_SHA: \$\{\{ github.event.workflow_run.head_sha \}\}/);
  assert.ok(deploy.indexOf('ci-validation-scope.mjs deploy') < deploy.indexOf('Deploy validated commit over pinned SSH'));
  assert.match(deploy, /if:.*steps\.validation\.outputs\.scope == 'full'/);
  assert.match(deploy, /StrictHostKeyChecking=yes/);
  assert.match(deploy, /< qms-2.0\/deployment\/deploy.sh/);
  const runLines = deploy.split(/\r?\n/).filter((line) => line.trimStart().startsWith('run:'));
  assert.ok(runLines.every((line) => !line.includes('${{')), 'event values must reach Node through env, not shell interpolation');
});

test('serial integration shards cover every configured Jest file exactly once', () => {
  const args = ['--experimental-vm-modules', 'node_modules/jest/bin/jest.js', '--runInBand', '--listTests', '--json',
    '--testPathPatterns=integration-spec.ts', '--testPathIgnorePatterns=worker-process-schema.integration-spec.ts'];
  const list = (extra = []) => JSON.parse(execFileSync(process.execPath, [...args, ...extra], { cwd: join(root, 'apps/api'), encoding: 'utf8' }));
  const all = list();
  assert.ok(all.length > 0);
  const shards = [1, 2, 3, 4].flatMap((shard) => list([`--shard=${shard}/4`]));
  assert.equal(new Set(shards).size, shards.length);
  assert.deepEqual(shards.sort(), all.sort());
});

test('standalone Worker command still builds, while integration invokes only the built test', async () => {
  const { scripts } = JSON.parse(await readFile(join(root, 'apps/api/package.json'), 'utf8'));
  assert.match(scripts['test:worker-process'], /^pnpm build && pnpm test:worker-process:built$/);
  assert.match(scripts['test:worker-process:built'], /^node .*jest.*worker-process-schema\.integration-spec\.ts$/);
  assert.doesNotMatch(scripts['test:worker-process:built'], /pnpm|nest|prisma/);
});

test('gate CLI returns nonzero for missing/mixed results and emits only fixed output values', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'qms-ci-output-'));
  context.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  for (const scope of ['full', 'documentation']) {
    const output = join(directory, scope);
    const needs = Object.fromEntries(Object.entries(needsFor(scope === 'full' ? 'success' : 'skipped')).map(([name, result]) => [name, { result }]));
    const run = (values) => spawnSync(process.execPath, [script, 'gate'], { cwd: root, encoding: 'utf8', env: { ...process.env, SCOPE: scope, NEEDS_JSON: JSON.stringify(values), GITHUB_OUTPUT: output } });
    assert.equal(run(needs).status, 0);
    assert.equal(await readFile(output, 'utf8'), `scope=${scope}\n`);
    assert.notEqual(run({ ...needs, integration: { result: 'cancelled' } }).status, 0);
    assert.notEqual(run({}).status, 0);
    assert.equal(await readFile(output, 'utf8'), `scope=${scope}\n`, 'a failed gate must not write a permitting output');
  }
});
