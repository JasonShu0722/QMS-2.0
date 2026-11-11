import 'reflect-metadata';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Client } from 'pg';
import request from 'supertest';
import { jest } from '@jest/globals';
import { AppModule } from '../../src/app.module.js';
import { configureHttpBodyParser } from '../../src/http-body-parser.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { IntegrationRetentionService } from '../../src/modules/api-integration/integration-retention.service.js';
import { IntegrationLifecycleEffect } from '../../src/modules/api-integration/integration-lifecycle.effect.js';
import { IntegrationReceiptService } from '../../src/modules/api-integration/integration-receipt.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { encryptSecret } from '../../src/common/security/security-keyring.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (!isDisposableLoopbackPostgres(process.env.DATABASE_URL) || process.env.QMS_DISPOSABLE_TEST_DB!=='true') throw new Error('Retention requires disposable PostgreSQL.');

describe('real integration retention, bounded results and administrative lifecycle', () => {
  let app: NestExpressApplication, prisma: PrismaService;
  const scopes: string[] = [];
  const retainedScopes = new Set<string>();
  beforeAll(async () => {
    app=(await Test.createTestingModule({imports:[AppModule]}).compile()).createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureHttpBodyParser(app);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init(); prisma=app.get(PrismaService);
  });
  afterAll(async () => {
    if (prisma) {
      const cleanableScopes = scopes.filter(scope => !retainedScopes.has(scope));
      const where={organizationId:{in:cleanableScopes}};
      await prisma.dataExchangeAttempt.deleteMany({ where: { scopeKey: { in: cleanableScopes } } });
      await prisma.auditEvent.deleteMany({ where });
      await prisma.integrationRequestAttempt.deleteMany({where}); await prisma.integrationReceipt.deleteMany({where});
      await prisma.integrationRateWindow.deleteMany({where:{endpoint:{organizationId:{in:cleanableScopes}}}}); await prisma.integrationCredential.deleteMany({where});
      await prisma.integrationEndpoint.deleteMany({where}); await prisma.integrationScopeCapacity.deleteMany({where}); await prisma.organization.deleteMany({where:{id:{in:cleanableScopes}}});
    }
    await app?.close();
  });
  async function fixture() {
    const organization=await prisma.organization.create({data:{code:randomUUID(),name:'Retention fixture',type:'INTERNAL'}}); scopes.push(organization.id);
    const endpoint=await prisma.integrationEndpoint.create({data:{organizationId:organization.id,code:randomUUID(),name:'Retention endpoint',sourceCode:'INTERNAL',sourceName:'Private',status:'ENABLED',usedBodyBytes:12}});
    const secret = randomBytes(32).toString('base64url');
    const credential=await prisma.integrationCredential.create({data:{organizationId:organization.id,endpointId:endpoint.id,name:'Private',secretHash:createHash('sha256').update(secret).digest('hex'),expiresAt:new Date(Date.now()+86400000)}});
    await prisma.integrationScopeCapacity.create({data:{organizationId:organization.id,usedBodyBytes:12,receiptCount:1}});
    const receipt=await prisma.integrationReceipt.create({data:{organizationId:organization.id,endpointId:endpoint.id,credentialId:credential.id,messageId:randomUUID(),bodyDigest:'b'.repeat(64),configurationVersion:1,configurationSnapshot:{returnReceipt:true},bodyExpiresAt:new Date(Date.now()-1000),metadataExpiresAt:new Date(Date.now()+86400000),payloadCiphertext:'private-test',payloadBytes:12}});
    return {organization,endpoint,credential,receipt,authorization:`Bearer ${credential.id}.${secret}`};
  }
  it('purges expired ciphertext and releases exact capacity while preserving deduplication metadata', async () => {
    const item=await fixture();
    await app.get(IntegrationRetentionService).purgeExpired();
    expect((await prisma.integrationReceipt.findUniqueOrThrow({where:{id:item.receipt.id}})).payloadCiphertext).toBeNull();
    expect((await prisma.integrationEndpoint.findUniqueOrThrow({where:{id:item.endpoint.id}})).usedBodyBytes).toBe(0n);
    expect(await prisma.integrationScopeCapacity.findUniqueOrThrow({where:{organizationId:item.organization.id}})).toMatchObject({usedBodyBytes:0n,receiptCount:1,lastCleanupSucceededAt:expect.any(Date)});
    await app.get(IntegrationRetentionService).purgeExpired();
    expect((await prisma.integrationScopeCapacity.findUniqueOrThrow({where:{organizationId:item.organization.id}})).usedBodyBytes).toBe(0n);
  });
  it('removes expired metadata and count even when its body was already removed', async () => {
    const item=await fixture();
    await app.get(IntegrationRetentionService).purgeExpired();
    await prisma.integrationReceipt.update({where:{id:item.receipt.id},data:{metadataExpiresAt:new Date(Date.now()-1000)}});
    await app.get(IntegrationRetentionService).purgeExpired();
    expect(await prisma.integrationReceipt.findUnique({where:{id:item.receipt.id}})).toBeNull();
    expect(await prisma.integrationScopeCapacity.findUniqueOrThrow({where:{organizationId:item.organization.id}})).toMatchObject({usedBodyBytes:0n,receiptCount:0});
  });
  it('cleans retained data for disabled organizations without treating them as active users', async () => {
    const item=await fixture(); await prisma.organization.update({where:{id:item.organization.id},data:{status:'DISABLED'}});
    await app.get(IntegrationRetentionService).purgeExpired();
    expect((await prisma.integrationReceipt.findUniqueOrThrow({where:{id:item.receipt.id}})).payloadCiphertext).toBeNull();
  });
  it('limits each cleanup run to ten batches of one hundred receipt bodies', async () => {
    const retention = app.get(IntegrationRetentionService);
    await retention.purgeExpired();
    const item = await fixture();
    await prisma.$executeRaw`INSERT INTO integration_receipts(id,organization_id,endpoint_id,credential_id,message_id,body_digest,configuration_version,configuration_snapshot,body_expires_at,metadata_expires_at,payload_ciphertext,payload_bytes)
      SELECT gen_random_uuid(),${item.organization.id}::uuid,${item.endpoint.id}::uuid,${item.credential.id}::uuid,gen_random_uuid()::text,${'b'.repeat(64)},1,'{}'::jsonb,clock_timestamp()-INTERVAL '1 second',clock_timestamp()+INTERVAL '1 day','private-test',12 FROM generate_series(1,1000)`;
    await prisma.integrationEndpoint.update({ where: { id: item.endpoint.id }, data: { usedBodyBytes: 12012 } });
    await prisma.integrationScopeCapacity.update({ where: { organizationId: item.organization.id }, data: { usedBodyBytes: 12012, receiptCount: 1001 } });
    const first = await retention.purgeExpired();
    expect(first.bodies).toBe(1000);
    expect(first.receipts).toBe(0);
    expect(await prisma.integrationReceipt.count({ where: { organizationId: item.organization.id, payloadCiphertext: { not: null } } })).toBe(1);
    expect((await prisma.integrationEndpoint.findUniqueOrThrow({ where: { id: item.endpoint.id } })).usedBodyBytes).toBe(12n);
    expect(await prisma.integrationScopeCapacity.findUniqueOrThrow({ where: { organizationId: item.organization.id } })).toMatchObject({ usedBodyBytes: 12n, receiptCount: 1001 });
    expect((await retention.purgeExpired()).bodies).toBe(1);
    expect((await prisma.integrationScopeCapacity.findUniqueOrThrow({ where: { organizationId: item.organization.id } })).usedBodyBytes).toBe(0n);
  });
  it('serializes cleanup and HTTP receiving on the organization lock without losing capacity', async () => {
    await app.get(IntegrationRetentionService).purgeExpired();
    const item = await fixture(), blocker = new Client({ connectionString: process.env.DATABASE_URL });
    await blocker.connect();
    const blockerPid = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
    let cleanup: ReturnType<IntegrationRetentionService['purgeExpired']> | undefined;
    let incoming: Promise<request.Response> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [item.organization.id]);
      cleanup = app.get(IntegrationRetentionService).purgeExpired();
      const firstDeadline = Date.now() + 5000;
      let firstWaiting = false;
      while (Date.now() < firstDeadline && !firstWaiting) {
        const [activity] = await prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND ${blockerPid}=ANY(pg_blocking_pids(pid))`;
        firstWaiting = activity!.count >= 1;
        if (!firstWaiting) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(firstWaiting).toBe(true);
      incoming = request(app.getHttpServer()).post(`/api/v1/integrations/inbound/${item.endpoint.id}/messages`).set('Authorization', item.authorization)
        .set('Content-Type', 'application/json').set('Idempotency-Key', randomUUID()).send('[{"concurrent":true}]').then(response => response);
      const secondDeadline = Date.now() + 5000;
      let bothWaiting = false;
      while (Date.now() < secondDeadline && !bothWaiting) {
        const [activity] = await prisma.$queryRaw<{ count: number }[]>`WITH RECURSIVE blocked(pid) AS (
          SELECT ${blockerPid}::int
          UNION
          SELECT activity.pid FROM pg_stat_activity activity JOIN blocked parent ON parent.pid=ANY(pg_blocking_pids(activity.pid))
          WHERE activity.datname=current_database() AND activity.wait_event_type='Lock'
        ) SELECT count(*)::int AS count FROM blocked WHERE pid<>${blockerPid}`;
        bothWaiting = activity!.count >= 2;
        if (!bothWaiting) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(bothWaiting).toBe(true);
      await blocker.query('COMMIT');
      await cleanup;
      const response = await incoming;
      expect(response.status).toBe(201);
      const received = await prisma.integrationReceipt.findUniqueOrThrow({ where: { id: response.body.receiptId } });
      expect(received.payloadCiphertext).not.toBeNull();
      expect((await prisma.integrationReceipt.findUniqueOrThrow({ where: { id: item.receipt.id } })).payloadCiphertext).toBeNull();
      expect((await prisma.integrationEndpoint.findUniqueOrThrow({ where: { id: item.endpoint.id } })).usedBodyBytes).toBe(BigInt(received.payloadBytes));
      expect(await prisma.integrationScopeCapacity.findUniqueOrThrow({ where: { organizationId: item.organization.id } })).toMatchObject({ usedBodyBytes: BigInt(received.payloadBytes), receiptCount: 2 });
    } finally {
      await blocker.query('ROLLBACK'); await blocker.end();
      await cleanup; await incoming;
    }
  });
  it('records trusted request results with no secret and enforces the organization cap', async () => {
    const item=await fixture(), service=app.get(IntegrationReceiptService), traceId=randomUUID();
    await service.recordAttempt({traceId,organizationId:item.organization.id,endpointId:item.endpoint.id,credentialId:item.credential.id,messageId:'A'.repeat(128),configurationVersion:1,returnReceipt:false,statusCode:204,outcome:'RECEIVED',durationMs:1});
    await service.recordAttempt({traceId,organizationId:item.organization.id,endpointId:item.endpoint.id,credentialId:item.credential.id,messageId:'A'.repeat(128),configurationVersion:1,returnReceipt:false,statusCode:204,outcome:'RECEIVED',durationMs:1});
    expect(await prisma.integrationRequestAttempt.count({where:{organizationId:item.organization.id}})).toBe(1);
    await prisma.$executeRaw`INSERT INTO integration_request_attempts(id,organization_id,endpoint_id,credential_id,configuration_version,return_receipt,status_code,outcome,duration_ms)
      SELECT gen_random_uuid(),${item.organization.id}::uuid,${item.endpoint.id}::uuid,${item.credential.id}::uuid,1,false,204,'RECEIVED',1 FROM generate_series(1,9999)`;
    await service.recordAttempt({traceId:randomUUID(),organizationId:item.organization.id,endpointId:item.endpoint.id,credentialId:item.credential.id,configurationVersion:1,returnReceipt:false,statusCode:409,outcome:'REJECTED',reasonCode:'INTEGRATION_MESSAGE_CONFLICT',durationMs:1});
    expect(await prisma.integrationRequestAttempt.count({where:{organizationId:item.organization.id}})).toBeLessThanOrEqual(10000);
    await expect(service.recordAttempt({traceId:randomUUID(),organizationId:randomUUID(),endpointId:item.endpoint.id,credentialId:item.credential.id,configurationVersion:1,returnReceipt:false,statusCode:204,outcome:'RECEIVED',durationMs:1})).rejects.toMatchObject({status:403});
  });
  it('keeps department and user lifecycle operations from revoking machine credentials', async () => {
    const item=await fixture(), effect=app.get(IntegrationLifecycleEffect);
    for (const kind of ['USER','DEPARTMENT'] as const) {
      await prisma.$transaction(tx=>effect.apply(tx,{id:randomUUID(),organizationId:item.organization.id,accountType:'INTERNAL'}, {kind,entityId:randomUUID(),organizationId:item.organization.id,receiptOrganizationId:item.organization.id,userIds:[],departmentIds:[],positionIds:[],organizationIds:[]}));
    }
    expect((await prisma.integrationCredential.findUniqueOrThrow({where:{id:item.credential.id}})).revokedAt).toBeNull();
  });
  it('revokes machine access in the organization effect while preserving historical receipts', async () => {
    const item=await fixture(), effect=app.get(IntegrationLifecycleEffect);
    await prisma.$transaction(tx=>effect.apply(tx,{id:randomUUID(),organizationId:item.organization.id,accountType:'INTERNAL'}, {kind:'ORGANIZATION',entityId:item.organization.id,organizationId:item.organization.id,receiptOrganizationId:item.organization.id,userIds:[],departmentIds:[],positionIds:[],organizationIds:[item.organization.id]}));
    expect((await prisma.integrationEndpoint.findUniqueOrThrow({where:{id:item.endpoint.id}})).status).toBe('DISABLED');
    expect((await prisma.integrationCredential.findUniqueOrThrow({where:{id:item.credential.id}})).revokedAt).toEqual(expect.any(Date));
    expect(await prisma.integrationReceipt.findUnique({where:{id:item.receipt.id}})).not.toBeNull();
  });
  it('uses the real force-delete preview and command to revoke access while retaining original receipt ownership', async () => {
    const item = await fixture();
    const home = await prisma.organization.create({ data: { code: randomUUID(), name: 'Integration lifecycle administrator', type: 'INTERNAL' } });
    scopes.push(home.id); retainedScopes.add(home.id); retainedScopes.add(item.organization.id);
    await prisma.organization.update({ where: { id: item.organization.id }, data: { parentId: home.id } });
    const historyCiphertext = encryptSecret('{"retained":"history"}', `integration:${item.organization.id}:${item.endpoint.id}:${item.receipt.id}`);
    const historyBytes = Buffer.byteLength(historyCiphertext);
    await prisma.integrationReceipt.update({ where: { id: item.receipt.id }, data: { bodyExpiresAt: new Date(Date.now() + 86400000), payloadCiphertext: historyCiphertext, payloadBytes: historyBytes } });
    await prisma.integrationEndpoint.update({ where: { id: item.endpoint.id }, data: { usedBodyBytes: historyBytes } });
    await prisma.integrationScopeCapacity.update({ where: { organizationId: item.organization.id }, data: { usedBodyBytes: historyBytes } });
    const user = await prisma.user.create({ data: { organizationId: home.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'unused-lifecycle-test-hash' } });
    const permissions = await Promise.all(['platform:admin', 'organization:force-delete'].map(code => prisma.permission.upsert({ where: { code }, update: {}, create: { code, name: code } })));
    const role = await prisma.role.create({ data: { organizationId: home.id, code: randomUUID(), name: 'Scoped lifecycle authority', permissions: { create: permissions.map(permission => ({ permissionId: permission.id })) } } });
    await prisma.userRole.create({ data: { organizationId: home.id, userId: user.id, roleId: role.id } });
    const token = await app.get(SessionService).create(user.id, prisma, { mfaVerified: true, reauthenticated: true });
    const cookie = `qms_session=${token}; qms_csrf=lifecycle-fixture`;
    const path = `/api/v1/organizations/${item.organization.id}/force-delete`;
    const preview = await request(app.getHttpServer()).get(path).set('Cookie', cookie).expect(200);
    const confirmed = { expectedVersion: preview.body.version, confirmed: true, previewToken: preview.body.previewToken }, key = randomUUID();
    const removed = await request(app.getHttpServer()).post(path).set('Cookie', cookie).set('x-csrf-token', 'lifecycle-fixture').set('Idempotency-Key', key).send(confirmed).expect(201);
    expect(removed.body.effects).toContainEqual({ module: 'api-integration', changed: 2, pendingConfiguration: 0 });
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: item.organization.id } })).toMatchObject({ status: 'DISABLED', deletedAt: expect.any(Date) });
    expect(await prisma.integrationEndpoint.findUniqueOrThrow({ where: { id: item.endpoint.id } })).toMatchObject({ status: 'DISABLED', organizationId: item.organization.id, version: 2 });
    expect((await prisma.integrationCredential.findUniqueOrThrow({ where: { id: item.credential.id } })).revokedAt).toEqual(expect.any(Date));
    expect(await prisma.integrationReceipt.findUniqueOrThrow({ where: { id: item.receipt.id } })).toMatchObject({ organizationId: item.organization.id, endpointId: item.endpoint.id, payloadCiphertext: historyCiphertext, payloadBytes: historyBytes });
    await request(app.getHttpServer()).post(`/api/v1/integrations/inbound/${item.endpoint.id}/messages`).set('Authorization', item.authorization).set('Content-Type', 'application/json').set('Idempotency-Key', randomUUID()).send('{}').expect(401);
    const replay = await request(app.getHttpServer()).post(path).set('Cookie', cookie).set('x-csrf-token', 'lifecycle-fixture').set('Idempotency-Key', key).send(confirmed).expect(201);
    expect(replay.body).toEqual(removed.body);
    expect((await prisma.integrationEndpoint.findUniqueOrThrow({ where: { id: item.endpoint.id } })).version).toBe(2);
  });
});
