import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { assertReferences, restoredReferences } from '../../scripts/data-protection-objects.mjs';

const bytes = Buffer.from('verified historical evidence');
const digest = createHash('sha256').update(bytes).digest('hex');
const object = { key: randomUUID(), versionId: 'scanned-version', latest: false, sha256: digest, body: bytes.toString('base64'), restoredVersion: 'restored-scanned-version' };
const reference = { id: randomUUID(), object_key: object.key, object_version_id: object.versionId, status: 'AVAILABLE', scan_status: 'CLEAN', sha256: digest, verified_sha256: digest, verified_size_bytes: String(bytes.length), size_bytes: String(bytes.length), upload_completed_at: '2026-09-19T12:00:00.000Z' };

test('validates a pinned historical version even when latest bytes differ', () => {
  const latest = { ...object, versionId: 'unscanned-version', latest: true, body: Buffer.from('replacement').toString('base64'), sha256: 'different' };
  assert.doesNotThrow(() => assertReferences([reference], [object, latest]));
  assert.throws(() => assertReferences([reference], [latest]), /DATABASE_OBJECT_MISMATCH/);
});
test('keeps incomplete reservations without inventing an uploaded object', () => {
  const pending = { ...reference, status: 'QUARANTINED', scan_status: 'WAITING_UPLOAD', object_version_id: null, upload_completed_at: null, verified_sha256: null, verified_size_bytes: null };
  assert.doesNotThrow(() => assertReferences([pending], []));
  assert.doesNotThrow(() => assertReferences([{ ...pending, status: 'DELETED' }], []));
  assert.throws(() => assertReferences([{ ...pending, status: 'AVAILABLE' }], []), /DATABASE_OBJECT_MISMATCH/);
  assert.throws(() => assertReferences([{ ...pending, upload_completed_at: reference.upload_completed_at }], []), /DATABASE_OBJECT_MISMATCH/);
});
test('backs up quarantined mismatches without trusting the declared hash or promoting status', () => {
  const rejected = { ...reference, status: 'QUARANTINED', scan_status: 'REJECTED', sha256: 'incorrect-declaration', verified_sha256: null, verified_size_bytes: null };
  assert.doesNotThrow(() => assertReferences([rejected], [object]));
  assert.equal(restoredReferences([rejected], [object])[0].status, 'QUARANTINED');
});
test('requires measured integrity for available and retained deleted objects', () => {
  assert.throws(() => assertReferences([{ ...reference, verified_sha256: null }], [object]), /DATABASE_OBJECT_MISMATCH/);
  assert.throws(() => assertReferences([{ ...reference, verified_size_bytes: '999' }], [object]), /DATABASE_OBJECT_MISMATCH/);
  assert.throws(() => assertReferences([{ ...reference, status: 'DELETED' }], []), /DATABASE_OBJECT_MISMATCH/);
  assert.throws(() => assertReferences([{ ...reference, status: 'DELETED', verified_sha256: 'changed' }], [object]), /DATABASE_OBJECT_MISMATCH/);
});
test('remaps each original version to its restored version without changing other facts', () => {
  const pending = { ...reference, id: randomUUID(), object_version_id: null, status: 'QUARANTINED' };
  assert.deepEqual(restoredReferences([reference, pending], [object]), [{ ...reference, object_version_id: object.restoredVersion }, pending]);
  assert.equal(reference.object_version_id, 'scanned-version');
  assert.throws(() => restoredReferences([reference], []), /RESTORED_VERSION_MISSING/);
  assert.throws(() => restoredReferences([reference], [{ ...object, restoredVersion: undefined }]), /RESTORED_VERSION_MISSING/);
});
