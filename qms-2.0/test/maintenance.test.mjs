import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { sourceDigest } from '../scripts/check-documentation.mjs';
import { checkMaintenance } from '../scripts/check-maintenance.mjs';

async function fixture(context) {
  const root = await mkdtemp(join(tmpdir(), 'qms-maintenance-'));
  context.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  await mkdir(join(root, 'governance'));
  await mkdir(join(root, 'docs'));
  await writeFile(join(root, 'docs/source.md'), '# 来源\n', 'utf8');
  await writeFile(join(root, 'docs/evidence.md'), '# 关闭验证\n', 'utf8');
  const item = {
    id: 'MAINT-001', category: 'deprecation', status: 'open', owner: 'QMS 维护者',
    fact: '已观察到组件弃用提示', impact: '未来升级会受影响', trigger: '升级组件前处理', nextAction: '替换组件并回归',
    reviewedOn: '2026-09-23', reviewDue: '2026-10-23',
    sources: [{ path: 'docs/source.md', sha256: sourceDigest('# 来源\n') }],
  };
  const save = async (items) => writeFile(join(root, 'governance/maintenance-items.json'), JSON.stringify({ version: 1, items }), 'utf8');
  await save([item]);
  return { root, item, save };
}

test('开放事项有真实来源、未到期时通过', async (context) => {
  const current = await fixture(context);
  assert.deepEqual(await checkMaintenance(current.root, new Date('2026-09-24T00:00:00Z')), { open: 1, closed: 0 });
});

test('重复 ID、空触发条件和虚假开放关闭字段失败', async (context) => {
  const current = await fixture(context);
  await current.save([current.item, current.item]);
  await assert.rejects(checkMaintenance(current.root, new Date('2026-09-24T00:00:00Z')), /重复/);
  await current.save([{ ...current.item, trigger: '' }]);
  await assert.rejects(checkMaintenance(current.root, new Date('2026-09-24T00:00:00Z')), /trigger/);
  await current.save([{ ...current.item, closedOn: '2026-09-23' }]);
  await assert.rejects(checkMaintenance(current.root, new Date('2026-09-24T00:00:00Z')), /开放事项/);
});

test('来源变化、复核到期和未来复核日期失败', async (context) => {
  const current = await fixture(context);
  await writeFile(join(current.root, 'docs/source.md'), '# 已变化\n');
  await assert.rejects(checkMaintenance(current.root, new Date('2026-09-24T00:00:00Z')), /来源已变化/);
  await writeFile(join(current.root, 'docs/source.md'), '# 来源\n');
  await assert.rejects(checkMaintenance(current.root, new Date('2026-10-23T00:00:00Z')), /复核已到期/);
  await current.save([{ ...current.item, reviewedOn: '2026-11-01' }]);
  await assert.rejects(checkMaintenance(current.root, new Date('2026-09-24T00:00:00Z')), /未来/);
});

test('关闭必须有可定位证据和验证命令', async (context) => {
  const current = await fixture(context);
  const closed = { ...current.item, status: 'closed', closedOn: '2026-09-24' };
  await current.save([closed]);
  await assert.rejects(checkMaintenance(current.root, new Date('2026-09-25T00:00:00Z')), /关闭证据/);
  closed.closure = { evidence: ['docs/evidence.md'], commands: ['corepack pnpm test'], result: 'PASS' };
  await current.save([closed]);
  assert.deepEqual(await checkMaintenance(current.root, new Date('2026-09-25T00:00:00Z')), { open: 0, closed: 1 });
  closed.closure.evidence = ['../archive/private.log'];
  await current.save([closed]);
  await assert.rejects(checkMaintenance(current.root, new Date('2026-09-25T00:00:00Z')), /路径/);
});
