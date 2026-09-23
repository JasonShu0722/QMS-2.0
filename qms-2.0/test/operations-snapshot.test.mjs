import assert from 'node:assert/strict';
import test from 'node:test';
import { parseObservationTarget, normalizeObservationRow } from '../apps/api/scripts/operations-snapshot.mjs';

const target = 'postgresql://qms:secret@127.0.0.1:55455/qms_observe_validation';

test('只接受显式一次性 loopback 数据库，连接前拒绝预览库', () => {
  assert.equal(parseObservationTarget({ DATABASE_URL: target, QMS_ACCEPTANCE_DISPOSABLE_DATABASE: 'true' }).databaseName, 'qms_observe_validation');
  for (const [url, flag] of [
    [target.replace('55455', '55440'), 'true'],
    [target.replace('127.0.0.1', 'db.example.com'), 'true'],
    [target.replace('qms_observe_validation', 'postgres'), 'true'],
    [target, 'false'],
    [`${target}?sslmode=disable`, 'true'],
  ]) assert.throws(() => parseObservationTarget({ DATABASE_URL: url, QMS_ACCEPTANCE_DISPOSABLE_DATABASE: flag }), /DATABASE_TARGET_FORBIDDEN/);
});

test('聚合输出只含数量与年龄，空队列年龄为 null', () => {
  const result = normalizeObservationRow({ due_pending: '2', failed: '1', oldest_due_seconds: '83.4' }, { pending: '0', error: '3', oldest_pending_seconds: null }, '2026-09-23T00:00:00.000Z');
  assert.deepEqual(result, {
    version: 1, sampledAt: '2026-09-23T00:00:00.000Z', targetKind: 'disposable-postgresql',
    outbox: { duePending: 2, failed: 1, oldestDueSeconds: 83 },
    scan: { pending: 0, error: 3, oldestPendingSeconds: null },
  });
  assert.ok(!JSON.stringify(result).includes('secret'));
  assert.throws(() => normalizeObservationRow({ due_pending: '-1', failed: '0', oldest_due_seconds: null }, { pending: '0', error: '0', oldest_pending_seconds: null }, '2026-09-23T00:00:00.000Z'), /INVALID_OBSERVATION/);
});
