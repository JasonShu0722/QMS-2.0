import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_POLICY_PATH = resolve(ROOT, 'governance/operability-alerts.json');
const STATUS_CODES = Object.freeze({ CLEAR: 0, WARN: 1, CRITICAL: 2, UNKNOWN: 3 });
const METRIC_SHAPE = Object.freeze({
  outbox: ['duePending', 'failed', 'oldestDueSeconds'],
  scan: ['pending', 'error', 'oldestPendingSeconds'],
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonNegativeInteger(value, nullable = false) {
  if (nullable && value === null) return true;
  return Number.isSafeInteger(value) && value >= 0;
}

function metricAt(metrics, path) {
  const [group, name] = path.split('.');
  return metrics?.[group]?.[name];
}

function sanitizeMetrics(observation) {
  return {
    outbox: {
      duePending: observation.outbox.duePending,
      failed: observation.outbox.failed,
      oldestDueSeconds: observation.outbox.oldestDueSeconds,
    },
    scan: {
      pending: observation.scan.pending,
      error: observation.scan.error,
      oldestPendingSeconds: observation.scan.oldestPendingSeconds,
    },
  };
}

function invalidReport() {
  return {
    version: 1,
    status: 'UNKNOWN',
    sampledAt: null,
    targetKind: 'unknown',
    metrics: null,
    alerts: [{ id: 'observation-invalid', severity: 'UNKNOWN', message: '观测输入无效' }],
  };
}

export function severityRank(severity, policy) {
  const index = policy.severityOrder.indexOf(severity);
  return index < 0 ? -1 : index;
}

export function validatePolicy(policy) {
  assert.equal(policy?.version, 1, 'INVALID_ALERT_POLICY');
  assert.equal(policy?.observationVersion, 1, 'INVALID_ALERT_POLICY');
  assert.deepEqual(policy?.requiredMetrics, Object.keys(METRIC_SHAPE).flatMap((group) => METRIC_SHAPE[group].map((name) => `${group}.${name}`)), 'INVALID_ALERT_POLICY');
  assert.deepEqual(policy?.severityOrder, ['CLEAR', 'WARN', 'CRITICAL'], 'INVALID_ALERT_POLICY');
  assert.ok(Array.isArray(policy.rules) && policy.rules.length > 0, 'INVALID_ALERT_POLICY');
  const ids = new Set();
  for (const rule of policy.rules) {
    assert.ok(isRecord(rule) && typeof rule.id === 'string' && rule.id.length > 0, 'INVALID_ALERT_POLICY');
    assert.ok(!ids.has(rule.id), 'INVALID_ALERT_POLICY');
    ids.add(rule.id);
    assert.ok(policy.severityOrder.includes(rule.severity) && rule.severity !== 'CLEAR', 'INVALID_ALERT_POLICY');
    assert.equal(rule.operator, '>=', 'INVALID_ALERT_POLICY');
    assert.ok(typeof rule.metric === 'string' && policy.requiredMetrics.includes(rule.metric), 'INVALID_ALERT_POLICY');
    assert.ok(Number.isSafeInteger(rule.threshold) && rule.threshold >= 0, 'INVALID_ALERT_POLICY');
    assert.ok(typeof rule.message === 'string' && rule.message.length > 0, 'INVALID_ALERT_POLICY');
  }
  return policy;
}

export async function loadPolicy(policyPath = DEFAULT_POLICY_PATH) {
  return validatePolicy(JSON.parse(await readFile(policyPath, 'utf8')));
}

export function evaluateObservation(observation, policy) {
  try {
    validatePolicy(policy);
    assert.ok(isRecord(observation), 'INVALID_OBSERVATION');
    assert.equal(observation.version, policy.observationVersion, 'INVALID_OBSERVATION');
    assert.ok(typeof observation.sampledAt === 'string' && Number.isFinite(Date.parse(observation.sampledAt)), 'INVALID_OBSERVATION');
    assert.ok(typeof observation.targetKind === 'string' && observation.targetKind.length > 0 && observation.targetKind.length <= 64, 'INVALID_OBSERVATION');
    for (const [group, names] of Object.entries(METRIC_SHAPE)) {
      assert.ok(isRecord(observation[group]), 'INVALID_OBSERVATION');
      for (const name of names) assert.ok(nonNegativeInteger(observation[group][name], name.endsWith('Seconds')), 'INVALID_OBSERVATION');
    }
    const metrics = sanitizeMetrics(observation);
    const alerts = policy.rules
      .filter((rule) => {
        const value = metricAt(metrics, rule.metric);
        return value !== null && value >= rule.threshold;
      })
      .map((rule) => ({
        id: rule.id,
        severity: rule.severity,
        metric: rule.metric,
        value: metricAt(metrics, rule.metric),
        threshold: rule.threshold,
        message: rule.message,
      }));
    const status = alerts.reduce((current, alert) => severityRank(alert.severity, policy) > severityRank(current, policy) ? alert.severity : current, 'CLEAR');
    return { version: 1, status, sampledAt: observation.sampledAt, targetKind: observation.targetKind, metrics, alerts };
  } catch {
    return invalidReport();
  }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export function exitCode(status) {
  return Object.hasOwn(STATUS_CODES, status) ? STATUS_CODES[status] : STATUS_CODES.UNKNOWN;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.deepEqual(process.argv.slice(2), ['--stdin'], '参数无效');
    const policy = await loadPolicy();
    let observation;
    try { observation = JSON.parse(await readStdin()); } catch { observation = null; }
    const result = evaluateObservation(observation, policy);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = exitCode(result.status);
  } catch {
    console.error('OPERATIONS_ALERTS_FAILED');
    process.exitCode = STATUS_CODES.UNKNOWN;
  }
}
