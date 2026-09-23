import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { observeOperations, parseObservationTarget } from '../../scripts/operations-snapshot.mjs';

const target = parseObservationTarget(process.env);

test('真实一次性 PostgreSQL 观测 Outbox 和扫描滞留，结果不含明细', async () => {
  const client = new pg.Client({ connectionString: target.connectionString });
  const suffix = randomUUID().replaceAll('-', '');
  const organizationId = randomUUID();
  const userId = randomUUID();
  const eventIds = [randomUUID(), randomUUID()];
  const fileIds = [randomUUID(), randomUUID()];
  await client.connect();
  try {
    await client.query('INSERT INTO organizations(id,code,name,type,updated_at) VALUES($1,$2,$2,\'INTERNAL\',NOW())', [organizationId, `observe-${suffix}`]);
    await client.query('INSERT INTO users(id,organization_id,username,password_hash,account_type,updated_at) VALUES($1,$2,$3,$4,\'INTERNAL\',NOW())', [userId, organizationId, `observe-${suffix}`, 'unused-fixture']);
    await client.query("INSERT INTO outbox_events(id,event_key,aggregate_type,aggregate_id,event_type,payload,status,available_at) VALUES($1,$2,'Fixture',$3,'OBSERVE_PENDING','{}'::jsonb,'PENDING',NOW()-INTERVAL '2 minutes')", [eventIds[0], `observe-pending-${suffix}`, eventIds[0]]);
    await client.query("INSERT INTO outbox_events(id,event_key,aggregate_type,aggregate_id,event_type,payload,status,available_at) VALUES($1,$2,'Fixture',$3,'OBSERVE_FAILED','{}'::jsonb,'FAILED',NOW()-INTERVAL '3 minutes')", [eventIds[1], `observe-failed-${suffix}`, eventIds[1]]);
    await client.query("INSERT INTO file_objects(id,organization_id,object_key,original_name,content_type,size_bytes,sha256,status,uploaded_by_id,updated_at,object_version_id,scan_status,upload_completed_at,upload_expires_at,retain_until) VALUES($1,$2,$3,'observe.pdf','application/pdf',10,$4,'QUARANTINED',$5,NOW(),'test-version','PENDING',NOW()-INTERVAL '2 minutes',NOW()+INTERVAL '15 minutes',NOW()+INTERVAL '7 days')", [fileIds[0], organizationId, randomUUID(), '0'.repeat(64), userId]);
    await client.query("INSERT INTO file_objects(id,organization_id,object_key,original_name,content_type,size_bytes,sha256,status,uploaded_by_id,updated_at,object_version_id,scan_status,upload_completed_at,upload_expires_at,retain_until) VALUES($1,$2,$3,'error.pdf','application/pdf',10,$4,'QUARANTINED',$5,NOW(),'test-version','ERROR',NOW()-INTERVAL '2 minutes',NOW()+INTERVAL '15 minutes',NOW()+INTERVAL '7 days')", [fileIds[1], organizationId, randomUUID(), '0'.repeat(64), userId]);
    const snapshot = await observeOperations(client);
    assert.deepEqual({ due: snapshot.outbox.duePending, failed: snapshot.outbox.failed, pending: snapshot.scan.pending, error: snapshot.scan.error }, { due: 1, failed: 1, pending: 1, error: 1 });
    assert.ok(snapshot.outbox.oldestDueSeconds >= 110 && snapshot.scan.oldestPendingSeconds >= 110);
    assert.ok(!JSON.stringify(snapshot).includes(suffix) && !JSON.stringify(snapshot).includes('observe.pdf'));
    assert.equal((await client.query('SELECT COUNT(*)::int AS count FROM outbox_events')).rows[0].count, 2);
  } finally {
    await client.query('DELETE FROM file_objects WHERE id = ANY($1::uuid[])', [fileIds]).catch(() => {});
    await client.query('DELETE FROM outbox_events WHERE id = ANY($1::uuid[])', [eventIds]).catch(() => {});
    await client.query('DELETE FROM users WHERE id=$1', [userId]).catch(() => {});
    await client.query('DELETE FROM organizations WHERE id=$1', [organizationId]).catch(() => {});
    await client.end();
  }
});
