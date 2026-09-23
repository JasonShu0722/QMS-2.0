import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { evaluateObservation, loadPolicy, severityRank } from '../scripts/operations-alerts.mjs';

const root = resolve(import.meta.dirname, '..');
const policy = await loadPolicy();
const base = {
  version: 1,
  sampledAt: '2026-09-23T00:00:00.000Z',
  targetKind: 'disposable-postgresql',
  outbox: { duePending: 0, failed: 0, oldestDueSeconds: null },
  scan: { pending: 0, error: 0, oldestPendingSeconds: null },
};

function runCli(input) {
  return spawnSync(process.execPath, ['scripts/operations-alerts.mjs', '--stdin'], { cwd: root, input, encoding: 'utf8', windowsHide: true });
}

test('基线观测为 CLEAR，告警输出只含脱敏聚合字段', () => {
  const result = evaluateObservation(base, policy);
  assert.equal(result.status, 'CLEAR');
  assert.deepEqual(result.alerts, []);
  assert.deepEqual(result.metrics, base.outbox && { outbox: base.outbox, scan: base.scan });
  assert.ok(!JSON.stringify(result).includes('secret'));
});

test('失败事件和扫描错误提升为 CRITICAL，严重级别取最高值', () => {
  const result = evaluateObservation({
    ...base,
    outbox: { duePending: 1, failed: 1, oldestDueSeconds: 301 },
    scan: { pending: 10, error: 1, oldestPendingSeconds: 901 },
  }, policy);
  assert.equal(result.status, 'CRITICAL');
  assert.deepEqual(result.alerts.map((alert) => alert.id), [
    'outbox-failed', 'outbox-due-pending-warn', 'outbox-oldest-due-warn',
    'scan-error', 'scan-pending-warn', 'scan-oldest-pending-warn',
  ]);
  assert.ok(severityRank(result.status, policy) > severityRank('WARN', policy));
});

test('年龄为 null 时不触发滞留告警，数量阈值仍然生效', () => {
  const result = evaluateObservation({ ...base, outbox: { duePending: 10, failed: 0, oldestDueSeconds: null } }, policy);
  assert.equal(result.status, 'CRITICAL');
  assert.deepEqual(result.alerts.map((alert) => alert.id), ['outbox-due-pending-warn', 'outbox-due-pending-critical']);
});

test('输入结构或数值非法时返回 UNKNOWN 且不回显原始输入', () => {
  const result = evaluateObservation({ ...base, targetKind: 'secret-token', outbox: { ...base.outbox, failed: -1 } }, policy);
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.targetKind, 'unknown');
  assert.equal(result.metrics, null);
  assert.ok(!JSON.stringify(result).includes('secret-token'));
});

test('CLI 以状态映射退出码并对非法 JSON 使用 UNKNOWN', async () => {
  const clear = runCli(JSON.stringify(base));
  assert.equal(clear.status, 0, clear.stderr);
  assert.equal(JSON.parse(clear.stdout).status, 'CLEAR');
  const warn = runCli(JSON.stringify({ ...base, scan: { ...base.scan, pending: 10 } }));
  assert.equal(warn.status, 1, warn.stderr);
  assert.equal(JSON.parse(warn.stdout).status, 'WARN');
  const critical = runCli(JSON.stringify({ ...base, outbox: { ...base.outbox, failed: 1 } }));
  assert.equal(critical.status, 2, critical.stderr);
  assert.equal(JSON.parse(critical.stdout).status, 'CRITICAL');
  const unknown = runCli('{broken');
  assert.equal(unknown.status, 3, unknown.stderr);
  assert.equal(JSON.parse(unknown.stdout).status, 'UNKNOWN');
});

test('策略文件包含固定版本与全部所需指标', async () => {
  const raw = JSON.parse(await readFile(resolve(root, 'governance/operability-alerts.json'), 'utf8'));
  assert.equal(raw.version, 1);
  assert.deepEqual(raw.requiredMetrics, policy.requiredMetrics);
});
