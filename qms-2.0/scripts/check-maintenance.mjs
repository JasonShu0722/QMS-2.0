import assert from 'node:assert/strict';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceDigest } from './check-documentation.mjs';

function date(value, label) {
  assert.match(value ?? '', /^\d{4}-\d{2}-\d{2}$/, `${label} 日期格式无效`);
  const parsed = new Date(`${value}T00:00:00Z`);
  assert.ok(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value, `${label} 日期无效`);
  return parsed;
}

function within(root, path) {
  const part = relative(root, path);
  return part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part);
}

async function safeFile(root, path) {
  assert.ok(typeof path === 'string' && path.length > 0 && !isAbsolute(path) && !path.includes('\\') && !path.split('/').some((part) => part === '..' || part === '.')
    && !/(?:^|\/)\.env(?:\.|$)/i.test(path) && !/(?:^|\/)(?:archive|backups|uploads|logs)(?:\/|$)/i.test(path)
    && !/\.(?:log|pem|key|crt|pfx|p12|bak|backup|qmsb|dump|db)$/i.test(path), `来源或证据路径无效：${path}`);
  const target = resolve(root, path);
  assert.ok(within(root, target), `路径越界：${path}`);
  const actual = await realpath(target);
  assert.ok(within(root, actual) && (await stat(actual)).isFile(), `路径无效：${path}`);
  return actual;
}

export async function checkMaintenance(directory, now = new Date()) {
  const root = await realpath(directory);
  const register = JSON.parse(await readFile(resolve(root, 'governance/maintenance-items.json'), 'utf8'));
  assert.equal(register.version, 1, '维护台账版本无效');
  assert.ok(Array.isArray(register.items), '维护事项必须为数组');
  const ids = new Set();
  const counts = { open: 0, closed: 0 };
  for (const item of register.items) {
    assert.match(item.id ?? '', /^MAINT-\d{3,}$/, '维护事项 ID 无效');
    assert.ok(!ids.has(item.id), `维护事项 ID 重复：${item.id}`);
    ids.add(item.id);
    assert.ok(['dependency', 'deprecation', 'performance', 'recurring-incident', 'operability', 'capacity'].includes(item.category), `${item.id} 分类无效`);
    assert.ok(['open', 'closed'].includes(item.status), `${item.id} 状态无效`);
    for (const field of ['owner', 'fact', 'impact', 'trigger', 'nextAction']) assert.ok(typeof item[field] === 'string' && item[field].trim(), `${item.id} 缺少 ${field}`);
    const reviewed = date(item.reviewedOn, `${item.id} reviewedOn`);
    assert.ok(reviewed <= now, `${item.id} reviewedOn 不能在未来`);
    const due = date(item.reviewDue, `${item.id} reviewDue`);
    assert.ok(due > reviewed && due.getTime() <= reviewed.getTime() + 365 * 86400000, `${item.id} reviewDue 超出复核周期`);
    assert.ok(Array.isArray(item.sources) && item.sources.length > 0, `${item.id} 缺少来源`);
    const sources = new Set();
    for (const source of item.sources) {
      assert.ok(!sources.has(source.path), `${item.id} 来源重复`);
      sources.add(source.path);
      assert.match(source.sha256 ?? '', /^[a-f0-9]{64}$/, `${item.id} 来源摘要无效`);
      const file = await safeFile(root, source.path);
      if (item.status === 'open') assert.equal(source.sha256, sourceDigest(await readFile(file, 'utf8')), `${item.id} 来源已变化：${source.path}`);
    }
    if (item.status === 'open') {
      assert.ok(!item.closedOn && !item.closure, `${item.id} 开放事项不能填写关闭字段`);
      assert.ok(now < due, `${item.id} 复核已到期`);
    } else {
      const closed = date(item.closedOn, `${item.id} closedOn`);
      assert.ok(closed >= reviewed && closed <= now, `${item.id} closedOn 无效`);
      const closure = item.closure;
      assert.ok(closure && Array.isArray(closure.evidence) && closure.evidence.length > 0
        && Array.isArray(closure.commands) && closure.commands.length > 0 && closure.result === 'PASS', `${item.id} 缺少关闭证据、命令或 PASS 结果`);
      for (const path of closure.evidence) await safeFile(root, path);
      for (const command of closure.commands) assert.ok(typeof command === 'string' && command.trim(), `${item.id} 关闭命令无效`);
    }
    counts[item.status]++;
  }
  return counts;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await checkMaintenance(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
    console.log(`维护台账 PASS：开放 ${result.open}；关闭 ${result.closed}`);
  } catch (error) {
    console.error(`维护台账 FAIL：${error.message}`);
    process.exitCode = 1;
  }
}
