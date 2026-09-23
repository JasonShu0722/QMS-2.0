import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { evaluateObservation, loadPolicy } from '../../../../scripts/operations-alerts.mjs';
import { observeOperations, parseObservationTarget } from '../../scripts/operations-snapshot.mjs';

for (const name of ['DATABASE_URL', 'QMS_ACCEPTANCE_DISPOSABLE_DATABASE']) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}
const target = parseObservationTarget(process.env);
const policy = await loadPolicy();

await test('MAINT-003 真实 PostgreSQL 触发 CRITICAL 并在清理后恢复 CLEAR', async () => {
  const client = new pg.Client({ connectionString: target.connectionString, connectionTimeoutMillis: 5000, query_timeout: 7000 });
  const suffix = randomUUID().replaceAll('-', '');
  const eventId = randomUUID();
  const eventKey = `maint-003-${suffix}`;
  const objectId = randomUUID();
  const objectKey = `maint-003/${suffix}/error.bin`;
  let connected = false;
  try {
    await client.connect();
    connected = true;
    const identity = await client.query('SELECT id, organization_id FROM users ORDER BY id LIMIT 1');
    assert.ok(identity.rows[0], '一次性数据库至少需要一个用户夹具');
    const { id: userId, organization_id: organizationId } = identity.rows[0];
    const baseline = evaluateObservation(await observeOperations(client), policy);
    assert.equal(baseline.status, 'CLEAR', '演练必须从无积压基线开始');

    await client.query(`
      INSERT INTO outbox_events
        (id, event_key, aggregate_type, aggregate_id, event_type, payload, status, attempts, last_error, available_at, created_at)
      VALUES ($1::uuid, $2, 'Maint003Fixture', $1::text, 'Maint003FixtureFailed', '{}'::jsonb, 'FAILED', 1, 'MAINT-003 fixture failure', NOW(), NOW())
    `, [eventId, eventKey]);
    await client.query(`
      INSERT INTO file_objects
        (id, organization_id, object_key, original_name, content_type, size_bytes, sha256, object_version_id,
         upload_completed_at, scan_status, status, uploaded_by_id, created_at, updated_at)
      VALUES ($1, $2, $3, 'maint-003-fixture.bin', 'application/octet-stream', 1, repeat('0', 64), $4,
              NOW(), 'ERROR', 'QUARANTINED', $5, NOW(), NOW())
    `, [objectId, organizationId, objectKey, `maint-003-version-${suffix}`, userId]);

    const injected = evaluateObservation(await observeOperations(client), policy);
    assert.equal(injected.status, 'CRITICAL');
    assert.ok(injected.alerts.some((alert) => alert.id === 'outbox-failed'));
    assert.ok(injected.alerts.some((alert) => alert.id === 'scan-error'));

    await client.query('DELETE FROM file_objects WHERE id = $1', [objectId]);
    await client.query('DELETE FROM outbox_events WHERE id = $1', [eventId]);
    const recovered = evaluateObservation(await observeOperations(client), policy);
    assert.equal(recovered.status, 'CLEAR');
    assert.deepEqual(recovered.alerts, []);
  } finally {
    if (connected) {
      await client.query('DELETE FROM file_objects WHERE object_key = $1', [objectKey]).catch(() => {});
      await client.query('DELETE FROM outbox_events WHERE event_key = $1', [eventKey]).catch(() => {});
    }
    await client.end().catch(() => {});
  }
});

test('MAINT-003 验收拒绝预览端口和非一次性目标', () => {
  const preview = new URL(target.connectionString);
  preview.port = '55440';
  assert.throws(() => parseObservationTarget({ DATABASE_URL: preview.toString(), QMS_ACCEPTANCE_DISPOSABLE_DATABASE: 'true' }), /DATABASE_TARGET_FORBIDDEN/);
  assert.throws(() => parseObservationTarget({ DATABASE_URL: target.connectionString, QMS_ACCEPTANCE_DISPOSABLE_DATABASE: 'false' }), /DATABASE_TARGET_FORBIDDEN/);
});


