import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export function parseObservationTarget(environment) {
  try {
    assert.equal(environment.QMS_ACCEPTANCE_DISPOSABLE_DATABASE, 'true');
    const url = new URL(environment.DATABASE_URL);
    assert.ok(['postgresql:', 'postgres:'].includes(url.protocol));
    assert.ok(['127.0.0.1', '[::1]'].includes(url.hostname) && /^\d+$/.test(url.port) && url.port !== '55440');
    assert.ok(!url.search && !url.hash && /^\/qms_observe_[a-z0-9_]+$/.test(url.pathname));
    return { databaseName: url.pathname.slice(1), connectionString: url.toString() };
  } catch { throw new Error('DATABASE_TARGET_FORBIDDEN'); }
}

function count(value) {
  const parsed = Number(value);
  assert.ok(Number.isSafeInteger(parsed) && parsed >= 0, 'INVALID_OBSERVATION');
  return parsed;
}

function age(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  assert.ok(Number.isFinite(parsed) && parsed >= 0, 'INVALID_OBSERVATION');
  return Math.floor(parsed);
}

export function normalizeObservationRow(outbox, scan, sampledAt) {
  return {
    version: 1, sampledAt, targetKind: 'disposable-postgresql',
    outbox: { duePending: count(outbox.due_pending), failed: count(outbox.failed), oldestDueSeconds: age(outbox.oldest_due_seconds) },
    scan: { pending: count(scan.pending), error: count(scan.error), oldestPendingSeconds: age(scan.oldest_pending_seconds) },
  };
}

export async function observeOperations(client) {
  await client.query('BEGIN READ ONLY');
  try {
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    const outbox = await client.query(`
      SELECT COUNT(*) FILTER (WHERE status = 'PENDING' AND available_at <= NOW()) AS due_pending,
             COUNT(*) FILTER (WHERE status = 'FAILED') AS failed,
             EXTRACT(EPOCH FROM (NOW() - MIN(available_at) FILTER (WHERE status = 'PENDING' AND available_at <= NOW()))) AS oldest_due_seconds
      FROM outbox_events`);
    const scan = await client.query(`
      SELECT COUNT(*) FILTER (WHERE status = 'QUARANTINED' AND scan_status = 'PENDING' AND object_version_id IS NOT NULL) AS pending,
             COUNT(*) FILTER (WHERE status = 'QUARANTINED' AND scan_status = 'ERROR') AS error,
             EXTRACT(EPOCH FROM (NOW() - MIN(upload_completed_at) FILTER (WHERE status = 'QUARANTINED' AND scan_status = 'PENDING' AND object_version_id IS NOT NULL))) AS oldest_pending_seconds
      FROM file_objects`);
    const result = normalizeObservationRow(outbox.rows[0], scan.rows[0], new Date().toISOString());
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let client;
  try {
    assert.equal(process.argv.length, 2, '参数无效');
    const target = parseObservationTarget(process.env);
    client = new pg.Client({ connectionString: target.connectionString, connectionTimeoutMillis: 5000, query_timeout: 7000 });
    await client.connect();
    const result = await observeOperations(client);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message === 'DATABASE_TARGET_FORBIDDEN' ? error.message : 'OPERATIONS_QUERY_FAILED');
    process.exitCode = 1;
  } finally { if (client) await client.end().catch(() => {}); }
}
