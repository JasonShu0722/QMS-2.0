import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { sourceSnapshot, createOutputDirectory } from '../scripts/engineering-report.mjs';
import { createHandoff } from '../scripts/create-handoff.mjs';
import { runEvidence } from '../scripts/collect-evidence.mjs';

async function fixture(context) {
  const parent = await mkdtemp(join(tmpdir(), 'qms-engineering-'));
  context.after(() => rm(parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const repository = join(parent, 'repository');
  const root = join(repository, 'qms-2.0');
  await mkdir(join(root, 'governance'), { recursive: true });
  await mkdir(join(repository, 'docs/superpowers/plans'), { recursive: true });
  await writeFile(join(repository, 'AGENTS.md'), '# 根规则\n');
  await writeFile(join(repository, '.gitignore'), '.env\n');
  await writeFile(join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@11.19.0', engines: { node: '>=22.22.0 <23' } }));
  await writeFile(join(root, 'AGENTS.md'), '# 工程规则\n');
  await writeFile(join(root, 'source.ts'), 'export const value = 1;\n');
  await writeFile(join(root, 'governance/documentation-index.json'), JSON.stringify({ agents: [{ path: 'AGENTS.md', scope: '.' }], documents: [] }));
  await writeFile(join(root, 'governance/maintenance-items.json'), JSON.stringify({ version: 1, items: [{ id: 'MAINT-101', status: 'open', owner: '维护者', reviewDue: '2026-10-23', nextAction: '复核来源', sources: [{ path: 'source.ts' }] }] }));
  await writeFile(join(repository, 'docs/superpowers/plans/task.md'), '# 任务\n- [x] 已完成\n- [ ] 未完成\n');
  const git = (args) => execFileSync('git', args, { cwd: repository, stdio: 'pipe' });
  git(['init', '--quiet']);
  git(['add', '.']);
  git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture']);
  return { parent, repository, root, git };
}

test('源码指纹覆盖未提交与未跟踪内容，不记录环境值或读取忽略秘密', async (context) => {
  const current = await fixture(context);
  const before = await sourceSnapshot(current.root);
  await writeFile(join(current.root, '.env'), 'PRIVATE_SENTINEL=never-copy');
  assert.equal((await sourceSnapshot(current.root)).fingerprint, before.fingerprint);
  await writeFile(join(current.root, 'new.ts'), 'export const added = 1;');
  const after = await sourceSnapshot(current.root);
  assert.notEqual(after.fingerprint, before.fingerprint);
  assert.ok(after.changedFiles.includes('qms-2.0/new.ts'));
  assert.ok(!JSON.stringify(after).includes('PRIVATE_SENTINEL'));
  await writeFile(join(current.root, 'new.ts'), 'export const added = 2;');
  assert.notEqual((await sourceSnapshot(current.root)).fingerprint, after.fingerprint);
});

test('拒绝仓库内输出及覆盖已有证据', async (context) => {
  const current = await fixture(context);
  await assert.rejects(createOutputDirectory(current.root, join(current.repository, 'report')), /Git 外/);
  const output = join(current.parent, 'report');
  await createOutputDirectory(current.root, output);
  await assert.rejects(createOutputDirectory(current.root, output), /存在|EEXIST/);
  const link = join(current.parent, 'linked-repository');
  await symlink(current.repository, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(createOutputDirectory(current.root, join(link, 'report')), /Git 外/);
});

test('受控生成契约和删除纳入指纹，误跟踪的环境文件排除且不能 PASS', async (context) => {
  const current = await fixture(context);
  await mkdir(join(current.root, 'packages/contracts/src/generated'), { recursive: true });
  await writeFile(join(current.root, 'packages/contracts/src/generated/api.ts'), 'export type Contract = string;');
  await rm(join(current.root, 'source.ts'));
  const source = await sourceSnapshot(current.root);
  assert.ok(source.files.some((entry) => entry.path === 'qms-2.0/packages/contracts/src/generated/api.ts' && entry.sha256));
  assert.equal(source.files.find((entry) => entry.path === 'qms-2.0/source.ts').sha256, null);
  await writeFile(join(current.root, '.env'), 'PRIVATE_SENTINEL=never-copy');
  current.git(['add', '-f', 'qms-2.0/.env']);
  const report = await runEvidence(current.root, { output: join(current.parent, 'excluded'), profile: 'test', runtime, quiet: true, steps: [step('不得执行', 'process.exit(0)')] });
  assert.equal(report.status, 'FAIL');
  assert.equal(report.sourceBefore.excludedCount, 1);
  assert.equal(report.steps[0].status, 'NOT_RUN');
  assert.ok(!JSON.stringify(report).includes('PRIVATE_SENTINEL'));
});

test('交接关联源码、上层规则、选择计划的未完成事项', async (context) => {
  const current = await fixture(context);
  const output = join(current.parent, 'handoff');
  const report = await createHandoff(current.root, { output, plan: '../docs/superpowers/plans/task.md' });
  assert.ok(report.rules.includes('../AGENTS.md'));
  assert.ok(report.rules.includes('AGENTS.md'));
  assert.equal(report.pending.length, 1);
  assert.deepEqual(report.maintenance.map((item) => item.id), []);
  assert.match(report.pending[0].text, /未完成/);
  assert.match(await readFile(join(output, 'handoff.md'), 'utf8'), /源码指纹/);
  assert.equal((JSON.parse(await readFile(join(output, 'handoff.json'), 'utf8'))).source.commit.length, 40);
});

test('交接改动来源时提示维护事项', async (context) => {
  const current = await fixture(context);
  await writeFile(join(current.root, 'source.ts'), 'export const value = 2;\n');
  const output = join(current.parent, 'linked-handoff');
  const report = await createHandoff(current.root, { output });
  assert.deepEqual(report.maintenance.map((item) => item.id), ['MAINT-101']);
  assert.match(await readFile(join(output, 'handoff.md'), 'utf8'), /MAINT-101/);
});

const step = (name, code) => ({ name, command: process.execPath, args: ['-e', code], display: name });
const runtime = { node: process.version, pnpm: '11.19.0' };

test('真实子进程失败后停止，剩余 NOT_RUN，不把输出中的秘密写入证据', async (context) => {
  const current = await fixture(context);
  const report = await runEvidence(current.root, {
    output: join(current.parent, 'failure'), profile: 'test', runtime, quiet: true,
    steps: [step('成功', 'process.exit(0)'), step('失败', 'console.error("PRIVATE_SENTINEL"); process.exit(7)'), step('不得执行', 'process.exit(0)')],
  });
  assert.equal(report.status, 'FAIL');
  assert.deepEqual(report.steps.map((entry) => entry.status), ['PASS', 'FAIL', 'NOT_RUN']);
  assert.equal(report.steps[1].exitCode, 7);
  assert.ok(!JSON.stringify(report).includes('PRIVATE_SENTINEL'));
});

test('全部成功才能 PASS，执行期间源码变化使证据失败', async (context) => {
  const current = await fixture(context);
  const pass = await runEvidence(current.root, { output: join(current.parent, 'pass'), profile: 'test', runtime, quiet: true, steps: [step('成功', 'process.exit(0)')] });
  assert.equal(pass.status, 'PASS');
  const changed = await runEvidence(current.root, {
    output: join(current.parent, 'changed'), profile: 'test', runtime, quiet: true,
    steps: [step('修改', 'require("node:fs").writeFileSync("source.ts", "changed")')],
  });
  assert.equal(changed.status, 'FAIL');
  assert.equal(changed.sourceUnchanged, false);
});

test('进程启动失败和前置失败保留失败报告', async (context) => {
  const current = await fixture(context);
  const failed = await runEvidence(current.root, {
    output: join(current.parent, 'spawn'), profile: 'test', runtime, quiet: true,
    steps: [{ name: '不存在', command: join(current.parent, 'missing-executable'), args: [], display: '不存在' }],
  });
  assert.equal(failed.status, 'FAIL');
  assert.equal(failed.steps[0].exitCode, null);
  const prerequisite = await runEvidence(current.root, {
    output: join(current.parent, 'prerequisite'), profile: 'test', runtime: null, quiet: true,
    steps: [step('不得执行', 'process.exit(0)')],
  });
  assert.equal(prerequisite.status, 'FAIL');
  assert.equal(prerequisite.steps[0].status, 'NOT_RUN');
});
