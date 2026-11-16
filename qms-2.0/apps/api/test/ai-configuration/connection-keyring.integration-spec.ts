import 'reflect-metadata';
import { expect, it } from '@jest/globals';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Client } from 'pg';
import { PrismaService } from '../../src/database/prisma.service.js';
import { decryptSecret, encryptSecret } from '../../src/common/security/security-keyring.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) throw new Error('AI rotation requires disposable loopback PostgreSQL; preview 55440 forbidden');

it('re-encrypts an AI channel through the actual existing keyring CLI and preserves its version', async () => {
  const source = new URL(process.env.DATABASE_URL!);
  const databaseName = `qms_ai_rotation_${randomUUID().replaceAll('-', '')}`;
  if (!/^qms_ai_rotation_[a-f0-9]{32}$/.test(databaseName) || source.pathname === `/${databaseName}`) throw new Error('Disposable rotation database identity invalid');
  const target = new URL(source); target.pathname = `/${databaseName}`;
  const admin = new Client({ connectionString: source.toString() });
  const original = { id: process.env.QMS_SECURITY_CURRENT_KEY_ID, ring: process.env.QMS_SECURITY_KEYRING };
  const oldKey = randomBytes(32).toString('base64'), newKey = randomBytes(32).toString('base64');
  let prisma: PrismaService | undefined;
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    const env = { ...process.env, DATABASE_URL: target.toString(), NODE_ENV: 'test' };
    const migrated = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: process.cwd(), env, encoding: 'utf8', windowsHide: true, timeout: 45000 });
    expect({ status: migrated.status, error: migrated.error?.message }).toEqual({ status: 0, error: undefined });
    prisma = new PrismaService(target.toString()); await prisma.$connect();
    const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'AI rotation disposable', type: 'INTERNAL' } });
    const id = randomUUID(), secret = 'rotation-disposable-only', context = `ai-connection:${organization.id}:${id}:https://model.example`;
    process.env.QMS_SECURITY_CURRENT_KEY_ID = 'old'; process.env.QMS_SECURITY_KEYRING = JSON.stringify({ old: oldKey });
    const ciphertext = encryptSecret(secret, context);
    await prisma.$executeRaw`INSERT INTO ai_connections (id,organization_id,name,base_url,models,default_model,enabled,secret_ciphertext) VALUES (${id}::uuid,${organization.id}::uuid,'rotation','https://model.example/v1',ARRAY['model-a'],'model-a',true,${ciphertext})`;
    const rotated = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/rotate-security-keys.ts', '--reencrypt'], { cwd: process.cwd(),
      env: { ...env, QMS_SECURITY_CURRENT_KEY_ID: 'new', QMS_SECURITY_KEYRING: JSON.stringify({ old: oldKey, new: newKey }) }, encoding: 'utf8', windowsHide: true, timeout: 20000 });
    expect({ status: rotated.status, stderr: rotated.stderr, error: rotated.error?.message }).toEqual({ status: 0, stderr: '', error: undefined });
    expect(rotated.stdout).not.toContain(secret);
    const [row] = await prisma.$queryRaw<Array<{ secret_ciphertext: string; version: number; enabled: boolean }>>`SELECT secret_ciphertext,version,enabled FROM ai_connections WHERE id=${id}::uuid`;
    expect(row).toMatchObject({ version: 1, enabled: true });
    expect(JSON.parse(row!.secret_ciphertext).keyId).toBe('new');
    process.env.QMS_SECURITY_CURRENT_KEY_ID = 'new'; process.env.QMS_SECURITY_KEYRING = JSON.stringify({ new: newKey });
    expect(decryptSecret(row!.secret_ciphertext, context)).toBe(secret);
  } finally {
    await prisma?.$disconnect();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
    if (original.id === undefined) delete process.env.QMS_SECURITY_CURRENT_KEY_ID; else process.env.QMS_SECURITY_CURRENT_KEY_ID = original.id;
    if (original.ring === undefined) delete process.env.QMS_SECURITY_KEYRING; else process.env.QMS_SECURITY_KEYRING = original.ring;
  }
}, 75000);
