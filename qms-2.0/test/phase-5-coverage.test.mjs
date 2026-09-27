import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const coverage = JSON.parse(await readFile(join(root, 'governance/phase-5-coverage.json'), 'utf8'));

test('阶段五每个决策编号有唯一、可追踪的验收条目', () => {
  const expectedIds = [
    ...Array.from({ length: 5 }, (_, index) => `A${index + 1}`),
    ...Array.from({ length: 7 }, (_, index) => `B${index + 1}`),
    ...Array.from({ length: 16 }, (_, index) => `C${index + 1}`),
    ...Array.from({ length: 8 }, (_, index) => `D${index + 1}`),
    ...Array.from({ length: 4 }, (_, index) => `E${index + 1}`),
    ...Array.from({ length: 5 }, (_, index) => `F${index + 1}`),
    ...Array.from({ length: 7 }, (_, index) => `G${index + 1}`),
    ...Array.from({ length: 5 }, (_, index) => `H${index + 1}`),
    ...Array.from({ length: 5 }, (_, index) => `I${index + 1}`),
  ];
  assert.deepEqual(coverage.items.map((item) => item.id).sort(), expectedIds.sort());
  assert.deepEqual(coverage.items.map((item) => Number(item.source.split('!A')[1])).sort((left, right) => left - right), Array.from({ length: 62 }, (_, index) => index + 2));
  for (const item of coverage.items) {
    assert.match(item.source, /^阶段五评估决策清单\.xlsx#Sheet1!A\d+$/);
    assert.ok(item.title && item.domain && item.owner && item.phaseWave);
    assert.ok(['pending', 'partial', 'accepted', 'later', 'excluded', 'merged'].includes(item.status));
    assert.ok(coverage.decisionValues.includes(item.decision));
    assert.ok(Array.isArray(item.permission) && Array.isArray(item.acceptance));
    assert.equal(typeof item.nonGoal, 'string');
    if (item.decision === 'in-phase-5') {
      assert.match(item.phaseWave, /^5\.[0-6]$/);
      assert.ok(item.acceptance.length > 0, `${item.id} 缺少验收条件`);
    } else {
      assert.ok(['later', 'excluded', 'merged'].includes(item.status));
      assert.ok(item.nonGoal, `${item.id} 必须说明阶段五排除边界`);
    }
  }
});
