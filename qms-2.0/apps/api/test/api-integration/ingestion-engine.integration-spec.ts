import 'reflect-metadata';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AdminMutationService, type AdminActor } from '../../src/common/security/admin-mutation.service.js';
import { encryptSecret } from '../../src/common/security/security-keyring.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { IngestionService } from '../../src/modules/api-integration/ingestion.service.js';
import { IngestionWorkerService } from '../../src/modules/api-integration/ingestion-worker.service.js';
import { IngestionTargetsService } from '../../src/modules/api-integration/ingestion-targets.service.js';
import { InboundController } from '../../src/modules/api-integration/inbound.controller.js';
import { InboundService } from '../../src/modules/api-integration/inbound.service.js';
import { InboundGuard } from '../../src/modules/api-integration/inbound.guard.js';
import { IntegrationRetentionService } from '../../src/modules/api-integration/integration-retention.service.js';
import { IntegrationReceiptService } from '../../src/modules/api-integration/integration-receipt.service.js';
import { SupplierProfileIngestionAdapter } from '../../src/modules/supplier-quality/supplier-profile-ingestion.adapter.js';
import { CustomerMasterIngestionAdapter } from '../../src/modules/customer-quality/customer-master-ingestion.adapter.js';
import { MaterialMasterIngestionAdapter } from '../../src/modules/material-master/material-master-ingestion.adapter.js';
import { ComponentProjectIngestionAdapter } from '../../src/modules/platform-configuration/component-project-ingestion.adapter.js';
import type { IngestionFields, IngestionTarget } from '../../src/modules/api-integration/ingestion.policy.js';
import type { IngestionRuleDto, SaveIngestionRuleDto } from '../../src/modules/api-integration/ingestion.dto.js';
import { configureHttpBodyParser } from '../../src/http-body-parser.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (!isDisposableLoopbackPostgres(process.env.DATABASE_URL) || process.env.QMS_DISPOSABLE_TEST_DB !== 'true') throw new Error('Ingestion engine requires explicitly disposable real PostgreSQL.');

describe('durable API ingestion on real PostgreSQL and Worker', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let service: IngestionService;
  let worker: IngestionWorkerService;
  let targets: IngestionTargetsService;
  const trace = () => randomUUID();
  const key = () => randomUUID();
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [InboundController], providers: [PrismaService, AuditLogService, AdminMutationService, SessionService, IngestionService, IngestionWorkerService, IngestionTargetsService, SupplierProfileIngestionAdapter, CustomerMasterIngestionAdapter, MaterialMasterIngestionAdapter, ComponentProjectIngestionAdapter, InboundService, InboundGuard, IntegrationRetentionService, IntegrationReceiptService] }).compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureHttpBodyParser(app); app.useGlobalFilters(new GlobalExceptionFilter()); await app.init();
    prisma = app.get(PrismaService); service = app.get(IngestionService); worker = app.get(IngestionWorkerService); targets = app.get(IngestionTargetsService);
  });
  afterAll(async () => { await app?.close(); });

  async function fixture() {
    const organization = await prisma.organization.create({ data: { code: randomUUID(), name: '入库一次性验收组织', type: 'INTERNAL' } });
    const user = await prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), passwordHash: 'unused', accountType: 'INTERNAL' } });
    const permissions = await prisma.permission.findMany({ where: { code: { in: ['platform:admin', 'ingestion:read', 'ingestion:manage', 'ingestion:run', 'integration:read', 'integration:manage', 'integration:receipts:read', 'integration:payload:read', 'supplier-quality:profiles:write', 'customer-quality:complaints:write', 'material-master:write', 'component-project:manage'] } } });
    expect(permissions).toHaveLength(12);
    const role = await prisma.role.create({ data: { organizationId: organization.id, code: randomUUID(), name: '真实管理员测试角色', permissions: { create: permissions.map(permission => ({ permissionId: permission.id })) } } });
    await prisma.userRole.create({ data: { organizationId: organization.id, userId: user.id, roleId: role.id } });
    const token = await app.get(SessionService).create(user.id, prisma, { mfaVerified: true, reauthenticated: true });
    const session = await app.get(SessionService).resolve(token); expect(session).toBeTruthy();
    const actor: AdminActor = { id: user.id, organizationId: organization.id, accountType: 'INTERNAL', sessionId: session!.id };
    const endpoint = await prisma.integrationEndpoint.create({ data: { organizationId: organization.id, code: randomUUID(), name: '验收机器来源', sourceCode: 'TEST', sourceName: '实际机器接收', status: 'ENABLED' } });
    const secret = randomBytes(32).toString('base64url');
    const credential = await prisma.integrationCredential.create({ data: { organizationId: organization.id, endpointId: endpoint.id, name: '技术验收凭据', secretHash: createHash('sha256').update(secret).digest('hex'), expiresAt: new Date(Date.now() + 86400000) } });
    return { actor, organizationId: organization.id, endpointId: endpoint.id, userId: user.id, roleId: role.id, credentialId: credential.id, machineToken: `${credential.id}.${secret}` };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function rule(item: Fixture, target: IngestionTarget = 'MATERIAL', mode: SaveIngestionRuleDto['mode'] = 'UPDATE', enabled = true): Promise<IngestionRuleDto> {
    return service.saveRule(item.actor, { name: `验收${target}`, endpointId: item.endpointId, target, enabled, match: 'ALL', conditions: [], mapping: { code: 'code', name: 'name' }, mode, updateFields: ['name'] }, trace(), key());
  }
  async function received(item: Fixture, rows: unknown[], receivedAt = new Date()) {
    const id = randomUUID(), text = JSON.stringify(rows), ciphertext = encryptSecret(text, `integration:${item.organizationId}:${item.endpointId}:${id}`);
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`INSERT INTO integration_receipts(id,organization_id,endpoint_id,credential_id,message_id,configuration_version,configuration_snapshot,received_at,body_expires_at,metadata_expires_at,payload_ciphertext,payload_bytes) VALUES(${id}::uuid,${item.organizationId}::uuid,${item.endpointId}::uuid,${item.credentialId}::uuid,${id},1,'{}'::jsonb,${receivedAt},clock_timestamp()+interval '1 day',clock_timestamp()+interval '90 days',${ciphertext},${Buffer.byteLength(ciphertext)})`;
      await tx.$executeRaw`UPDATE integration_endpoints SET used_body_bytes=used_body_bytes+${Buffer.byteLength(ciphertext)} WHERE id=${item.endpointId}::uuid`;
      await tx.$executeRaw`INSERT INTO integration_scope_capacities(organization_id,used_body_bytes,receipt_count) VALUES(${item.organizationId}::uuid,${Buffer.byteLength(ciphertext)},1) ON CONFLICT(organization_id) DO UPDATE SET used_body_bytes=integration_scope_capacities.used_body_bytes+${Buffer.byteLength(ciphertext)},receipt_count=integration_scope_capacities.receipt_count+1`;
    });
    return id;
  }
  async function machine(item: Fixture, rows: unknown[]) {
    return request(app.getHttpServer()).post(`/api/v1/integrations/inbound/${item.endpointId}/messages`).set('Authorization', `Bearer ${item.machineToken}`).set('Content-Type', 'application/json').send(JSON.stringify(rows));
  }
  async function inspect(item: Fixture, target: IngestionTarget, code: string) { return prisma.$transaction(tx => targets.inspect(tx, item.actor, target, { code, name: '查询占位' })); }
  async function submitSingle(item: Fixture, configuration: IngestionRuleDto, receiptId: string, rowIndex = 0) {
    const preview = await service.preview(item.actor, { ruleId: configuration.id, ruleVersion: configuration.version, receiptId, rowIndex }, trace(), key());
    const result = await service.submitImport(item.actor, { previewId: preview.previewId, confirmed: true }, trace(), key());
    return { preview, result, jobId: result.jobIds[0]! };
  }

  it('previews without business writes, explicitly imports one row, and reuses repeated submissions', async () => {
    const item = await fixture(), configuration = await rule(item, 'MATERIAL', 'UPDATE', false);
    const receiptId = await received(item, [{ code: '001', name: '预览数据机密' }, { code: '002', name: '第二行' }]);
    const preview = await service.preview(item.actor, { ruleId: configuration.id, ruleVersion: 1, receiptId, rowIndex: 0 }, trace(), key());
    expect(preview).toMatchObject({ action: 'INSERTED', rowCount: 1, fields: { code: '001', name: '预览数据机密' } });
    expect(await inspect(item, 'MATERIAL', '001')).toBeNull();
    const previewMutations = await prisma.adminMutation.findMany({ where: { actorUserId: item.userId, action: 'INGESTION_PREVIEWED' } });
    expect(JSON.stringify(previewMutations)).not.toContain('预览数据机密');
    const result = await service.submitImport(item.actor, { previewId: preview.previewId, confirmed: true }, trace(), key());
    const duplicate = await service.submitImport(item.actor, { previewId: preview.previewId, confirmed: true }, trace(), key());
    expect(duplicate).toMatchObject({ jobIds: result.jobIds, reused: true });
    expect(await worker.processDue(10)).toBeGreaterThanOrEqual(1);
    expect((await inspect(item, 'MATERIAL', '001'))?.values.name).toBe('预览数据机密');
    expect(await inspect(item, 'MATERIAL', '002')).toBeNull();
    expect(await worker.processDue(10)).toBe(0);
  });

  it('atomically receives true and persists four target tasks, then serial workers do not double write', async () => {
    const item = await fixture();
    for (const target of ['SUPPLIER', 'CUSTOMER', 'MATERIAL', 'COMPONENT'] as const) await rule(item, target);
    const response = await machine(item, [{ code: '0007', name: '四目标同源' }]); expect(response.status).toBe(200); expect(response.body).toBe(true);
    expect((await service.listJobs(item.actor, {})).total).toBe(4);
    const handled = await Promise.all([worker.processDue(20), new IngestionWorkerService(service).processDue(20)]);
    expect(handled.reduce((sum, count) => sum + count, 0)).toBe(4);
    for (const target of ['SUPPLIER', 'CUSTOMER', 'MATERIAL', 'COMPONENT'] as const) expect(await inspect(item, target, '0007')).toMatchObject({ version: 1, values: { code: '0007', name: '四目标同源' } });
    expect((await service.listJobs(item.actor, {})).items.every(job => job.status === 'COMPLETED' && job.succeeded === 1)).toBe(true);
  });

  it('uses frozen rule versions and original array order with data failures that do not become false successes', async () => {
    const item = await fixture(), configuration = await rule(item);
    expect((await machine(item, [{ code: 'order', name: 'first' }, { code: 8, name: 'invalid' }, { code: 'order', name: 'last' }])).status).toBe(200);
    await service.saveRule(item.actor, { ...configuration, expectedVersion: 1, mapping: { code: 'other', name: 'otherName' } }, trace(), key(), configuration.id);
    await worker.processDue(10);
    expect((await inspect(item, 'MATERIAL', 'order'))?.values.name).toBe('last');
    const job = (await service.listJobs(item.actor, {})).items[0]!;
    expect(job).toMatchObject({ ruleVersion: 1, succeeded: 2, failed: 1, total: 3 });
    expect((await service.listItems(item.actor, job.id, {})).items.map(row => row.status)).toEqual(['INSERTED', 'VALIDATION_FAILED', 'UPDATED']);
  });

  it('preserves specified update fields, insertion-only and confirmation strategies', async () => {
    const item = await fixture(), configuration = await rule(item, 'MATERIAL', 'INSERT_ONLY');
    await machine(item, [{ code: 'strategy', name: 'original' }]); await worker.processDue(10);
    await machine(item, [{ code: 'strategy', name: 'ignored' }]); await worker.processDue(10);
    expect((await inspect(item, 'MATERIAL', 'strategy'))?.values.name).toBe('original');
    const pendingRule = await service.saveRule(item.actor, { ...configuration, expectedVersion: 1, mode: 'CONFIRM' }, trace(), key(), configuration.id);
    await machine(item, [{ code: 'strategy', name: 'confirmed' }]); await worker.processDue(10);
    const job = (await service.listJobs(item.actor, {})).items.find(candidate => candidate.ruleVersion === pendingRule.version)!;
    const waiting = (await service.listItems(item.actor, job.id, {})).items[0]!;
    expect(waiting.status).toBe('AWAITING_CONFIRMATION');
    const detail = await service.getItem(item.actor, waiting.id, trace()); expect(detail.differences).toEqual([{ field: 'name', before: 'original', after: 'confirmed' }]);
    await service.actOnItem(item.actor, waiting.id, { expectedVersion: waiting.version, reason: '核对来源后确认' }, true, trace(), key());
    expect((await inspect(item, 'MATERIAL', 'strategy'))?.values.name).toBe('confirmed');
  });

  it('does not let an older manual result overwrite a later receipt and keeps waiting input through retention', async () => {
    const item = await fixture(), configuration = await rule(item, 'MATERIAL', 'CONFIRM');
    await machine(item, [{ code: 'late', name: 'baseline' }]); await worker.processDue(10);
    await machine(item, [{ code: 'late', name: 'older pending' }]); await worker.processDue(10);
    const older = (await service.listJobs(item.actor, {})).items.find(job => job.awaitingConfirmation === 1)!;
    await service.saveRule(item.actor, { ...configuration, expectedVersion: 1, mode: 'UPDATE' }, trace(), key(), configuration.id);
    await machine(item, [{ code: 'late', name: 'newer accepted' }]); await worker.processDue(10);
    const pending = (await service.listItems(item.actor, older.id, {})).items[0]!;
    expect((await service.getItem(item.actor, pending.id, trace())).stale).toBe(true);
    await expect(service.actOnItem(item.actor, pending.id, { expectedVersion: pending.version, reason: '迟到确认' }, true, trace(), key())).rejects.toThrow('INGESTION_STALE_CONFIRMATION');
    await prisma.$executeRaw`UPDATE integration_receipts SET body_expires_at=clock_timestamp()-interval '1 day',metadata_expires_at=clock_timestamp()-interval '1 day' WHERE id=${older.receiptId}::uuid`;
    await app.get(IntegrationRetentionService).purgeExpired();
    expect((await prisma.integrationReceipt.findUnique({ where: { id: older.receiptId } }))?.payloadCiphertext).toBeTruthy();
    await expect(app.get(IntegrationReceiptService).deleteReceipts(item.actor, { receiptIds: [older.receiptId] }, trace(), key())).rejects.toThrow('INGESTION_INPUT_PROTECTED');
    await service.actOnItem(item.actor, pending.id, { expectedVersion: pending.version, reason: '旧来源已由后续事实替代' }, false, trace(), key());
    await app.get(IntegrationRetentionService).purgeExpired(); expect(await prisma.integrationReceipt.findUnique({ where: { id: older.receiptId } })).toBeNull();
  });

  it('uses fixed historical selections and protects existing new values when history has no source version', async () => {
    const item = await fixture(), configuration = await rule(item, 'MATERIAL', 'UPDATE', false);
    const receiptId = await received(item, [{ code: 'history', name: 'old history' }], new Date(Date.now() - 86400000));
    await prisma.$transaction(tx => targets.write(tx, item.actor, 'MATERIAL', { code: 'history', name: 'current' }, null, trace()));
    const preview = await service.previewHistory(item.actor, { ruleId: configuration.id, ruleVersion: 1, from: new Date(Date.now() - 2 * 86400000).toISOString(), to: new Date().toISOString() }, trace(), key());
    await received(item, [{ code: 'outside-window', name: 'later receipt' }], new Date(Date.now() + 1000));
    const imported = await service.submitImport(item.actor, { previewId: preview.previewId, confirmed: true }, trace(), key());
    expect(imported).toMatchObject({ receiptCount: 1, rowCount: 1 }); await worker.processDue(10);
    expect((await inspect(item, 'MATERIAL', 'history'))?.values.name).toBe('current');
    expect(await inspect(item, 'MATERIAL', 'outside-window')).toBeNull();
    const job = await service.getJob(item.actor, imported.jobIds[0]!); expect(job).toMatchObject({ receiptId, awaitingConfirmation: 1 });
    await service.controlJob(item.actor, job.id, { action: 'CANCEL', reason: '验收结束' }, trace(), key());
  });

  it('pauses at transaction boundaries, resumes original order and cancels only unfinished work', async () => {
    const item = await fixture(); await rule(item);
    await machine(item, [{ code: 'pause', name: 'one' }, { code: 'pause', name: 'two' }]);
    const job = (await service.listJobs(item.actor, {})).items[0]!;
    await service.controlJob(item.actor, job.id, { action: 'PAUSE', reason: '暂停检查' }, trace(), key()); expect(await worker.processDue(10)).toBe(0);
    await service.controlJob(item.actor, job.id, { action: 'RESUME', reason: '恢复' }, trace(), key()); expect(await worker.processDue(1)).toBe(1);
    await service.controlJob(item.actor, job.id, { action: 'CANCEL', reason: '取消剩余' }, trace(), key());
    expect((await inspect(item, 'MATERIAL', 'pause'))?.values.name).toBe('one');
    expect((await service.listItems(item.actor, job.id, {})).items.map(row => row.status)).toEqual(['INSERTED', 'CANCELLED']);
  });

  it('rechecks real user grants before execution, blocks the interface and recovers with explicit retry', async () => {
    const item = await fixture(); await rule(item);
    await machine(item, [{ code: 'revoked', name: 'first' }]); await machine(item, [{ code: 'revoked', name: 'second' }]);
    await prisma.user.update({ where: { id: item.userId }, data: { status: 'DISABLED' } });
    expect(await worker.processDue(10)).toBe(1);
    await prisma.user.update({ where: { id: item.userId }, data: { status: 'ACTIVE' } });
    expect(await inspect(item, 'MATERIAL', 'revoked')).toBeNull();
    const blocked = (await service.listJobs(item.actor, {})).items.find(job => job.status === 'BLOCKED')!; expect(blocked.errorCode).toBe('INGESTION_AUTHORIZATION_REVOKED');
    await service.controlJob(item.actor, blocked.id, { action: 'RETRY', reason: '权限恢复后重试' }, trace(), key()); await worker.processDue(10);
    expect((await inspect(item, 'MATERIAL', 'revoked'))?.values.name).toBe('second');
  });

  it('rejects excessive per-message expansion with 503 and rolls back receipt registration', async () => {
    const item = await fixture(); for (const target of ['SUPPLIER', 'CUSTOMER', 'MATERIAL', 'COMPONENT'] as const) await rule(item, target);
    const response = await machine(item, Array.from({ length: 2501 }, (_, index) => ({ code: `${index}`, name: 'capacity' })));
    expect(response.status).toBe(503); expect(response.body.code).toBe('INTERNAL_ERROR');
    expect(await prisma.integrationReceipt.count({ where: { endpointId: item.endpointId } })).toBe(0);
    expect((await service.listJobs(item.actor, {})).total).toBe(0);
  });

  it('treats a later unchanged receipt as a newer fact and rejects older pending confirmation', async () => {
    const item = await fixture(); await rule(item, 'MATERIAL', 'CONFIRM');
    await machine(item, [{ code: 'unchanged-watermark', name: 'current' }]); await worker.processDue(10);
    await machine(item, [{ code: 'unchanged-watermark', name: 'older change' }]); await worker.processDue(10);
    const pendingJob = (await service.listJobs(item.actor, {})).items.find(job => job.awaitingConfirmation === 1)!;
    const pending = (await service.listItems(item.actor, pendingJob.id, {})).items[0]!;
    await machine(item, [{ code: 'unchanged-watermark', name: 'current' }]); await worker.processDue(10);
    await expect(service.actOnItem(item.actor, pending.id, { expectedVersion: pending.version, reason: '晚到操作' }, true, trace(), key())).rejects.toThrow('INGESTION_STALE_CONFIRMATION');
  });

  it('records a disabled organization as a blocked queue without crashing unrelated worker processing', async () => {
    const item = await fixture(); await rule(item); await machine(item, [{ code: 'disabled-org', name: '保留输入' }]);
    const other = await fixture(); await rule(other); await machine(other, [{ code: 'valid-org', name: '正常处理' }]);
    await prisma.organization.update({ where: { id: item.organizationId }, data: { status: 'DISABLED' } });
    try { await expect(worker.processDue(10)).resolves.toBe(2); }
    finally { await prisma.organization.update({ where: { id: item.organizationId }, data: { status: 'ACTIVE' } }); }
    const jobs = await service.listJobs(item.actor, {}); expect(jobs.items[0]).toMatchObject({ status: 'BLOCKED', errorCode: 'INGESTION_AUTHORIZATION_REVOKED' });
    expect((await inspect(other, 'MATERIAL', 'valid-org'))?.values.name).toBe('正常处理');
    await service.controlJob(item.actor, jobs.items[0]!.id, { action: 'CANCEL', reason: '验收收尾' }, trace(), key());
  });

  it('reuses an automatic row for a later single submission without creating an empty job', async () => {
    const item = await fixture(), configuration = await rule(item);
    await machine(item, [{ code: 'covered', name: '同一事实' }]); await worker.processDue(10);
    const original = (await service.listJobs(item.actor, {})).items[0]!;
    const single = await submitSingle(item, configuration, original.receiptId);
    expect(single.result).toMatchObject({ reused: true, jobIds: [original.id] });
    expect((await service.listJobs(item.actor, {})).total).toBe(1);
  });

  it('historical submission reuses a prior single row and only queues missing rows', async () => {
    const item = await fixture(), configuration = await rule(item, 'MATERIAL', 'UPDATE', false);
    const receiptId = await received(item, [{ code: 'single-first', name: 'first' }, { code: 'history-rest', name: 'second' }]);
    const first = await submitSingle(item, configuration, receiptId); await worker.processDue(10);
    const preview = await service.previewHistory(item.actor, { ruleId: configuration.id, ruleVersion: 1, from: new Date(Date.now() - 60000).toISOString(), to: new Date().toISOString() }, trace(), key());
    const historical = await service.submitImport(item.actor, { previewId: preview.previewId, confirmed: true }, trace(), key());
    expect(historical.jobIds).toContain(first.jobId); expect(historical.jobIds).toHaveLength(2);
    await worker.processDue(10);
    expect((await inspect(item, 'MATERIAL', 'single-first'))?.version).toBe(1);
    expect((await inspect(item, 'MATERIAL', 'history-rest'))?.version).toBe(1);
    const jobs = (await service.listJobs(item.actor, {})).items;
    expect(jobs.reduce((sum, job) => sum + job.total, 0)).toBe(2);
  });

  it('rolls back target writes when item persistence fails, blocks later jobs, and recovers durably', async () => {
    const item = await fixture(); await rule(item);
    await machine(item, [{ code: 'atomic-fault', name: 'first' }]); await machine(item, [{ code: 'atomic-fault', name: 'second' }]);
    const functionName = `ingestion_fault_${item.organizationId.replaceAll('-', '')}`;
    await prisma.$executeRawUnsafe(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.organization_id='${item.organizationId}'::uuid AND NEW.status='INSERTED' THEN RAISE EXCEPTION 'sensitive_source_must_not_escape'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER ${functionName} BEFORE UPDATE ON integration_ingestion_items FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
    try {
      expect(await worker.processDue(10)).toBe(1);
      expect(await inspect(item, 'MATERIAL', 'atomic-fault')).toBeNull();
      const jobs = await service.listJobs(item.actor, {}), blocked = jobs.items.find(job => job.status === 'BLOCKED')!;
      expect(blocked.errorCode).toBe('INGESTION_PROCESSING_FAILED');
      expect(JSON.stringify(jobs)).not.toContain('sensitive_source');
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER ${functionName} ON integration_ingestion_items`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION ${functionName}()`);
    }
    const blocked = (await service.listJobs(item.actor, {})).items.find(job => job.status === 'BLOCKED')!;
    await service.controlJob(item.actor, blocked.id, { action: 'RETRY', reason: '数据库故障移除后恢复' }, trace(), key());
    const restarted = new IngestionWorkerService(new IngestionService(prisma, app.get(AdminMutationService), app.get(AuditLogService), targets));
    await restarted.processDue(10);
    expect(await inspect(item, 'MATERIAL', 'atomic-fault')).toMatchObject({ version: 2, values: { name: 'second' } });
  });

  it('rechecks the configuration author independently from the historical submitting actor', async () => {
    const item = await fixture(), configuration = await rule(item, 'MATERIAL', 'UPDATE', false);
    await received(item, [{ code: 'author-revoked', name: '仍需配置者授权' }]);
    const importer = await prisma.user.create({ data: { organizationId: item.organizationId, username: randomUUID(), passwordHash: 'unused', accountType: 'INTERNAL' } });
    await prisma.userRole.create({ data: { organizationId: item.organizationId, userId: importer.id, roleId: item.roleId } });
    const token = await app.get(SessionService).create(importer.id, prisma, { mfaVerified: true, reauthenticated: true });
    const importerSession = await app.get(SessionService).resolve(token);
    const importerActor: AdminActor = { ...item.actor, id: importer.id, sessionId: importerSession!.id };
    const preview = await service.previewHistory(importerActor, { ruleId: configuration.id, ruleVersion: 1, from: new Date(Date.now() - 60000).toISOString(), to: new Date().toISOString() }, trace(), key());
    const imported = await service.submitImport(importerActor, { previewId: preview.previewId, confirmed: true }, trace(), key());
    await prisma.user.update({ where: { id: item.userId }, data: { status: 'DISABLED' } });
    try {
      await worker.processDue(10);
      expect(await service.getJob(importerActor, imported.jobIds[0]!)).toMatchObject({ status: 'BLOCKED', errorCode: 'INGESTION_AUTHORIZATION_REVOKED' });
    } finally { await prisma.user.update({ where: { id: item.userId }, data: { status: 'ACTIVE' } }); }
    await service.controlJob(importerActor, imported.jobIds[0]!, { action: 'CANCEL', reason: '验收结束' }, trace(), key());
  });

  it('registers all 10000 supported rows without exceeding PostgreSQL bind parameter limits', async () => {
    const item = await fixture(); await rule(item);
    expect((await machine(item, Array.from({ length: 10000 }, (_, index) => ({ code: `${index}`, name: 'bulk' })))).status).toBe(200);
    const jobs = await service.listJobs(item.actor, {}); expect(jobs.items[0]!.total).toBe(10000);
    await service.controlJob(item.actor, jobs.items[0]!.id, { action: 'CANCEL', reason: '只验证有界登记' }, trace(), key());
  });

  it('allows an authorized replacement administrator to attest a blocked retry while retaining original provenance', async () => {
    const item = await fixture(), configuration = await rule(item);
    await machine(item, [{ code: 'admin-takeover', name: '可由真实管理员恢复' }]);
    await prisma.user.update({ where: { id: item.userId }, data: { status: 'DISABLED' } });
    await worker.processDue(10);
    const replacement = await prisma.user.create({ data: { organizationId: item.organizationId, username: randomUUID(), passwordHash: 'unused', accountType: 'INTERNAL' } });
    await prisma.userRole.create({ data: { organizationId: item.organizationId, userId: replacement.id, roleId: item.roleId } });
    const token = await app.get(SessionService).create(replacement.id, prisma, { mfaVerified: true, reauthenticated: true });
    const session = await app.get(SessionService).resolve(token), replacementActor: AdminActor = { ...item.actor, id: replacement.id, sessionId: session!.id };
    await service.saveRule(replacementActor, { ...configuration, expectedVersion: 1 }, trace(), key(), configuration.id);
    const blocked = (await service.listJobs(replacementActor, {})).items[0]!;
    await service.controlJob(replacementActor, blocked.id, { action: 'RETRY', reason: '新管理员核对既有配置后接管恢复' }, trace(), key());
    await worker.processDue(10);
    expect((await service.getJob(replacementActor, blocked.id)).status).toBe('COMPLETED');
    const [persisted] = await prisma.$queryRaw<{ actor_snapshot: AdminActor; rule_snapshot: { configuredBy: AdminActor; authorizedBy: AdminActor } }[]>`SELECT actor_snapshot,rule_snapshot FROM integration_ingestion_jobs WHERE id=${blocked.id}::uuid`;
    expect(persisted!.actor_snapshot.id).toBe(item.userId);
    expect(persisted!.rule_snapshot.configuredBy.id).toBe(item.userId);
    expect(persisted!.rule_snapshot.authorizedBy.id).toBe(replacement.id);
    await prisma.user.update({ where: { id: item.userId }, data: { status: 'ACTIVE' } });
  });

  it('links repeated identical confirmation differences to the original item while preserving each receipt', async () => {
    const item = await fixture(); await rule(item, 'MATERIAL', 'CONFIRM');
    await machine(item, [{ code: 'same-difference', name: 'A' }]); await worker.processDue(10);
    await machine(item, [{ code: 'same-difference', name: 'B' }]); await worker.processDue(10);
    const firstPendingJob = (await service.listJobs(item.actor, {})).items.find(job => job.awaitingConfirmation === 1)!;
    const original = (await service.listItems(item.actor, firstPendingJob.id, {})).items[0]!;
    await machine(item, [{ code: 'same-difference', name: 'B' }]); await worker.processDue(10);
    const jobs = (await service.listJobs(item.actor, {})).items;
    expect(jobs.reduce((sum, job) => sum + job.awaitingConfirmation, 0)).toBe(1);
    const duplicateJob = jobs.find(job => job.skipped === 1)!;
    const duplicate = (await service.listItems(item.actor, duplicateJob.id, {})).items[0]!;
    expect(duplicate).toMatchObject({ status: 'SKIPPED', duplicateOfItemId: original.id });
    expect(duplicate.receiptId).not.toBe(original.receiptId);
    await service.actOnItem(item.actor, original.id, { expectedVersion: original.version, reason: '同差异来源核对后只确认一次' }, true, trace(), key());
    expect(await inspect(item, 'MATERIAL', 'same-difference')).toMatchObject({ version: 2, values: { name: 'B' } });
    expect((await service.listItems(item.actor, duplicateJob.id, {})).items[0]!.status).toBe('SKIPPED');
  });

  it('returns and persists only a controlled failing field path without business values in mutation or audit results', async () => {
    const item = await fixture(), initial = await rule(item, 'MATERIAL', 'UPDATE', false);
    const configuration = await service.saveRule(item.actor, { ...initial, expectedVersion: 1, mapping: { code: 'payload.businessCode', name: 'payload.companyName' } }, trace(), key(), initial.id);
    const receiptId = await received(item, [{ payload: { businessCode: 42, companyName: '不应进入错误或幂等记录的私人名称' } }]);
    const preview = await service.preview(item.actor, { ruleId: configuration.id, ruleVersion: configuration.version, receiptId, rowIndex: 0 }, trace(), key());
    expect(preview).toMatchObject({ action: 'VALIDATION_FAILED', errorCode: 'INGESTION_FIELD_TYPE', errorField: 'payload.businessCode' });
    const submitted = await service.submitImport(item.actor, { previewId: preview.previewId, confirmed: true }, trace(), key()); await worker.processDue(10);
    const rows = await service.listItems(item.actor, submitted.jobIds[0]!, {});
    expect(rows.items[0]).toMatchObject({ status: 'VALIDATION_FAILED', errorCode: 'INGESTION_FIELD_TYPE', errorField: 'payload.businessCode' });
    expect(await service.getItem(item.actor, rows.items[0]!.id, trace())).toMatchObject({ errorField: 'payload.businessCode' });
    const mutations = await prisma.adminMutation.findMany({ where: { organizationId: item.organizationId } });
    const audit = await prisma.auditEvent.findMany({ where: { organizationId: item.organizationId } });
    expect(JSON.stringify({ mutations, audit })).not.toContain('不应进入错误或幂等记录的私人名称');
  });

  it('filters receipt-associated jobs within the authorized organization', async () => {
    const item = await fixture(); await rule(item);
    await machine(item, [{ code: 'receipt-filter-one', name: 'one' }]); await machine(item, [{ code: 'receipt-filter-two', name: 'two' }]); await worker.processDue(10);
    const jobs = (await service.listJobs(item.actor, {})).items;
    const selected = jobs.find(job => job.receiptId)!;
    const page = await service.listJobs(item.actor, { receiptId: selected.receiptId! });
    expect(page.total).toBe(1); expect(page.items.map(job => job.id)).toEqual([selected.id]);
    const other = await fixture(); await rule(other); await machine(other, [{ code: 'foreign-filter', name: 'other' }]); await worker.processDue(10);
    const foreign = (await service.listJobs(other.actor, {})).items[0]!;
    expect(await service.listJobs(item.actor, { receiptId: foreign.receiptId! })).toMatchObject({ total: 0, items: [] });
  });

  it('keeps the newest source timestamp when confirming a reused difference', async () => {
    const item = await fixture(), initial = await rule(item, 'MATERIAL', 'CONFIRM');
    await service.saveRule(item.actor, { ...initial, expectedVersion: 1, sourceUpdatedAtField: 'sourceTime' }, trace(), key(), initial.id);
    await machine(item, [{ code: 'duplicate-time', name: 'A', sourceTime: '2026-01-01T00:00:00Z' }]); await worker.processDue(10);
    await machine(item, [{ code: 'duplicate-time', name: 'B', sourceTime: '2026-02-01T00:00:00Z' }]); await worker.processDue(10);
    const originalJob = (await service.listJobs(item.actor, {})).items.find(job => job.awaitingConfirmation === 1)!;
    await machine(item, [{ code: 'duplicate-time', name: 'B', sourceTime: '2026-03-01T00:00:00Z' }]); await worker.processDue(10);
    const pending = (await service.listItems(item.actor, originalJob.id, {})).items[0]!;
    await service.actOnItem(item.actor, pending.id, { expectedVersion: pending.version, reason: '核对重复来源中的最新版本' }, true, trace(), key());
    const target = await inspect(item, 'MATERIAL', 'duplicate-time');
    const [watermark] = await prisma.$queryRaw<{ source_updated_at: Date }[]>`SELECT source_updated_at FROM integration_ingestion_target_versions WHERE organization_id=${item.organizationId}::uuid AND target='MATERIAL' AND target_id=${target!.id}::uuid`;
    expect(watermark!.source_updated_at.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  it('supersedes a stale pending difference when an identical newer receipt arrives after an accepted fact', async () => {
    const item = await fixture(); await rule(item, 'MATERIAL', 'CONFIRM');
    await machine(item, [{ code: 'duplicate-stale', name: 'A' }]); await worker.processDue(10);
    await machine(item, [{ code: 'duplicate-stale', name: 'B' }]); await worker.processDue(10);
    const oldJob = (await service.listJobs(item.actor, {})).items.find(job => job.awaitingConfirmation === 1)!;
    const oldItem = (await service.listItems(item.actor, oldJob.id, {})).items[0]!;
    await machine(item, [{ code: 'duplicate-stale', name: 'A' }]); await worker.processDue(10);
    await machine(item, [{ code: 'duplicate-stale', name: 'B' }]); await worker.processDue(10);
    const jobs = (await service.listJobs(item.actor, {})).items;
    expect(jobs.reduce((sum, job) => sum + job.awaitingConfirmation, 0)).toBe(1);
    const currentJob = jobs.find(job => job.awaitingConfirmation === 1)!;
    const current = (await service.listItems(item.actor, currentJob.id, {})).items[0]!;
    expect(current.id).not.toBe(oldItem.id);
    expect((await service.listItems(item.actor, oldJob.id, {})).items[0]).toMatchObject({ status: 'SKIPPED', duplicateOfItemId: current.id });
    expect((await service.getItem(item.actor, current.id, trace())).stale).toBe(false);
    await service.actOnItem(item.actor, current.id, { expectedVersion: current.version, reason: '确认最新仍有效的同差异来源' }, true, trace(), key());
    expect((await inspect(item, 'MATERIAL', 'duplicate-stale'))?.values.name).toBe('B');
  });
});
