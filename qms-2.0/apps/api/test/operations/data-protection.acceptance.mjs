import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rmdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { S3Client, GetBucketVersioningCommand, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, CreateBucketCommand, PutBucketVersioningCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { S3CompatibleObjectStorage } from '../../dist/modules/file-management/object-storage.service.js';

for (const name of ['DATABASE_URL', 'QMS_OBJECT_STORAGE_ENDPOINT', 'QMS_OBJECT_STORAGE_BUCKET', 'QMS_OBJECT_STORAGE_ACCESS_KEY', 'QMS_OBJECT_STORAGE_SECRET_KEY', 'QMS_BACKUP_KEY', 'QMS_BACKUP_POSTGRES_CONTAINER', 'QMS_ACCEPTANCE_ARTIFACT_DIRECTORY']) if (!process.env[name]) throw new Error(`${name} is required`);
const original = new URL(process.env.DATABASE_URL);
if (!['127.0.0.1', '[::1]'].includes(original.hostname) || original.port === '55440' || process.env.QMS_ACCEPTANCE_DISPOSABLE_DATABASE !== 'true') throw new Error('This exercise requires explicitly disposable local PostgreSQL');
const suffix = randomUUID().replaceAll('-', '');
const sourceName = `qms_backup_${suffix}`;
const targetName = `qms_restore_${suffix}`;
const sourceUrl = new URL(original); sourceUrl.pathname = sourceName;
const targetUrl = new URL(original); targetUrl.pathname = targetName;
const bucket = `qms-backup-${suffix}`;
const targetBucket = `qms-restore-${suffix}`;
const artifact = resolve(process.env.QMS_ACCEPTANCE_ARTIFACT_DIRECTORY, `data-protection-${suffix}.qmsb`);
const environment = { ...process.env, DATABASE_URL: sourceUrl.toString(), QMS_OBJECT_STORAGE_BUCKET: bucket, QMS_BACKUP_QUIESCED: 'yes' };
function cli(command, path = undefined, overrides = {}) {
  return spawnSync(process.execPath, ['scripts/data-protection.mjs', command, ...(path ? [path] : [])], { cwd: process.cwd(), env: { ...environment, ...overrides }, encoding: 'utf8', windowsHide: true, timeout: 120000 });
}
function passed(result) { assert.equal(result.status, 0, result.stderr); }

await test('real PostgreSQL and private versioned MinIO backup/restore', async (suite) => {
  const admin = new pg.Client({ connectionString: original.toString() });
  const client = new S3Client({ endpoint: process.env.QMS_OBJECT_STORAGE_ENDPOINT, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: process.env.QMS_OBJECT_STORAGE_ACCESS_KEY, secretAccessKey: process.env.QMS_OBJECT_STORAGE_SECRET_KEY } });
  const source = new pg.Client({ connectionString: sourceUrl.toString() });
  const key = randomUUID(); const bytes = Buffer.from('QMS protected backup fixture');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const fileId = randomUUID(); const pendingId = randomUUID(); const rejectedId = randomUUID();
  let pinnedVersion;
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${sourceName}"`); await admin.query(`CREATE DATABASE "${targetName}"`);
    const migrated = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: environment, cwd: process.cwd(), encoding: 'utf8', windowsHide: true, timeout: 120000 }); passed(migrated);
    await source.connect();
    passed(cli('init-storage'));
    await suite.test('anonymous access is denied, signed upload is bounded and cannot overwrite', async () => {
      process.env.QMS_OBJECT_STORAGE_BUCKET = bucket;
      const signed = await new S3CompatibleObjectStorage().createUploadUrl(key, 'application/pdf');
      assert.equal(new URL(signed.url).searchParams.get('X-Amz-Expires'), '60');
      const uploaded = await fetch(signed.url, { method: 'PUT', headers: signed.headers, body: bytes });
      assert.equal(uploaded.status, 200);
      assert.equal((await fetch(signed.url, { method: 'PUT', headers: signed.headers, body: bytes })).status, 412);
      assert.equal((await fetch(`${process.env.QMS_OBJECT_STORAGE_ENDPOINT}/${bucket}/${key}`)).status, 403);
      const versioning = await client.send(new GetBucketVersioningCommand({ Bucket: bucket })); assert.equal(versioning.Status, 'Enabled');
      const versionId = uploaded.headers.get('x-amz-version-id');
      assert.ok(versionId);
      pinnedVersion = versionId;
      await assert.rejects(client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key, VersionId: versionId })), (error) => error.$metadata?.httpStatusCode === 403 || (error.name === 'InvalidRequest' && error.$metadata?.httpStatusCode === 400));
      const preserved = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key, VersionId: versionId }));
      assert.deepEqual(Buffer.from(await preserved.Body.transformToByteArray()), bytes);
    });
    const organizationId = randomUUID(); const userId = randomUUID();
    await source.query('INSERT INTO organizations(id,code,name,type,updated_at) VALUES($1,$2,$2,\'INTERNAL\',NOW())', [organizationId, `backup-${suffix}`]);
    await source.query('INSERT INTO users(id,organization_id,username,password_hash,account_type,updated_at) VALUES($1,$2,$3,$4,\'INTERNAL\',NOW())', [userId, organizationId, `backup-${suffix}`, 'fixture-unused']);
    await source.query("INSERT INTO file_objects(id,organization_id,object_key,original_name,content_type,size_bytes,sha256,status,uploaded_by_id,updated_at,object_version_id,verified_sha256,verified_size_bytes,verified_content_type,scan_status,scanned_at,scanner_engine,upload_completed_at,upload_expires_at,retain_until,resource_type,resource_id,resource_version) VALUES($1,$2,$3,$4,$5,$6,$7,'AVAILABLE',$8,NOW(),$9,$7,$6,$5,'CLEAN',NOW(),'backup-integrity-fixture',NOW(),NOW()+INTERVAL '15 minutes',NOW()+INTERVAL '7 days','backup-integrity-test',$1::uuid::text,1)", [fileId, organizationId, key, 'fixture.pdf', 'application/pdf', bytes.length, sha256, userId, pinnedVersion]);
    await source.query("INSERT INTO file_objects(id,organization_id,object_key,original_name,content_type,size_bytes,sha256,status,uploaded_by_id,updated_at,scan_status,upload_expires_at,retain_until) VALUES($1,$2,$3,'pending.txt','text/plain',10,$4,'QUARANTINED',$5,NOW(),'WAITING_UPLOAD',NOW()+INTERVAL '15 minutes',NOW()+INTERVAL '7 days')", [pendingId, organizationId, randomUUID(), '0'.repeat(64), userId]);
    const rejectedKey = randomUUID(); const rejectedBytes = Buffer.from('quarantined content with mismatching declaration');
    const rejectedObject = await client.send(new PutObjectCommand({ Bucket: bucket, Key: rejectedKey, Body: rejectedBytes, ContentType: 'text/plain' }));
    await source.query("INSERT INTO file_objects(id,organization_id,object_key,original_name,content_type,size_bytes,sha256,status,uploaded_by_id,updated_at,object_version_id,scan_status,upload_completed_at,upload_expires_at,retain_until) VALUES($1,$2,$3,'rejected.txt','text/plain',$4,$5,'QUARANTINED',$6,NOW(),$7,'REJECTED',NOW(),NOW()+INTERVAL '15 minutes',NOW()+INTERVAL '7 days')", [rejectedId, organizationId, rejectedKey, rejectedBytes.length, '0'.repeat(64), userId, rejectedObject.VersionId]);
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: 'newer unscanned bytes', ContentType: 'text/plain' }));
    await suite.test('encrypted backup validates database references and migrations', async () => {
      passed(cli('backup', artifact)); passed(cli('verify', artifact));
      assert.equal((await readFile(artifact)).includes(bytes), false);
      assert.notEqual(cli('backup', artifact).status, 0);
    });
    await suite.test('restore refuses source, non-confirmed targets and corrupted ciphertext', async () => {
      assert.notEqual(cli('restore', artifact).status, 0);
      const corrupted = await readFile(artifact); corrupted[corrupted.length - 1] ^= 1;
      const corruptPath = `${artifact}.corrupt`; await writeFile(corruptPath, corrupted, { flag: 'wx' });
      assert.notEqual(cli('verify', corruptPath).status, 0);
      assert.notEqual(cli('restore', artifact, { DATABASE_URL: targetUrl.toString(), QMS_OBJECT_STORAGE_BUCKET: targetBucket }).status, 0);
    });
    await suite.test('validates the actual PostgreSQL target before creating protected objects', async () => {
      const overridden = new URL(targetUrl); overridden.search = '?port=55440';
      const rejected = cli('restore', artifact, { DATABASE_URL: overridden.toString(), QMS_OBJECT_STORAGE_BUCKET: targetBucket, QMS_RESTORE_CONFIRM: targetName });
      assert.notEqual(rejected.status, 0); assert.match(rejected.stderr, /DATABASE_TARGET_FORBIDDEN/);
      const mismatch = cli('restore', artifact, { DATABASE_URL: targetUrl.toString(), QMS_OBJECT_STORAGE_BUCKET: targetBucket, QMS_RESTORE_CONFIRM: targetName, QMS_BACKUP_POSTGRES_CONTAINER: process.env.QMS_BACKUP_MISMATCH_CONTAINER ?? 'qms2-main-integration-minio' });
      assert.notEqual(mismatch.status, 0); assert.match(mismatch.stderr, /DATABASE_CONTAINER_MISMATCH/);
      const ipv6 = new URL(targetUrl); ipv6.hostname = '[::1]';
      const wrongFamily = cli('restore', artifact, { DATABASE_URL: ipv6.toString(), QMS_OBJECT_STORAGE_BUCKET: targetBucket, QMS_RESTORE_CONFIRM: targetName });
      assert.notEqual(wrongFamily.status, 0); assert.match(wrongFamily.stderr, /DATABASE_CONTAINER_MISMATCH/);
      await assert.rejects(client.send(new HeadBucketCommand({ Bucket: targetBucket })), (error) => error.$metadata?.httpStatusCode === 404);
      const directory = resolve('../../..', `..backups-${suffix}`);
      await mkdir(directory);
      try { const inside = cli('backup', resolve(directory, 'forbidden.qmsb')); assert.notEqual(inside.status, 0); assert.match(inside.stderr, /BACKUP_MUST_BE_OUTSIDE_GIT/); }
      finally { await rmdir(directory); }
    });
    await suite.test('refuses target buckets containing only historical versions or deletion markers', async () => {
      const historicalBucket = `qms-history-${suffix}`;
      await client.send(new CreateBucketCommand({ Bucket: historicalBucket }));
      await client.send(new PutBucketVersioningCommand({ Bucket: historicalBucket, VersioningConfiguration: { Status: 'Enabled' } }));
      await client.send(new PutObjectCommand({ Bucket: historicalBucket, Key: key, Body: bytes }));
      await client.send(new DeleteObjectCommand({ Bucket: historicalBucket, Key: key }));
      const rejected = cli('restore', artifact, { DATABASE_URL: targetUrl.toString(), QMS_OBJECT_STORAGE_BUCKET: historicalBucket, QMS_RESTORE_CONFIRM: targetName });
      assert.notEqual(rejected.status, 0); assert.match(rejected.stderr, /RESTORE_BUCKET_NOT_EMPTY/);
    });
    await suite.test('restores into a fresh isolated database and private bucket with exact object bytes', async () => {
      const restored = cli('restore', artifact, { DATABASE_URL: targetUrl.toString(), QMS_OBJECT_STORAGE_BUCKET: targetBucket, QMS_RESTORE_CONFIRM: targetName }); passed(restored);
      assert.match(restored.stdout, /RESTORE_PASS/);
      const restoredDatabase = new pg.Client({ connectionString: targetUrl.toString() });
      try {
        await restoredDatabase.connect();
        const restoredFiles = (await restoredDatabase.query('SELECT id,status,scan_status,object_version_id FROM file_objects ORDER BY id')).rows;
        const pinned = restoredFiles.find((file) => file.id === fileId);
        assert.ok(pinned.object_version_id); assert.notEqual(pinned.object_version_id, pinnedVersion);
        const object = await client.send(new GetObjectCommand({ Bucket: targetBucket, Key: key, VersionId: pinned.object_version_id }));
        assert.deepEqual(Buffer.from(await object.Body.transformToByteArray()), bytes);
        const latest = await client.send(new GetObjectCommand({ Bucket: targetBucket, Key: key }));
        assert.equal(Buffer.from(await latest.Body.transformToByteArray()).toString(), 'newer unscanned bytes');
        assert.deepEqual(restoredFiles.find((file) => file.id === pendingId), { id: pendingId, status: 'QUARANTINED', scan_status: 'WAITING_UPLOAD', object_version_id: null });
        assert.equal(restoredFiles.find((file) => file.id === rejectedId).scan_status, 'REJECTED');
      } finally { await restoredDatabase.end(); }
      assert.notEqual(cli('restore', artifact, { DATABASE_URL: targetUrl.toString(), QMS_OBJECT_STORAGE_BUCKET: targetBucket, QMS_RESTORE_CONFIRM: targetName }).status, 0);
    });
    await suite.test('preserves previous versions and refuses backups with mismatched database content', async () => {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: 'another administrative version' }));
      passed(cli('backup', `${artifact}.historical`));
      await source.query("UPDATE file_objects SET status='DELETED', object_version_id='missing-version' WHERE id=$1", [fileId]);
      const rejected = cli('backup', `${artifact}.mismatch`);
      assert.notEqual(rejected.status, 0); assert.match(rejected.stderr, /DATABASE_OBJECT_MISMATCH/);
    });
  } finally { await source.end(); await admin.end(); client.destroy(); process.env.QMS_OBJECT_STORAGE_BUCKET = environment.QMS_OBJECT_STORAGE_BUCKET; }
});
