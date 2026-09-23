import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { branchChangedPaths, recommendForPaths, validateImpactPolicy } from '../scripts/recommend-validation.mjs';

const root = resolve(import.meta.dirname, '..');
const policy = JSON.parse(await readFile(resolve(root, 'governance/validation-impact.json'), 'utf8'));
const index = JSON.parse(await readFile(resolve(root, 'governance/documentation-index.json'), 'utf8'));
const maintenance = JSON.parse(await readFile(resolve(root, 'governance/maintenance-items.json'), 'utf8'));

test('规则清单引用真实文档、现有命令且无重复 ID', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  assert.doesNotThrow(() => validateImpactPolicy(policy, index, manifest, root));
  const changed = structuredClone(policy);
  changed.commands['api-integration'].command = 'corepack pnpm --filter @qms/api test';
  assert.throws(() => validateImpactPolicy(changed, index, manifest, root), /命令与脚本不一致/);
});

test('文档来源变化反向推荐受影响权威文档', () => {
  const result = recommendForPaths(['qms-2.0/scripts/check-documentation.mjs'], policy, index);
  assert.ok(result.documents.includes('docs/DOCUMENTATION-MAINTENANCE.md'));
  assert.ok(result.commandIds.includes('governance'));
  assert.deepEqual(result.unknownPaths, []);
});

test('改动来源文件时带出关联开放维护事项', () => {
  const result = recommendForPaths(['qms-2.0/apps/web/src/features/account/AccountCenterPage.tsx'], policy, index, maintenance);
  assert.deepEqual(result.maintenance.map((item) => item.id), ['MAINT-001']);
  assert.deepEqual(result.maintenance[0].matchedPaths, ['apps/web/src/features/account/AccountCenterPage.tsx']);
  const unrelated = recommendForPaths(['qms-2.0/apps/web/src/features/account/OtherPage.tsx'], policy, index, maintenance);
  assert.deepEqual(unrelated.maintenance, []);
});

test('权限和迁移改动扩大为真实集成、契约与阶段验证', () => {
  const result = recommendForPaths([
    'qms-2.0/apps/api/src/modules/authorization/authorization.service.ts',
    'qms-2.0/apps/api/prisma/migrations/20260923000000_change/migration.sql',
  ], policy, index);
  for (const id of ['api-integration', 'contracts', 'phase-1', 'phase-2']) assert.ok(result.commandIds.includes(id), id);
  assert.ok(result.documents.includes('docs/PLATFORM-HANDOFF.md'));
  assert.ok(result.documents.includes('docs/DATA-PROTECTION.md'));
  assert.deepEqual(result.unknownPaths, []);
});

test('流程与 Web 改动合并推荐，命令去重', () => {
  const result = recommendForPaths([
    'qms-2.0/apps/api/src/modules/workflow/workflow-runtime.service.ts',
    'qms-2.0/apps/web/src/features/workflows/workflow-designer.tsx',
  ], policy, index);
  assert.ok(result.commandIds.includes('api-integration'));
  assert.ok(result.commandIds.includes('web-unit'));
  assert.ok(result.commandIds.includes('phase-2'));
  assert.equal(new Set(result.commandIds).size, result.commandIds.length);
});

test('备份工具变更需真实集成与阶段门禁', () => {
  const result = recommendForPaths(['qms-2.0/apps/api/scripts/data-protection.mjs'], policy, index);
  assert.ok(result.ruleIds.includes('data-protection'));
  for (const id of ['api-integration', 'phase-1', 'phase-2']) assert.ok(result.commandIds.includes(id));
  assert.ok(result.documents.includes('docs/DATA-PROTECTION.md'));
});

test('未知或空改动保守兜底，不能解释为无需验证', () => {
  const unknown = recommendForPaths(['qms-2.0/future-area/new.ts'], policy, index);
  assert.deepEqual(unknown.unknownPaths, ['qms-2.0/future-area/new.ts']);
  for (const id of ['test', 'build', 'phase-1', 'phase-2']) assert.ok(unknown.commandIds.includes(id));
  assert.equal(unknown.needsManualReview, true);
  const empty = recommendForPaths([], policy, index);
  assert.equal(empty.needsManualReview, true);
  assert.ok(empty.commandIds.includes('test'));
});

test('指定基线时识别提交新增、删除，不读取文件内容', async (context) => {
  const repository = await mkdtemp(join(tmpdir(), 'qms-impact-'));
  context.after(() => rm(repository, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  await mkdir(join(repository, 'qms-2.0'), { recursive: true });
  await writeFile(join(repository, 'qms-2.0/old.ts'), 'PRIVATE_SENTINEL');
  const git = (args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
  git(['init', '--quiet']);
  git(['add', '.']);
  git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'first']);
  const base = git(['rev-parse', 'HEAD']);
  await rm(join(repository, 'qms-2.0/old.ts'));
  await writeFile(join(repository, 'qms-2.0/new.ts'), 'export const value = 2;');
  git(['add', '.']);
  git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'second']);
  const paths = branchChangedPaths(repository, base);
  assert.deepEqual(paths, ['qms-2.0/new.ts', 'qms-2.0/old.ts']);
  assert.ok(!JSON.stringify(paths).includes('PRIVATE_SENTINEL'));
  assert.throws(() => branchChangedPaths(repository, '--output=/tmp/escape'), /基线/);
});
