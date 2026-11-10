import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { PrismaService } from '../../dist/database/prisma.service.js';
import { encryptSecret, decryptSecret } from '../../dist/common/security/security-keyring.js';
import { AdminMutationService } from '../../dist/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../dist/modules/audit-log/audit-log.service.js';
import { IntegrationCredentialService } from '../../dist/modules/api-integration/integration-credential.service.js';

if (!process.env.DATABASE_URL) throw new Error('Disposable PostgreSQL is required');
const originalUrl = new URL(process.env.DATABASE_URL);
const isLoopback = originalUrl.hostname === '127.0.0.1' || originalUrl.hostname === '[::1]';
if (process.env.QMS_ACCEPTANCE_DISPOSABLE_DATABASE !== 'true' || !isLoopback || originalUrl.port === '55440' || originalUrl.search || originalUrl.hash) {
  throw new Error('Explicitly disposable loopback PostgreSQL other than 55440 is required');
}
const database = `qms_rotation_${randomUUID().replaceAll('-', '')}`;
const databaseUrl = new URL(originalUrl); databaseUrl.pathname = database;
const oldKey = randomBytes(32).toString('base64');
const newKey = randomBytes(32).toString('base64');
process.env.QMS_SECURITY_CURRENT_KEY_ID = 'old';
process.env.QMS_SECURITY_KEYRING = JSON.stringify({ old: oldKey });

await test('real database encryption rotation and idempotent replay', async (suite) => {
  const admin = new pg.Client({ connectionString: originalUrl.toString() });
  const prisma = new PrismaService(databaseUrl.toString());
  let adminConnected = false;
  try {
    await admin.connect(); adminConnected = true; await admin.query(`CREATE DATABASE "${database}"`);
    const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: databaseUrl.toString() }, encoding: 'utf8', windowsHide: true });
    assert.equal(migration.status, 0, migration.stderr);
    await prisma.$connect();
    const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'Rotation', type: 'INTERNAL' } });
    const user = await prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), passwordHash: 'fixture-unused', accountType: 'INTERNAL', email: 'rotation@example.test' } });
    const session = await prisma.session.create({ data: { userId: user.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000), mfaVerifiedAt: new Date(), reauthenticatedAt: new Date() } });
    const permission = await prisma.permission.create({ data: { code: 'rotation:exercise', name: 'Rotation exercise' } });
    const role = await prisma.role.create({ data: { organizationId: organization.id, code: 'ROTATION', name: 'Rotation', permissions: { create: { permissionId: permission.id } } } });
    await prisma.userRole.create({ data: { userId: user.id, organizationId: organization.id, roleId: role.id } });
    for (const code of ['integration:manage', 'integration:credentials:manage']) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { code } });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    const context = `mfa:${user.id}`;
    await prisma.mfaCredential.create({ data: { userId: user.id, encryptedSecret: encryptSecret('active-totp-secret', context), pendingSecret: encryptSecret('pending-totp-secret', context) } });
    const artifactId = randomUUID(); const exportContext = `export:${artifactId}:${organization.id}:${user.id}`;
    await prisma.exportArtifact.create({ data: { id: artifactId, organizationId: organization.id, createdById: user.id, ciphertext: encryptSecret('private-export-content', exportContext), rowCount: 1, expiresAt: new Date(Date.now() + 600000) } });
    const verification = await prisma.emailVerification.create({ data: { userId: user.id, purpose: 'VERIFY_EMAIL', email: user.email, securityVersion: 1, tokenHash: randomBytes(32).toString('hex'), expiresAt: new Date(Date.now() + 600000) } });
    const deliveryId = randomUUID(); const mailContext = `recovery-mail:${deliveryId}`;
    await prisma.recoveryDelivery.create({ data: { id: deliveryId, verificationId: verification.id, keyId: 'old', encryptedPayload: encryptSecret('private-mail-payload', mailContext) } });
    const endpoint = await prisma.integrationEndpoint.create({ data: { organizationId: organization.id, code: 'rotation-receiver', name: 'Rotation receiver', sourceCode: 'ROTATION', sourceName: 'Rotation fixture' } });
    const machineId = randomUUID(), machineSecret = randomBytes(32).toString('base64url');
    const machineContext = `integration-credential:${organization.id}:${endpoint.id}:${machineId}`;
    const machineCredential = await prisma.integrationCredential.create({ data: { id: machineId, organizationId: organization.id, endpointId: endpoint.id, name: 'Rotation machine', secretHash: createHash('sha256').update(machineSecret).digest('hex'), secretCiphertext: encryptSecret(machineSecret, machineContext), expiresAt: null } });
    const legacy = await prisma.integrationCredential.create({ data: { organizationId: organization.id, endpointId: endpoint.id, name: 'Legacy machine', secretHash: '0'.repeat(64), expiresAt: new Date(Date.now() + 3600000) } });
    const receiptId = randomUUID(), receiptContext = `integration:${organization.id}:${endpoint.id}:${receiptId}`;
    const payloadCiphertext = encryptSecret('private-machine-payload', receiptContext);
    const payloadBytes = Buffer.byteLength(payloadCiphertext);
    await prisma.integrationReceipt.create({ data: { id: receiptId, organizationId: organization.id, endpointId: endpoint.id, credentialId: machineCredential.id, messageId: receiptId, configurationVersion: 1, configurationSnapshot: {}, bodyExpiresAt: new Date(Date.now() + 3600000), metadataExpiresAt: new Date(Date.now() + 90 * 86400000), payloadCiphertext, payloadBytes } });
    await prisma.integrationEndpoint.update({ where: { id: endpoint.id }, data: { usedBodyBytes: payloadBytes } });
    await prisma.integrationScopeCapacity.create({ data: { organizationId: organization.id, usedBodyBytes: payloadBytes, receiptCount: 1 } });
    const mutation = new AdminMutationService(prisma, new AuditLogService(prisma));
    const input = { actor: { id: user.id, organizationId: organization.id, sessionId: session.id, accountType: 'INTERNAL' }, organizationId: organization.id, permission: permission.code, key: randomUUID(), payload: { value: 'stable' }, action: 'ROTATION_EXERCISE', traceId: randomUUID() };
    let workCount = 0;
    await mutation.run(input, async () => ({ sequence: ++workCount }));
    await suite.test('retained keys replay old receipts without executing writes twice', async () => {
      process.env.QMS_SECURITY_CURRENT_KEY_ID = 'new';
      process.env.QMS_SECURITY_KEYRING = JSON.stringify({ old: oldKey, new: newKey });
      assert.deepEqual(await mutation.run(input, async () => ({ sequence: ++workCount })), { sequence: 1 });
      assert.equal(workCount, 1);
      await assert.rejects(mutation.run({ ...input, payload: { value: 'different' } }, async () => ({})), (error) => error.getStatus() === 409);
    });
    await suite.test('CLI reencrypts MFA, exports, mail, received messages and permanent machine credentials using the new key', async () => {
      const rotated = spawnSync(process.execPath, ['dist/rotate-security-keys.js', '--reencrypt'], { env: { ...process.env, DATABASE_URL: databaseUrl.toString() }, encoding: 'utf8', windowsHide: true });
      assert.equal(rotated.status, 0, rotated.stderr); assert.match(rotated.stdout, /KEY_ROTATION_REENCRYPTED 5/);
      process.env.QMS_SECURITY_KEYRING = JSON.stringify({ new: newKey });
      const credential = await prisma.mfaCredential.findUniqueOrThrow({ where: { userId: user.id } });
      assert.equal(decryptSecret(credential.encryptedSecret, context), 'active-totp-secret');
      assert.equal(decryptSecret(credential.pendingSecret, context), 'pending-totp-secret');
      const artifact = await prisma.exportArtifact.findUniqueOrThrow({ where: { id: artifactId } });
      assert.equal(decryptSecret(artifact.ciphertext, exportContext), 'private-export-content');
      const delivery = await prisma.recoveryDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
      assert.equal(delivery.keyId, 'new'); assert.equal(decryptSecret(delivery.encryptedPayload, mailContext), 'private-mail-payload');
      const receipt = await prisma.integrationReceipt.findUniqueOrThrow({ where: { id: receiptId } });
      assert.equal(decryptSecret(receipt.payloadCiphertext, receiptContext), 'private-machine-payload');
      assert.equal(receipt.bodyDigest, null); assert.equal(receipt.messageId, receiptId);
      const machine = await prisma.integrationCredential.findUniqueOrThrow({ where: { id: machineId } });
      assert.equal(machine.expiresAt, null);
      assert.equal(decryptSecret(machine.secretCiphertext, machineContext), machineSecret);
      const connection = await new IntegrationCredentialService(prisma, mutation, new AuditLogService(prisma)).connection(input.actor, endpoint.id, machineId, randomUUID());
      assert.equal(connection.authorization === `Bearer ${machineId}.${machineSecret}`, true);
      const finite = await prisma.integrationCredential.findUniqueOrThrow({ where: { id: legacy.id } });
      assert.equal(finite.expiresAt.toISOString(), legacy.expiresAt.toISOString()); assert.equal(finite.secretCiphertext, null);
      assert.equal(receipt.payloadBytes, Buffer.byteLength(receipt.payloadCiphertext));
      const receiver = await prisma.integrationEndpoint.findUniqueOrThrow({ where: { id: endpoint.id } });
      const capacity = await prisma.integrationScopeCapacity.findUniqueOrThrow({ where: { organizationId: organization.id } });
      assert.equal(Number(receiver.usedBodyBytes), receipt.payloadBytes);
      assert.equal(Number(capacity.usedBodyBytes), receipt.payloadBytes);
      assert.equal(capacity.receiptCount, 1);
      assert.equal(await prisma.auditEvent.count({ where: { action: 'SECURITY_KEYS_REENCRYPTED' } }), 1);
      process.env.QMS_SECURITY_KEYRING = JSON.stringify({ old: oldKey, new: newKey });
      assert.deepEqual(await mutation.run(input, async () => ({ sequence: ++workCount })), { sequence: 1 });
    });
    await suite.test('keeps message capacity accurate when a new key identifier changes envelope size', async () => {
      const previousReceipt = await prisma.integrationReceipt.findUniqueOrThrow({ where: { id: receiptId } });
      const longerKey = randomBytes(32).toString('base64');
      process.env.QMS_SECURITY_CURRENT_KEY_ID = 'longer-integration-key';
      process.env.QMS_SECURITY_KEYRING = JSON.stringify({ old: oldKey, new: newKey, 'longer-integration-key': longerKey });
      const rotated = spawnSync(process.execPath, ['dist/rotate-security-keys.js', '--reencrypt'], { env: { ...process.env, DATABASE_URL: databaseUrl.toString() }, encoding: 'utf8', windowsHide: true });
      assert.equal(rotated.status, 0, rotated.stderr);
      process.env.QMS_SECURITY_KEYRING = JSON.stringify({ 'longer-integration-key': longerKey });
      const receipt = await prisma.integrationReceipt.findUniqueOrThrow({ where: { id: receiptId } });
      assert.equal(decryptSecret(receipt.payloadCiphertext, receiptContext), 'private-machine-payload');
      assert.ok(receipt.payloadBytes > previousReceipt.payloadBytes);
      assert.equal(receipt.payloadBytes, Buffer.byteLength(receipt.payloadCiphertext));
      assert.equal(Number((await prisma.integrationEndpoint.findUniqueOrThrow({ where: { id: endpoint.id } })).usedBodyBytes), receipt.payloadBytes);
      const capacity = await prisma.integrationScopeCapacity.findUniqueOrThrow({ where: { organizationId: organization.id } });
      assert.equal(Number(capacity.usedBodyBytes), receipt.payloadBytes);
      assert.equal(capacity.receiptCount, 1);
      assert.equal(await prisma.auditEvent.count({ where: { action: 'SECURITY_KEYS_REENCRYPTED' } }), 2);
    });
    await suite.test('missing retired keys fail closed and do not report success', async () => {
      await prisma.mfaCredential.update({ where: { userId: user.id }, data: { encryptedSecret: JSON.stringify({ version: 1, keyId: 'unavailable', nonce: '', tag: '', ciphertext: '' }) } });
      const rejected = spawnSync(process.execPath, ['dist/rotate-security-keys.js', '--reencrypt'], { env: { ...process.env, DATABASE_URL: databaseUrl.toString() }, encoding: 'utf8', windowsHide: true });
      assert.notEqual(rejected.status, 0); assert.match(rejected.stderr, /KEY_ROTATION_FAILED/);
      assert.equal(await prisma.auditEvent.count({ where: { action: 'SECURITY_KEYS_REENCRYPTED' } }), 2);
    });
  } finally {
    await prisma.$disconnect();
    if (adminConnected) {
      try { await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`); }
      finally { await admin.end(); }
    }
  }
});
