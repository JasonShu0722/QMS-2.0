import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import pg from 'pg';
import { S3Client, CreateBucketCommand, GetBucketVersioningCommand, PutBucketVersioningCommand, PutPublicAccessBlockCommand, PutBucketPolicyCommand, PutObjectLockConfigurationCommand, ListObjectVersionsCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { assertReferences, restoredReferences } from './data-protection-objects.mjs';

const maximumBytes = 256 * 1024 * 1024;
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const referenceQuery = 'SELECT id, object_key, object_version_id, status, scan_status, sha256, size_bytes, verified_sha256, verified_size_bytes, upload_completed_at FROM file_objects ORDER BY id';
function required(name) { const value = process.env[name]; if (!value) throw new Error(`MISSING_${name}`); return value; }
function database() {
  const url = new URL(required('DATABASE_URL'));
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash || url.port === '55440' || !['127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('DATABASE_TARGET_FORBIDDEN');
  return { url, name: decodeURIComponent(url.pathname.slice(1)), username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) };
}
function storage() {
  const endpoint = required('QMS_OBJECT_STORAGE_ENDPOINT');
  if (process.env.NODE_ENV === 'production' && new URL(endpoint).protocol !== 'https:') throw new Error('STORAGE_TLS_REQUIRED');
  return new S3Client({ endpoint, region: process.env.QMS_OBJECT_STORAGE_REGION ?? 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: required('QMS_OBJECT_STORAGE_ACCESS_KEY'), secretAccessKey: required('QMS_OBJECT_STORAGE_SECRET_KEY') } });
}
function backupKey() { const key = Buffer.from(required('QMS_BACKUP_KEY'), 'base64'); if (key.length !== 32) throw new Error('BACKUP_KEY_INVALID'); return key; }
async function outsidePath(path) {
  if (!path || !isAbsolute(path)) throw new Error('ABSOLUTE_BACKUP_PATH_REQUIRED');
  const parent = await realpath(dirname(path));
  const relation = relative(workspace, parent);
  if (relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation)) throw new Error('BACKUP_MUST_BE_OUTSIDE_GIT');
  return resolve(parent, path.split(/[\\/]/).at(-1));
}
function checkedPostgresContainer() {
  const source = database();
  const container = required('QMS_BACKUP_POSTGRES_CONTAINER');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(container)) throw new Error('CONTAINER_INVALID');
  const inspected = spawnSync('docker', ['inspect', '--format', '{{json .NetworkSettings.Ports}}', container], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  if (inspected.status !== 0) throw new Error('DATABASE_CONTAINER_UNAVAILABLE');
  const bindings = JSON.parse(inspected.stdout)['5432/tcp'];
  const host = source.url.hostname === '[::1]' ? '::1' : source.url.hostname;
  if (!Array.isArray(bindings) || bindings.some((entry) => entry.HostPort === '55440') || !bindings.some((entry) => entry.HostPort === (source.url.port || '5432') && entry.HostIp === host)) throw new Error('DATABASE_CONTAINER_MISMATCH');
  return { source, container };
}
async function postgresCommand(command, args, input) {
  const { source, container } = checkedPostgresContainer();
  return new Promise((accept, reject) => {
    const child = spawn('docker', ['exec', '-i', '-e', 'PGPASSWORD', container, command, '--host=127.0.0.1', `--username=${source.username}`, `--dbname=${source.name}`, ...args], { env: { ...process.env, PGPASSWORD: source.password }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = []; let size = 0;
    child.stdout.on('data', (chunk) => { size += chunk.length; if (size > maximumBytes) child.kill(); else chunks.push(chunk); });
    child.stderr.resume();
    child.on('error', () => reject(new Error('POSTGRES_COMMAND_FAILED')));
    child.on('close', (code) => code === 0 && size <= maximumBytes ? accept(Buffer.concat(chunks)) : reject(new Error('POSTGRES_COMMAND_FAILED')));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
async function initializeBucket(client, bucket) {
  const retentionDays = Number(process.env.QMS_OBJECT_RETENTION_DAYS ?? 7);
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) throw new Error('OBJECT_RETENTION_INVALID');
  try { await client.send(new CreateBucketCommand({ Bucket: bucket, ObjectLockEnabledForBucket: true })); }
  catch (error) { if (error.name !== 'BucketAlreadyOwnedByYou') throw error; }
  if (process.env.QMS_OBJECT_STORAGE_PROVIDER === 's3') await client.send(new PutPublicAccessBlockCommand({ Bucket: bucket, PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true } }));
  await client.send(new PutBucketVersioningCommand({ Bucket: bucket, VersioningConfiguration: { Status: 'Enabled' } }));
  await client.send(new PutObjectLockConfigurationCommand({ Bucket: bucket, ObjectLockConfiguration: { ObjectLockEnabled: 'Enabled', Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Days: retentionDays } } } }));
  await client.send(new PutBucketPolicyCommand({ Bucket: bucket, Policy: JSON.stringify({ Version: '2012-10-17', Statement: [{ Sid: 'PreserveObjectVersions', Effect: 'Deny', Principal: '*', Action: ['s3:DeleteObject', 's3:DeleteObjectVersion'], Resource: `arn:aws:s3:::${bucket}/*` }] }) }));
}
async function objectSnapshot(client, bucket) {
  const objects = []; let keyMarker; let versionMarker; let size = 0;
  do {
    const page = await client.send(new ListObjectVersionsCommand({ Bucket: bucket, KeyMarker: keyMarker, VersionIdMarker: versionMarker }));
    if (page.DeleteMarkers?.length) throw new Error('DELETE_MARKERS_REQUIRE_RECONCILIATION');
    for (const entry of page.Versions ?? []) {
      if (!/^[a-f0-9-]{36}$/i.test(entry.Key ?? '') || !entry.VersionId) throw new Error('OBJECT_ID_INVALID');
      const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: entry.Key, VersionId: entry.VersionId }));
      const chunks = [];
      for await (const chunk of object.Body) {
        size += chunk.length;
        if (size > maximumBytes) { object.Body.destroy(); throw new Error('BACKUP_SIZE_LIMIT'); }
        chunks.push(Buffer.from(chunk));
      }
      const bytes = Buffer.concat(chunks);
      objects.push({ key: entry.Key, versionId: entry.VersionId, latest: entry.IsLatest, lastModified: entry.LastModified.toISOString(), contentType: object.ContentType, retainUntil: object.ObjectLockRetainUntilDate?.toISOString(), legalHold: object.ObjectLockLegalHoldStatus, sha256: hash(bytes), body: bytes.toString('base64') });
    }
    keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
    versionMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
  } while (keyMarker);
  return objects;
}
async function backup(path) {
  if (process.env.QMS_BACKUP_QUIESCED !== 'yes') throw new Error('QUIESCED_WRITERS_REQUIRED');
  const output = await outsidePath(path);
  const source = database(); const bucket = required('QMS_OBJECT_STORAGE_BUCKET');
  checkedPostgresContainer();
  const client = storage(); const connection = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await connection.connect(); await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const versioning = await client.send(new GetBucketVersioningCommand({ Bucket: bucket }));
    if (versioning.Status !== 'Enabled') throw new Error('BUCKET_VERSIONING_REQUIRED');
    const snapshot = (await connection.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
    const dump = await postgresCommand('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', `--snapshot=${snapshot}`]);
    const references = (await connection.query(referenceQuery)).rows;
    const migrations = (await connection.query('SELECT migration_name, checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name')).rows;
    const objects = await objectSnapshot(client, bucket); assertReferences(references, objects);
    const bundle = Buffer.from(JSON.stringify({ version: 2, sourceDatabase: source.name, sourceBucket: bucket, createdAt: new Date().toISOString(), migrations, references, dump: dump.toString('base64'), dumpSha256: hash(dump), objects }));
    if (bundle.length > maximumBytes * 2) throw new Error('BACKUP_SIZE_LIMIT');
    const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', backupKey(), nonce); cipher.setAAD(Buffer.from('QMS_BACKUP_V2'));
    const ciphertext = Buffer.concat([cipher.update(bundle), cipher.final()]);
    await writeFile(output, Buffer.concat([Buffer.from('QMSB2'), nonce, cipher.getAuthTag(), ciphertext]), { flag: 'wx', mode: 0o600 });
    await connection.query('COMMIT');
    console.info(JSON.stringify({ status: 'BACKUP_PASS', objects: objects.length, references: references.length, migrations: migrations.length }));
  } finally { await connection.end(); client.destroy(); }
}
async function readBundle(path) {
  const bytes = await readFile(await outsidePath(path));
  if (bytes.length > maximumBytes * 2 + 33 || bytes.subarray(0, 5).toString() !== 'QMSB2') throw new Error('BACKUP_FORMAT_INVALID');
  const decipher = createDecipheriv('aes-256-gcm', backupKey(), bytes.subarray(5, 17)); decipher.setAAD(Buffer.from('QMS_BACKUP_V2')); decipher.setAuthTag(bytes.subarray(17, 33));
  const bundle = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(33)), decipher.final()]).toString());
  if (bundle.version !== 2 || !Array.isArray(bundle.objects) || !Array.isArray(bundle.references) || !Array.isArray(bundle.migrations) || hash(Buffer.from(bundle.dump, 'base64')) !== bundle.dumpSha256) throw new Error('BACKUP_INTEGRITY_INVALID');
  for (const object of bundle.objects) if (!/^[a-f0-9-]{36}$/i.test(object.key) || !object.versionId || hash(Buffer.from(object.body, 'base64')) !== object.sha256) throw new Error('BACKUP_INTEGRITY_INVALID');
  assertReferences(bundle.references, bundle.objects);
  return bundle;
}
async function restore(path) {
  const bundle = await readBundle(path); const target = database(); const bucket = required('QMS_OBJECT_STORAGE_BUCKET');
  if (!/^qms_restore_[a-z0-9_]+$/.test(target.name) || target.name === bundle.sourceDatabase || process.env.QMS_RESTORE_CONFIRM !== target.name || bucket === bundle.sourceBucket) throw new Error('RESTORE_TARGET_FORBIDDEN');
  checkedPostgresContainer();
  const client = storage(); const connection = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await connection.connect();
    if ((await connection.query("SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema='public'")).rows[0].count !== 0) throw new Error('RESTORE_DATABASE_NOT_EMPTY');
    try { const existing = await client.send(new ListObjectVersionsCommand({ Bucket: bucket, MaxKeys: 1 })); if (existing.Versions?.length || existing.DeleteMarkers?.length) throw new Error('RESTORE_BUCKET_NOT_EMPTY'); }
    catch (error) { if (error.name !== 'NoSuchBucket') throw error; }
    await initializeBucket(client, bucket);
    const restored = [];
    for (const object of [...bundle.objects].sort((first, second) => first.lastModified.localeCompare(second.lastModified) || Number(first.latest) - Number(second.latest))) {
      const bytes = Buffer.from(object.body, 'base64');
      const retentionDate = object.retainUntil ? new Date(object.retainUntil) : undefined;
      const result = await client.send(new PutObjectCommand({ Bucket: bucket, Key: object.key, Body: bytes, ContentType: object.contentType,
        ...(retentionDate && retentionDate > new Date() ? { ObjectLockMode: 'COMPLIANCE', ObjectLockRetainUntilDate: retentionDate } : {}),
        ...(object.legalHold === 'ON' ? { ObjectLockLegalHoldStatus: 'ON' } : {}),
      }));
      if (!result.VersionId || result.VersionId === 'null') throw new Error('RESTORED_VERSION_MISSING');
      const fetched = await client.send(new GetObjectCommand({ Bucket: bucket, Key: object.key, VersionId: result.VersionId }));
      if (hash(Buffer.from(await fetched.Body.transformToByteArray())) !== object.sha256) throw new Error('RESTORED_OBJECT_MISMATCH');
      restored.push({ ...object, restoredVersion: result.VersionId });
    }
    await postgresCommand('pg_restore', ['--exit-on-error', '--single-transaction', '--no-owner', '--no-privileges'], Buffer.from(bundle.dump, 'base64'));
    const references = (await connection.query(referenceQuery)).rows;
    const migrations = (await connection.query('SELECT migration_name, checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name')).rows;
    if (JSON.stringify(references) !== JSON.stringify(bundle.references) || JSON.stringify(migrations) !== JSON.stringify(bundle.migrations)) throw new Error('RESTORED_DATABASE_MISMATCH');
    const mappedReferences = restoredReferences(references, restored);
    await connection.query('BEGIN');
    try {
      for (const [position, reference] of references.entries()) {
        if (!reference.object_version_id) continue;
        const updated = await connection.query('UPDATE file_objects SET object_version_id = $1 WHERE id = $2 AND object_key = $3 AND object_version_id = $4', [mappedReferences[position].object_version_id, reference.id, reference.object_key, reference.object_version_id]);
        if (updated.rowCount !== 1) throw new Error('RESTORED_DATABASE_MISMATCH');
      }
      const actual = (await connection.query(referenceQuery)).rows;
      if (JSON.stringify(actual) !== JSON.stringify(mappedReferences)) throw new Error('RESTORED_DATABASE_MISMATCH');
      assertReferences(actual, await objectSnapshot(client, bucket));
      await connection.query('COMMIT');
    } catch (error) { await connection.query('ROLLBACK'); throw error; }
    console.info(JSON.stringify({ status: 'RESTORE_PASS', objects: restored.length, references: references.length, migrations: migrations.length }));
  } finally { await connection.end(); client.destroy(); }
}

try {
  const [command, path, ...extra] = process.argv.slice(2); if (extra.length) throw new Error('ARGUMENTS_INVALID');
  if (command === 'init-storage' && !path) { const client = storage(); try { await initializeBucket(client, required('QMS_OBJECT_STORAGE_BUCKET')); console.info('STORAGE_PROTECTION_PASS'); } finally { client.destroy(); } }
  else if (command === 'backup') await backup(path);
  else if (command === 'restore') await restore(path);
  else if (command === 'verify') { const bundle = await readBundle(path); console.info(JSON.stringify({ status: 'BACKUP_INTEGRITY_PASS', objects: bundle.objects.length })); }
  else throw new Error('ARGUMENTS_INVALID');
} catch (error) { console.error(/^[A-Z][A-Z0-9_]+$/.test(error.message ?? '') ? error.message : `DATA_PROTECTION_FAILED ${/^[A-Za-z0-9]+$/.test(error.name ?? '') ? error.name : 'Error'} ${error.$metadata?.httpStatusCode ?? ''}`); process.exitCode = 1; }
