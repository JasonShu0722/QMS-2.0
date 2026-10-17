import 'reflect-metadata';
import { PrismaService } from './database/prisma.service.js';
import { encryptSecret, decryptSecret } from './common/security/security-keyring.js';

async function rotate() {
  if (process.argv.slice(2).join(' ') !== '--reencrypt') throw new Error('KEY_ROTATION_ARGUMENT_REQUIRED');
  if (!process.env.DATABASE_URL || !process.env.QMS_SECURITY_CURRENT_KEY_ID || !process.env.QMS_SECURITY_KEYRING) throw new Error('KEY_ROTATION_CONFIGURATION_REQUIRED');
  const prisma = new PrismaService();
  let count = 0;
  try {
    await prisma.$connect();
    let userCursor: string | undefined;
    while (true) {
      const rows = await prisma.mfaCredential.findMany({ take: 100, orderBy: { userId: 'asc' }, ...(userCursor ? { where: { userId: { gt: userCursor } } } : {}) });
      for (const row of rows) {
        await prisma.$transaction(async (transaction) => {
          await transaction.$queryRaw`SELECT id FROM users WHERE id = ${row.userId}::uuid FOR UPDATE`;
          const current = await transaction.mfaCredential.findUnique({ where: { userId: row.userId } });
          if (!current) return;
          await transaction.mfaCredential.update({ where: { userId: row.userId }, data: {
            encryptedSecret: current.encryptedSecret ? encryptSecret(decryptSecret(current.encryptedSecret, `mfa:${row.userId}`), `mfa:${row.userId}`) : null,
            pendingSecret: current.pendingSecret ? encryptSecret(decryptSecret(current.pendingSecret, `mfa:${row.userId}`), `mfa:${row.userId}`) : null,
          } });
        });
        count += 1;
      }
      if (rows.length < 100) break;
      userCursor = rows.at(-1)!.userId;
    }
    let exportCursor: string | undefined;
    let temporaryCursor: string | undefined;
    while (true) {
      const rows = await prisma.userTemporaryPassword.findMany({ take: 100, orderBy: { userId: 'asc' }, ...(temporaryCursor ? { where: { userId: { gt: temporaryCursor } } } : {}) });
      for (const row of rows) {
        await prisma.$transaction(async (transaction) => {
          await transaction.$queryRaw`SELECT id FROM users WHERE id = ${row.userId}::uuid FOR UPDATE`;
          const current = await transaction.userTemporaryPassword.findUnique({ where: { userId: row.userId } });
          if (!current) return;
          const context = `temporary-password:${current.userId}:${current.credentialVersion}`;
          await transaction.userTemporaryPassword.update({ where: { userId: current.userId }, data: { encryptedValue: encryptSecret(decryptSecret(current.encryptedValue, context), context) } });
        });
        count += 1;
      }
      if (rows.length < 100) break;
      temporaryCursor = rows.at(-1)!.userId;
    }
    while (true) {
      const rows = await prisma.exportArtifact.findMany({ where: { ciphertext: { not: null }, ...(exportCursor ? { id: { gt: exportCursor } } : {}) }, orderBy: { id: 'asc' }, take: 100 });
      for (const row of rows) {
        const context = `export:${row.id}:${row.organizationId}:${row.createdById}`;
        const ciphertext = encryptSecret(decryptSecret(row.ciphertext!, context), context);
        await prisma.exportArtifact.updateMany({ where: { id: row.id, ciphertext: row.ciphertext }, data: { ciphertext } });
        count += 1;
      }
      if (rows.length < 100) break;
      exportCursor = rows.at(-1)!.id;
    }
    let mailCursor: string | undefined;
    while (true) {
      const rows = await prisma.recoveryDelivery.findMany({ where: { encryptedPayload: { not: null }, ...(mailCursor ? { id: { gt: mailCursor } } : {}) }, orderBy: { id: 'asc' }, take: 100 });
      for (const row of rows) {
        const context = `recovery-mail:${row.id}`;
        const encryptedPayload = encryptSecret(decryptSecret(row.encryptedPayload!, context), context);
        await prisma.recoveryDelivery.updateMany({ where: { id: row.id, encryptedPayload: row.encryptedPayload }, data: { encryptedPayload, keyId: (JSON.parse(encryptedPayload) as { keyId: string }).keyId } });
        count += 1;
      }
      if (rows.length < 100) break;
      mailCursor = rows.at(-1)!.id;
    }
    await prisma.auditEvent.create({ data: { action: 'SECURITY_KEYS_REENCRYPTED', resourceType: 'SecurityKeyring', outcome: 'SUCCESS', traceId: process.env.QMS_SECURITY_CURRENT_KEY_ID, metadata: { status: 'COMPLETE' } } });
    console.info(`KEY_ROTATION_REENCRYPTED ${count}`);
  } finally { await prisma.$disconnect(); }
}

void rotate().catch(() => { console.error('KEY_ROTATION_FAILED'); process.exitCode = 1; });
