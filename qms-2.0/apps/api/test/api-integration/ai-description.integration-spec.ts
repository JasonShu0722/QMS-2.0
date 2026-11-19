import 'reflect-metadata';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { encryptSecret } from '../../src/common/security/security-keyring.js';
import { AiConnectionService } from '../../src/modules/ai-configuration/ai-connection.service.js';
import { AiApplicationService } from '../../src/modules/ai-configuration/ai-application.service.js';
import { AiDescriptionService } from '../../src/modules/api-integration/ai-description.service.js';
import { IngestionService } from '../../src/modules/api-integration/ingestion.service.js';
import { IngestionTargetsService } from '../../src/modules/api-integration/ingestion-targets.service.js';
import type { IngestionRuleDto, SaveIngestionRuleDto } from '../../src/modules/api-integration/ingestion.dto.js';
import { normalizeIngestionRule, selectedDescriptionInput } from '../../src/modules/api-integration/ingestion.policy.js';
import { processIngestionFixture, type ProcessIngestionFixture } from '../process-quality/process-defect-ingestion.fixture.js';

describe('AI description durable queue with PostgreSQL and actual controlled HTTP', () => {
  let fixture: ProcessIngestionFixture, service: AiDescriptionService, engine: IngestionService, connections: AiConnectionService, connection: { id: string; version: number }, server: Server;
  let mode = 'SUCCESS', pending: (() => void) | undefined, started: (() => void) | undefined;
  let rowIndex = 10;
  const requests: unknown[] = [];
  const originalNodeEnv = process.env.NODE_ENV;
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    fixture = await processIngestionFixture();
    await fixture.prisma.$executeRaw`UPDATE integration_ai_description_tasks t SET status='STALE',claim_token=NULL WHERE t.status IN ('PENDING','RETRY','PROCESSING') AND t.organization_id<>${fixture.actor.organizationId}::uuid AND EXISTS(SELECT 1 FROM ai_connections c JOIN organizations o ON o.id=c.organization_id WHERE c.id=t.connection_id AND c.organization_id=t.organization_id AND c.name='测试专用渠道' AND c.base_url LIKE 'http://127.0.0.1:%/v1' AND o.name='S2 disposable scope')`;
    for (const code of ['ingestion:read','ingestion:run','ingestion:manage','integration:receipts:read','integration:payload:read','ai:connections:read','ai:connections:manage','ai:credentials:manage','ai:applications:manage','ai:applications:publish','process-quality:defects:delete']) {
      const permission = await fixture.prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await fixture.prisma.rolePermission.create({ data: { roleId: fixture.role.id, permissionId: permission.id } });
    }
    server = createServer((request, response) => {
      let body = '';
      request.on('data', chunk => { body += String(chunk); });
      request.on('end', () => {
        requests.push(JSON.parse(body));
        const finish = () => {
          if (mode === 'FAIL') { response.writeHead(401); response.end('must-not-propagate-provider-body'); return; }
          const content = mode === 'EMPTY' ? '' : mode === 'JSON' ? JSON.stringify({ 自定义描述: 'JSON整理结果', ignored: '非目标字段' }) : '已选事实的整理结果';
          response.end(JSON.stringify({ choices: [{ message: { content } }] }));
        };
        if (mode === 'WAIT') { pending = finish; started?.(); } else finish();
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const mutations = new AdminMutationService(fixture.prisma, fixture.audit);
    connections = new AiConnectionService(fixture.prisma, mutations, fixture.audit);
    connection = await connections.create(fixture.actor, fixture.actor.organizationId, { name: '测试专用渠道', baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
      models: ['model-a', 'model-b'], defaultModel: 'model-a', enabled: true, apiKey: 'disposable-ai-task-test-secret' }, randomUUID(), randomUUID());
    service = new AiDescriptionService(fixture.prisma, mutations, connections, fixture.adapter, fixture.audit);
    engine = new IngestionService(fixture.prisma, mutations, fixture.audit, new IngestionTargetsService(undefined!, undefined!, undefined!, undefined!, fixture.adapter), service);
    const originalReceipt = await fixture.prisma.integrationReceipt.findUniqueOrThrow({ where: { id: fixture.fields().receiptId } });
    await fixture.prisma.integrationEndpoint.update({ where: { id: originalReceipt.endpointId }, data: { status: 'ENABLED' } });
  });
  afterAll(async () => {
    if (fixture) await fixture.prisma.$executeRaw`UPDATE integration_ai_description_tasks SET status='STALE',claim_token=NULL WHERE organization_id=${fixture.actor.organizationId}::uuid AND status IN ('PENDING','RETRY','PROCESSING')`;
    server?.closeAllConnections(); await new Promise<void>(resolve => server?.close(() => resolve()));
    await fixture?.prisma.$disconnect();
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalNodeEnv;
  });
  afterEach(async () => {
    if (fixture) await fixture.prisma.$executeRaw`UPDATE integration_ai_description_tasks SET status='STALE',claim_token=NULL WHERE organization_id=${fixture.actor.organizationId}::uuid AND status IN ('PENDING','RETRY','PROCESSING')`;
    if (fixture) await fixture.prisma.$executeRaw`UPDATE integration_ingestion_jobs SET status='CANCELLED' WHERE organization_id=${fixture.actor.organizationId}::uuid AND status IN ('PENDING','PAUSED','BLOCKED')`;
  });

  async function engineSource(direct = '直接组合事实', updateFields = ['description','operationName','lineCode'], strategy: SaveIngestionRuleDto['mode'] = 'UPDATE') {
    const original = await fixture.prisma.integrationReceipt.findUniqueOrThrow({ where: { id: fixture.fields().receiptId } });
    const raw: Record<string, unknown> = { id: randomUUID(), time: '2026-11-16T00:30:00Z', product: 'QMS-AI-COMPLETE', trace: randomUUID(), operation: '目检', direct, fact: '毛刺' };
    const configuration = await engine.saveRule(fixture.actor, { name: '真实入库AI接缝', endpointId: original.endpointId, target: 'PROCESS_DEFECT', enabled: false,
      match: 'ALL', conditions: [], mode: strategy, updateFields, mapping: { externalRecordKey: 'id', occurredAt: 'time', productCode: 'product', traceCode: 'trace', operationName: 'operation', lineCode: 'line', description: 'direct' },
      aiDescription: { connectionId: connection.id, model: 'model-b', prompt: '整理{{fact}}。', inputFields: [{ path: 'fact', label: '现象', variable: 'fact' }], output: { mode: 'TEXT', field: 'description', target: 'description' } } }, randomUUID(), randomUUID());
    async function prepare(rule: IngestionRuleDto = configuration, body: Record<string, unknown> = raw) {
      const receipt = await fixture.receipt();
      const ciphertext = encryptSecret(JSON.stringify([body]), `integration:${fixture.actor.organizationId}:${receipt.endpointId}:${receipt.id}`);
      await fixture.prisma.$executeRaw`UPDATE integration_receipts SET payload_ciphertext=${ciphertext},payload_bytes=${Buffer.byteLength(ciphertext)},row_count=1 WHERE organization_id=${fixture.actor.organizationId}::uuid AND id=${receipt.id}::uuid`;
      const preview = await engine.preview(fixture.actor, { ruleId: rule.id, ruleVersion: rule.version, receiptId: receipt.id, rowIndex: 0 }, randomUUID(), randomUUID());
      return { preview, receipt };
    }
    async function ingest(rule: IngestionRuleDto = configuration, body: Record<string, unknown> = raw) {
      const { preview } = await prepare(rule, body);
      const imported = await engine.submitImport(fixture.actor, { previewId: preview.previewId, confirmed: true }, randomUUID(), randomUUID());
      await engine.processDue(20);
      const item = (await engine.listItems(fixture.actor, imported.jobIds[0]!, {})).items[0]!;
      expect(['INSERTED','UPDATED','UNCHANGED']).toContain(item.status);
      const row = await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: item.targetId! } });
      return { item, row };
    }
    async function changePrompt(rule: IngestionRuleDto = configuration) {
      return engine.saveRule(fixture.actor, { ...rule, aiApplication: undefined, expectedVersion: rule.version, aiDescription: { ...rule.aiDescription!, prompt: `新版本${rule.version + 1}整理{{fact}}。` } } as SaveIngestionRuleDto, randomUUID(), randomUUID(), rule.id);
    }
    return { raw, configuration, ingest, prepare, changePrompt };
  }

  async function source(output: 'TEXT' | 'JSON' = 'TEXT', direct = '保底：毛刺') {
    const fields = fixture.fields({ rowIndex: rowIndex++, description: direct, externalRecordKey: randomUUID() });
    const defect = await fixture.ingest(fields), ruleId = randomUUID();
    const receipt = await fixture.prisma.integrationReceipt.findUniqueOrThrow({ where: { id: fields.receiptId } });
    const rule = normalizeIngestionRule({ name: '测试描述规则', endpointId: receipt.endpointId, target: 'PROCESS_DEFECT', enabled: false,
      match: 'ALL', conditions: [], mapping: {}, mode: 'UPDATE', updateFields: ['description'], descriptionComposition: { fields: [{ path: 'fallback' }], separator: '\n' },
      aiDescription: { connectionId: connection.id, model: 'model-b', prompt: '整理{{fact}}，不补充原因。', inputFields: [{ path: 'fact', label: '已选事实', variable: 'fact' }], output: { mode: output, field: output === 'JSON' ? '自定义描述' : 'description', target: 'description' } } });
    await fixture.prisma.$executeRaw`INSERT INTO integration_ingestion_rules(id,organization_id,endpoint_id,creator_id,actor_snapshot,configuration,enabled,target)
      VALUES(${ruleId}::uuid,${fixture.actor.organizationId}::uuid,${receipt.endpointId}::uuid,${fixture.actor.id}::uuid,${JSON.stringify(fixture.actor)}::jsonb,${JSON.stringify(rule)}::jsonb,false,'PROCESS_DEFECT')`;
    const input = { ruleId, ruleVersion: 1, rule, defectId: defect.id, fields: selectedDescriptionInput(rule, { fact: '毛刺', fallback: direct, hidden: '禁止外发正文' }), direct };
    const enqueue = () => fixture.prisma.$transaction(tx => service.enqueue(tx, fixture.actor, input));
    return { fields, defect, input, enqueue };
  }

  it.each([
    { provider: 'FAIL', fact: '毛刺', called: true, errorCode: 'AI_CONNECTION_REQUEST_FAILED' },
    { provider: 'EMPTY', fact: '毛刺', called: true, errorCode: 'AI_CONNECTION_RESPONSE_INVALID' },
    { provider: 'SUCCESS', fact: '  ', called: false, errorCode: 'AI_DESCRIPTION_INPUT_EMPTY' },
    { provider: 'SUCCESS', fact: undefined, called: false, errorCode: 'AI_DESCRIPTION_INPUT_EMPTY' },
    { provider: 'SUCCESS', fact: 0, called: true, errorCode: null },
    { provider: 'SUCCESS', fact: false, called: true, errorCode: null },
  ])('returns a safe ingestion AI preview with provider=$provider and fact=$fact', async ({ provider, fact, called, errorCode }) => {
    mode = provider;
    const { configuration, prepare, raw } = await engineSource();
    const { receipt } = await prepare(configuration, { ...raw, fact });
    const before = requests.length;
    const traceId = randomUUID();
    const result = await engine.previewAi(fixture.actor, { ruleId: configuration.id, ruleVersion: configuration.version, receiptId: receipt.id, rowIndex: 0 }, traceId);

    expect(result).toEqual({
      directDescription: raw.direct,
      inputFields: fact === undefined ? [] : [{ path: 'fact', label: '现象', variable: 'fact', value: fact }],
      aiDescription: errorCode ? null : '已选事实的整理结果',
      status: errorCode ? 'FAILED' : 'SUCCEEDED',
      errorCode,
      traceId,
    });
    expect(requests).toHaveLength(before + Number(called));
  });

  it.each(['x'.repeat(15999), '界'.repeat(12000)])('returns the specific input limit error without calling the provider (case %#)', async fact => {
    const { configuration, prepare, raw } = await engineSource();
    const { receipt } = await prepare(configuration, { ...raw, fact });
    const before = requests.length;
    const traceId = randomUUID();
    const result = await engine.previewAi(fixture.actor, { ruleId: configuration.id, ruleVersion: configuration.version, receiptId: receipt.id, rowIndex: 0 }, traceId);

    expect(result).toMatchObject({ status: 'FAILED', directDescription: raw.direct, inputFields: [], errorCode: 'AI_DESCRIPTION_INPUT_TOO_LARGE', traceId });
    expect(requests).toHaveLength(before);
  });

  it('uses the saved composition variable without sending unused fields, and keeps the fallback when it is blank', async () => {
    mode = 'SUCCESS';
    const value = await engineSource();
    const applications = new AiApplicationService(fixture.prisma, new AdminMutationService(fixture.prisma, fixture.audit), connections, fixture.audit);
    const organizationId = fixture.actor.organizationId;
    const output = { mode: 'TEXT', field: 'description', target: 'description' } as const;
    const application = await applications.create(fixture.actor, organizationId, { name: '组合字段', domain: 'PROCESS_QUALITY', scene: 'PROCESS_DEFECT_DESCRIPTION', enabled: true, fallback: 'DIRECT', connectionId: connection.id, model: 'model-a', output,
      prompt: '整理{{fact}}', variables: [{ variable: 'fact', label: '现象' }, { variable: 'unused', label: '保底资料' }] }, randomUUID(), randomUUID());
    await applications.publish(fixture.actor, organizationId, application.id, { expectedVersion: application.version }, randomUUID(), randomUUID());
    const { description: _description, ...mapping } = value.configuration.mapping;
    const rule = await engine.saveRule(fixture.actor, { ...value.configuration, mapping, aiDescription: undefined, expectedVersion: value.configuration.version,
      descriptionComposition: { fields: [{ path: 'fact', variable: 'fact' }, { path: 'direct', variable: 'unused' }], separator: '\n' },
      aiApplication: { applicationId: application.id, publishedVersion: 1, inputFields: [{ path: 'fact', variable: 'fact' }] } }, randomUUID(), randomUUID(), value.configuration.id);
    const before = requests.length;
    const first = await value.ingest(rule);
    await service.processDue();
    expect(requests).toHaveLength(before + 1);
    expect(JSON.stringify(requests.at(-1))).toContain('毛刺');
    expect(JSON.stringify(requests.at(-1))).not.toContain('直接组合事实');
    expect(await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: first.row.id } })).toMatchObject({ description: '已选事实的整理结果' });
    const blank = await value.ingest(rule, { ...value.raw, id: randomUUID(), trace: randomUUID(), fact: '  ' });
    await service.processDue();
    expect(requests).toHaveLength(before + 1);
    expect(await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: blank.row.id } })).toMatchObject({ description: '直接组合事实' });
  });

  it('persists a terminal all-empty task, keeps the fallback, and rejects retries of its input', async () => {
    mode = 'SUCCESS';
    const value = await engineSource();
    const empty = { ...value.raw, fact: undefined };
    const before = requests.length;
    const imported = await value.ingest(value.configuration, empty);
    expect(imported.row).toMatchObject({ description: value.raw.direct, descriptionSource: 'DIRECT', descriptionAiStatus: 'FAILED' });
    const task = { id: imported.row.descriptionTaskId, status: 'FAILED', errorCode: 'AI_DESCRIPTION_INPUT_EMPTY', attempts: 0, version: 1, result: null };
    expect(task.id).toBeTruthy();
    expect((await service.list(fixture.actor, imported.row.id)).items).toEqual([expect.objectContaining(task)]);

    await expect(service.action(fixture.actor, task.id!, { expectedVersion: task.version }, false, randomUUID(), randomUUID()))
      .rejects.toMatchObject({ status: 409, response: { code: 'AI_DESCRIPTION_INPUT_EMPTY' } });
    await value.ingest(value.configuration, empty);
    await service.processDue();
    expect(requests).toHaveLength(before);
    expect((await service.list(fixture.actor, imported.row.id)).items).toEqual([expect.objectContaining(task)]);

    const corrected = await value.ingest();
    expect(corrected.row.id).toBe(imported.row.id);
    expect(corrected.row.descriptionTaskId).not.toBe(task.id);
    await service.processDue();
    expect(requests).toHaveLength(before + 1);
    expect((await service.list(fixture.actor, imported.row.id)).items[0]).toMatchObject({ status: 'APPLIED', errorCode: null });
  });

  it.each([
    { code: 'AI_DESCRIPTION_INPUT_INVALID', source: { direct: 'x'.repeat(10001), fact: '不应保存的候选内容\u0000' }, fallback: '' },
    { code: 'AI_DESCRIPTION_INPUT_TOO_LARGE', source: { fact: '界'.repeat(12000) }, fallback: '直接组合事实' },
    { code: 'AI_DESCRIPTION_INPUT_TOO_LARGE', source: { fact: 'x'.repeat(15999) }, fallback: '直接组合事实' },
  ])('records $code safely when historical ingestion rejects AI input', async ({ code, source, fallback }) => {
    mode = 'SUCCESS';
    const value = await engineSource();
    const { receipt } = await value.prepare(value.configuration, { ...value.raw, ...source });
    const history = await engine.previewHistory(fixture.actor, { ruleId: value.configuration.id, ruleVersion: value.configuration.version,
      from: receipt.receivedAt.toISOString(), to: new Date().toISOString() }, randomUUID(), randomUUID());
    const submitted = await engine.submitImport(fixture.actor, { previewId: history.previewId, confirmed: true }, randomUUID(), randomUUID());
    const before = requests.length;
    await engine.processDue(20);
    await service.processDue();
    expect(await engine.getJob(fixture.actor, submitted.jobIds[0]!)).toMatchObject({ status: 'COMPLETED', failed: 0 });
    expect(requests).toHaveLength(before);
    const row = await fixture.prisma.processDefect.findFirstOrThrow({ where: { organizationId: fixture.actor.organizationId, externalRecordKey: String(value.raw.id) } });
    expect(row).toMatchObject({ description: fallback, descriptionDirect: fallback, descriptionInput: [], descriptionAiStatus: 'FAILED' });
    const [task] = (await service.list(fixture.actor, row.id)).items;
    expect(task).toMatchObject({ id: row.descriptionTaskId, status: 'FAILED', errorCode: code, result: null, attempts: 0 });
    const [snapshot] = await fixture.prisma.$queryRaw<{ input_fields: unknown; expected_description: string }[]>`SELECT input_fields, expected_description FROM integration_ai_description_tasks WHERE id=${task!.id}::uuid`;
    expect(snapshot).toEqual({ input_fields: [], expected_description: '' });
    await expect(service.action(fixture.actor, task!.id, { expectedVersion: task!.version }, false, randomUUID(), randomUUID()))
      .rejects.toMatchObject({ status: 409, response: { code } });
  });

  it('publishes an exhausted claim timeout only on its current defect revision', async () => {
    const older = await source(), current = await source();
    await older.enqueue();
    await current.enqueue();
    const olderTask = (await service.list(fixture.actor, older.defect.id)).items[0]!;
    older.input.fields[0]!.value = '新输入';
    await older.enqueue();
    const currentTask = (await service.list(fixture.actor, current.defect.id)).items[0]!;
    await fixture.prisma.$executeRaw`UPDATE integration_ai_description_tasks SET status='PROCESSING',attempts=3,claimed_at=clock_timestamp()-interval '3 minutes',claim_token=${randomUUID()}::uuid WHERE id IN (${olderTask.id}::uuid,${currentTask.id}::uuid)`;
    await fixture.prisma.$executeRaw`UPDATE integration_ai_description_tasks SET next_attempt_at=clock_timestamp()+interval '1 hour' WHERE defect_id=${older.defect.id}::uuid AND status='PENDING'`;

    await service.processDue();

    expect(await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: current.defect.id } })).toMatchObject({ description: current.input.direct, descriptionAiStatus: 'FAILED' });
    expect((await service.list(fixture.actor, current.defect.id)).items[0]).toMatchObject({ status: 'FAILED', errorCode: 'AI_CONNECTION_TIMEOUT' });
    expect(await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: older.defect.id } })).toMatchObject({ descriptionAiStatus: 'PENDING' });
  });

  it.each([undefined, null, '  '])('uses the existing published mapping when a bound optional field is %p', async optional => {
    mode = 'SUCCESS';
    const value = await engineSource();
    const applications = new AiApplicationService(fixture.prisma, new AdminMutationService(fixture.prisma, fixture.audit), connections, fixture.audit);
    const organizationId = fixture.actor.organizationId;
    const output = { mode: 'TEXT', field: 'description', target: 'description' } as const;
    const application = await applications.create(fixture.actor, organizationId, { name: '选填来源字段', domain: 'PROCESS_QUALITY', scene: 'PROCESS_DEFECT_DESCRIPTION', enabled: true, fallback: 'DIRECT', connectionId: connection.id, model: 'model-a', output,
      prompt: '现象{{fact}}；位置{{position}}', variables: [{ variable: 'fact', label: '现象' }, { variable: 'position', label: '位置' }] }, randomUUID(), randomUUID());
    await applications.publish(fixture.actor, organizationId, application.id, { expectedVersion: application.version }, randomUUID(), randomUUID());
    const { description: _description, ...mapping } = value.configuration.mapping;
    const inputFields = [{ path: 'fact', variable: 'fact' }, { path: 'details.position', variable: 'position' }];
    const rule = await engine.saveRule(fixture.actor, { ...value.configuration, mapping, aiDescription: undefined, expectedVersion: value.configuration.version,
      descriptionComposition: { fields: [...inputFields, { path: 'direct' }], separator: '\n' },
      aiApplication: { applicationId: application.id, publishedVersion: 1, inputFields } }, randomUUID(), randomUUID(), value.configuration.id);
    const payload = { ...value.raw, details: { position: optional, privateNote: '不可外发' } };
    const { receipt } = await value.prepare(rule, payload);
    const before = requests.length;
    const preview = await engine.previewAi(fixture.actor, { ruleId: rule.id, ruleVersion: rule.version, receiptId: receipt.id, rowIndex: 0 }, randomUUID());
    const imported = await value.ingest(rule, payload);
    await service.processDue();

    expect(preview).toMatchObject({ status: 'SUCCEEDED', errorCode: null, aiDescription: '已选事实的整理结果', directDescription: '毛刺\n直接组合事实' });
    expect(preview.inputFields.map(field => field.variable)).toEqual(['fact']);
    expect((await service.list(fixture.actor, imported.row.id)).items[0]).toMatchObject({ status: 'APPLIED', errorCode: null, result: '已选事实的整理结果' });
    expect(requests).toHaveLength(before + 2);
    for (const sent of requests.slice(before)) {
      expect(sent).toMatchObject({ messages: expect.arrayContaining([{ role: 'user', content: '现象"毛刺"；位置""' }]) });
      expect(JSON.stringify(sent)).not.toMatch(/不可外发|直接组合事实|\{\{position\}\}/);
    }
  });

  it.each(['INSERT_ONLY', 'UPDATE', 'CONFIRM'] as const)('gates independent AI-only input changes through the %s strategy and preserves current-input deduplication', async strategy => {
    mode = 'SUCCESS'; const value = await engineSource('直接组合事实', ['description'], strategy);
    const initial = await value.ingest(); await service.processDue();
    const before = requests.length;
    const { preview } = await value.prepare(value.configuration, { ...value.raw, fact: '新的独立AI事实', hidden: '不可外发' });
    const expected = strategy === 'INSERT_ONLY' ? 'EXISTING_SKIPPED' : strategy === 'UPDATE' ? 'UPDATED' : 'AWAITING_CONFIRMATION';
    expect(preview.action).toBe(expected);
    expect(preview.differences).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'aiDescription' })]));
    expect(JSON.stringify(preview.differences)).not.toContain('不可外发');
    const queued = await engine.submitImport(fixture.actor, { previewId: preview.previewId, confirmed: true }, randomUUID(), randomUUID());
    await engine.processDue(20);
    const item = (await engine.listItems(fixture.actor, queued.jobIds[0]!, {})).items[0]!;
    expect(item.status).toBe(expected);
    if (strategy !== 'UPDATE') {
      expect((await service.list(fixture.actor, initial.row.id)).items).toHaveLength(1);
      expect((await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: initial.row.id } })).description).toBe('已选事实的整理结果');
    }
    if (strategy === 'INSERT_ONLY') { await service.processDue(); expect(requests).toHaveLength(before); return; }
    if (strategy === 'CONFIRM') await engine.actOnItem(fixture.actor, item.id, { expectedVersion: item.version, reason: '核实独立输入后采用AI整理' }, true, randomUUID(), randomUUID());
    await service.processDue();
    expect(requests).toHaveLength(before + 1);
    expect(JSON.stringify(requests.at(-1))).toContain('新的独立AI事实');
    expect((await service.list(fixture.actor, initial.row.id)).items).toHaveLength(2);
    await value.ingest(value.configuration, { ...value.raw, fact: '新的独立AI事实' }); await service.processDue();
    expect(requests).toHaveLength(before + 1);
    expect((await service.list(fixture.actor, initial.row.id)).items).toHaveLength(2);
  });
  it('requires confirmation for prompt-only changes and protects manual descriptions from independent AI input changes', async () => {
    mode = 'SUCCESS'; const value = await engineSource('直接组合事实', ['description'], 'CONFIRM');
    const initial = await value.ingest(); await service.processDue();
    const nextRule = await value.changePrompt();
    const { preview } = await value.prepare(nextRule);
    expect(preview.action).toBe('AWAITING_CONFIRMATION');
    const previewDifference = preview.differences.find(difference => difference.field === 'aiDescription');
    expect(JSON.parse(previewDifference?.after ?? 'null')).toMatchObject({ ruleVersion: nextRule.version });
    expect(JSON.stringify(previewDifference)).not.toMatch(/新版本|毛刺|直接组合事实|"prompt"|"fields"/);
    const queued = await engine.submitImport(fixture.actor, { previewId: preview.previewId, confirmed: true }, randomUUID(), randomUUID()); await engine.processDue(20);
    const pending = (await engine.listItems(fixture.actor, queued.jobIds[0]!, {})).items[0]!;
    const detail = await engine.getItem(fixture.actor, pending.id, randomUUID());
    expect(detail.differences.find(difference => difference.field === 'aiDescription')).toEqual(previewDifference);
    expect((await service.list(fixture.actor, initial.row.id)).items).toHaveLength(1);
    await engine.actOnItem(fixture.actor, pending.id, { expectedVersion: pending.version, reason: '确认提示词版本' }, true, randomUUID(), randomUUID()); await service.processDue();
    const current = await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: initial.row.id } });
    await fixture.ledger.update(fixture.actor, current.id, { expectedVersion: current.version, description: '人工修订优先' }, randomUUID(), randomUUID());
    const updateRule = await engine.saveRule(fixture.actor, { ...nextRule, expectedVersion: nextRule.version, mode: 'UPDATE' } as SaveIngestionRuleDto, randomUUID(), randomUUID(), nextRule.id);
    const before = (await service.list(fixture.actor, initial.row.id)).items.length;
    const manual = await value.prepare(updateRule, { ...value.raw, direct: '人工修订优先', fact: '另一份AI输入' });
    expect(manual.preview.action).toBe('AWAITING_CONFIRMATION');
    const imported = await engine.submitImport(fixture.actor, { previewId: manual.preview.previewId, confirmed: true }, randomUUID(), randomUUID()); await engine.processDue(20);
    expect((await engine.listItems(fixture.actor, imported.jobIds[0]!, {})).items[0]!.status).toBe('AWAITING_CONFIRMATION');
    expect((await service.list(fixture.actor, initial.row.id)).items).toHaveLength(before);
    expect((await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: initial.row.id } })).description).toBe('人工修订优先');
  });
  it('rejects AI-only changes from an older receipt without a source timestamp', async () => {
    mode = 'SUCCESS'; const value = await engineSource();
    const older = await value.prepare(value.configuration, { ...value.raw, fact: '旧接收中的独立事实' });
    const latest = await value.ingest(); await service.processDue();
    const preview = await engine.preview(fixture.actor, { ruleId: value.configuration.id, ruleVersion: value.configuration.version, receiptId: older.receipt.id, rowIndex: 0 }, randomUUID(), randomUUID());
    expect(preview.action).toBe('AWAITING_CONFIRMATION');
    const imported = await engine.submitImport(fixture.actor, { previewId: preview.previewId, confirmed: true }, randomUUID(), randomUUID()); await engine.processDue(20);
    const pending = (await engine.listItems(fixture.actor, imported.jobIds[0]!, {})).items[0]!;
    expect(pending.status).toBe('AWAITING_CONFIRMATION');
    expect((await engine.getItem(fixture.actor, pending.id, randomUUID())).stale).toBe(true);
    await expect(engine.actOnItem(fixture.actor, pending.id, { expectedVersion: pending.version, reason: '拒绝旧接收重新整理' }, true, randomUUID(), randomUUID())).rejects.toMatchObject({ response: { code: 'INGESTION_STALE_CONFIRMATION' } });
    expect((await service.list(fixture.actor, latest.row.id)).items).toHaveLength(1);
  });
  it('persists and deduplicates before network, calls only selected fields, and keeps source comparisons stable after AI', async () => {
    mode = 'SUCCESS';
    const value = await source(), before = requests.length;
    await value.enqueue(); await value.enqueue();
    expect(requests).toHaveLength(before);
    expect((await service.list(fixture.actor, value.defect.id)).items).toHaveLength(1);
    await service.processDue();
    const row = await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: value.defect.id } });
    expect(row.description).toBe('已选事实的整理结果');
    expect(row.descriptionDirect).toBe('保底：毛刺');
    expect(JSON.stringify(requests.at(-1))).toContain('毛刺');
    expect(JSON.stringify(requests.at(-1))).not.toContain('禁止外发正文');
    expect(requests.at(-1)).toMatchObject({ model: 'model-b' });
    expect((requests.at(-1) as { messages: { content: string }[] }).messages[1]!.content).toBe('整理"毛刺"，不补充原因。');
    const inspected = await fixture.prisma.$transaction(tx => fixture.adapter.inspect(tx, fixture.actor, value.fields));
    expect(inspected?.values.description).toBe('保底：毛刺');
    await fixture.ingest({ ...value.fields, operationName: '外观检验' });
    expect((await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: row.id } })).description).toBe('已选事实的整理结果');
    await value.enqueue();
    expect((await service.list(fixture.actor, value.defect.id)).items).toHaveLength(1);
  });

  it('keeps a permanent supplier failure on direct text and allows an explicit retry', async () => {
    mode = 'FAIL'; const value = await source(); await value.enqueue();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await service.processDue();
      await fixture.prisma.$executeRaw`UPDATE integration_ai_description_tasks SET next_attempt_at=clock_timestamp() WHERE defect_id=${value.defect.id}::uuid AND status='RETRY'`;
    }
    let task = (await service.list(fixture.actor, value.defect.id)).items[0]!;
    expect(task.status).toBe('FAILED');
    expect(JSON.stringify(task)).not.toContain('must-not-propagate');
    expect((await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: value.defect.id } })).description).toBe('保底：毛刺');
    mode = 'SUCCESS'; await service.action(fixture.actor, task.id, { expectedVersion: task.version }, false, randomUUID(), randomUUID());
    await service.processDue(); task = (await service.list(fixture.actor, value.defect.id)).items[0]!;
    expect(task.status).toBe('APPLIED');
  });

  it('keeps in-flight manual text and stores a suggestion that needs explicit adoption', async () => {
    mode = 'WAIT'; const value = await source(); await value.enqueue();
    const startedRequest = new Promise<void>(resolve => { started = resolve; });
    const run = service.processDue(); await startedRequest;
    await fixture.prisma.processDefect.update({ where: { id: value.defect.id }, data: { description: '人工决定的描述', manualFields: ['description'] } });
    pending!(); await run; started = undefined;
    const task = (await service.list(fixture.actor, value.defect.id)).items[0]!;
    expect(task.status).toBe('SUGGESTED');
    expect((await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: value.defect.id } })).description).toBe('人工决定的描述');
    await service.action(fixture.actor, task.id, { expectedVersion: task.version }, true, randomUUID(), randomUUID());
    expect((await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: value.defect.id } })).description).toBe('已选事实的整理结果');
  });

  it('rejects an old prompt response and extracts a selected custom JSON output field', async () => {
    mode = 'WAIT'; const value = await source(); await value.enqueue();
    const startedRequest = new Promise<void>(resolve => { started = resolve; });
    const run = service.processDue(); await startedRequest;
    await fixture.prisma.$executeRaw`UPDATE integration_ingestion_rules SET version=version+1 WHERE id=${value.input.ruleId}::uuid`;
    pending!(); await run; started = undefined;
    expect((await service.list(fixture.actor, value.defect.id)).items[0]!.status).toBe('STALE');
    expect((await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: value.defect.id } })).description).toBe('保底：毛刺');
    mode = 'JSON'; const json = await source('JSON'); await json.enqueue(); await service.processDue();
    expect((await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: json.defect.id } })).description).toBe('JSON整理结果');
  });

  it('isolates a disabled organization before network and continues the next healthy task', async () => {
    mode = 'SUCCESS'; const disabled = await source(); await disabled.enqueue();
    const before = requests.length;
    await fixture.prisma.organization.update({ where: { id: fixture.actor.organizationId }, data: { status: 'DISABLED' } });
    try { await expect(service.processDue()).resolves.toBeUndefined(); } finally {
      await fixture.prisma.organization.update({ where: { id: fixture.actor.organizationId }, data: { status: 'ACTIVE' } });
    }
    expect(requests).toHaveLength(before);
    expect((await service.list(fixture.actor, disabled.defect.id)).items[0]!.status).toBe('FAILED');
    mode = 'SUCCESS'; const healthy = await source(); await healthy.enqueue(); await service.processDue();
    expect((await service.list(fixture.actor, healthy.defect.id)).items[0]!.status).toBe('APPLIED');
  });

  it('retries after key replacement using a new connection snapshot while preserving failed evidence', async () => {
    mode = 'EMPTY'; const value = await source(); await value.enqueue(); await service.processDue();
    const failed = (await service.list(fixture.actor, value.defect.id)).items[0]!;
    expect(failed.status).toBe('FAILED');
    const metadata = (await connections.list(fixture.actor, fixture.actor.organizationId)).find(row => row.id === connection.id)!;
    connection = await connections.update(fixture.actor, fixture.actor.organizationId, connection.id, { expectedVersion: metadata.version,
      name: metadata.name, baseUrl: metadata.baseUrl, models: metadata.models, defaultModel: metadata.defaultModel, enabled: true, apiKey: 'disposable-replaced-task-secret' }, randomUUID(), randomUUID());
    mode = 'SUCCESS';
    const retried = await service.action(fixture.actor, failed.id, { expectedVersion: failed.version }, false, randomUUID(), randomUUID());
    expect(retried.id).not.toBe(failed.id);
    expect(retried.connectionVersion).toBe(connection.version);
    await service.processDue();
    const tasks = (await service.list(fixture.actor, value.defect.id)).items;
    expect(tasks.find(task => task.id === failed.id)?.status).toBe('FAILED');
    expect(tasks.find(task => task.id === retried.id)?.status).toBe('APPLIED');
  });

  it('uses valid independent AI facts when the direct fallback is empty and clears only description issues', async () => {
    mode = 'SUCCESS'; const value = await source('TEXT', '');
    expect((await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: value.defect.id } })).registrationIssues).toContain('DESCRIPTION_REQUIRED');
    await value.enqueue();
    expect((await service.list(fixture.actor, value.defect.id)).items).toHaveLength(1);
    await service.processDue();
    const row = await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: value.defect.id } });
    expect(row.description).toBe('已选事实的整理结果');
    expect(row.registrationIssues).not.toContain('DESCRIPTION_REQUIRED');
    expect(row.registrationIssues).toContain('TRACE_CODE_REQUIRED');
    expect(row.pendingCompletion).toBe(true);
  });

  it('restores direct fallback for a new prompt and directly adopts its successful result', async () => {
    mode = 'SUCCESS'; const value = await source(); await value.enqueue(); await service.processDue();
    const nextRule = { ...value.input.rule, aiDescription: { ...value.input.rule.aiDescription!, prompt: '新版本整理{{fact}}。' } };
    await fixture.prisma.$executeRaw`UPDATE integration_ingestion_rules SET version=2,configuration=${JSON.stringify(nextRule)}::jsonb WHERE id=${value.input.ruleId}::uuid`;
    await fixture.prisma.$transaction(tx => service.enqueue(tx, fixture.actor, { ...value.input, ruleVersion: 2, rule: nextRule }));
    expect((await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: value.defect.id } })).description).toBe('保底：毛刺');
    mode = 'EMPTY'; await service.processDue();
    expect((await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: value.defect.id } })).description).toBe('保底：毛刺');
    const thirdRule = { ...nextRule, aiDescription: { ...nextRule.aiDescription, prompt: '第三版{{fact}}。' } };
    await fixture.prisma.$executeRaw`UPDATE integration_ingestion_rules SET version=3,configuration=${JSON.stringify(thirdRule)}::jsonb WHERE id=${value.input.ruleId}::uuid`;
    await fixture.prisma.$transaction(tx => service.enqueue(tx, fixture.actor, { ...value.input, ruleVersion: 3, rule: thirdRule }));
    mode = 'SUCCESS'; await service.processDue();
    expect((await service.list(fixture.actor, value.defect.id)).items[0]!.status).toBe('APPLIED');
  });

  it('creates a fresh current generation for A to B to A and deduplicates only that current input', async () => {
    mode = 'SUCCESS'; const value = await source(), before = requests.length;
    await Promise.all([value.enqueue(), value.enqueue()]);
    const first = (await service.list(fixture.actor, value.defect.id)).items[0]!;
    await fixture.prisma.$transaction(tx => service.enqueue(tx, fixture.actor, { ...value.input,
      fields: value.input.fields.map(field => ({ ...field, value: '输入B' })) }));
    await value.enqueue(); await value.enqueue();
    let tasks = (await service.list(fixture.actor, value.defect.id)).items;
    expect(tasks).toHaveLength(3);
    expect(tasks[0]!.id).not.toBe(first.id);
    await service.processDue(2);
    expect(requests).toHaveLength(before);
    await service.processDue();
    await Promise.all([value.enqueue(), value.enqueue(), fixture.prisma.$transaction(tx => service.enqueue(tx, fixture.actor, {
      ...value.input, fields: value.input.fields.map(field => ({ value: field.value, variable: field.variable, label: field.label, path: field.path })),
    }))]);
    tasks = (await service.list(fixture.actor, value.defect.id)).items;
    expect(tasks).toHaveLength(3);
    expect(tasks[0]!.status).toBe('APPLIED');
    expect(tasks.filter(task => task.status === 'STALE')).toHaveLength(2);
    expect(requests).toHaveLength(before + 1);
  });

  it('rechecks process write permission before replaying adoption or retry mutation responses', async () => {
    mode = 'SUCCESS'; const suggested = await source();
    await fixture.prisma.processDefect.update({ where: { id: suggested.defect.id }, data: { description: '人工事实', manualFields: ['description'] } });
    await suggested.enqueue(); await service.processDue();
    const adoptionTask = (await service.list(fixture.actor, suggested.defect.id)).items[0]!;
    expect(adoptionTask.status).toBe('SUGGESTED');
    const adoptionKey = randomUUID(), adoptionInput = { expectedVersion: adoptionTask.version };
    await service.action(fixture.actor, adoptionTask.id, adoptionInput, true, randomUUID(), adoptionKey);
    mode = 'EMPTY'; const failed = await source(); await failed.enqueue(); await service.processDue();
    const retryTask = (await service.list(fixture.actor, failed.defect.id)).items[0]!;
    expect(retryTask.status).toBe('FAILED');
    const retryKey = randomUUID(), retryInput = { expectedVersion: retryTask.version };
    await service.action(fixture.actor, retryTask.id, retryInput, false, randomUUID(), retryKey);
    const permissions = await fixture.prisma.permission.findMany({ where: { code: { in: ['process-quality:defects:write','process-quality:defects:read'] } } });
    await fixture.prisma.rolePermission.deleteMany({ where: { roleId: fixture.role.id, permissionId: { in: permissions.map(permission => permission.id) } } });
    try {
      await expect(service.action(fixture.actor, adoptionTask.id, adoptionInput, true, randomUUID(), adoptionKey)).rejects.toMatchObject({ status: 403 });
      await expect(service.action(fixture.actor, retryTask.id, retryInput, false, randomUUID(), retryKey)).rejects.toMatchObject({ status: 403 });
    } finally {
      await fixture.prisma.rolePermission.createMany({ data: permissions.map(permission => ({ roleId: fixture.role.id, permissionId: permission.id })) });
    }
  });

  it('keeps existing description and AI tasks behind the real ingestion update mask on unchanged and updated rows', async () => {
    mode = 'SUCCESS'; const source = await engineSource('获准来源事实', ['operationName']);
    const initial = await source.ingest(); await service.processDue();
    const before = await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: initial.row.id } });
    const calls = requests.length;
    const repeated = await source.ingest();
    expect(repeated.item.status).toBe('UNCHANGED');
    expect(repeated.row).toMatchObject({ description: before.description, descriptionDirect: before.descriptionDirect, version: before.version });
    expect((await service.list(fixture.actor, before.id)).items).toHaveLength(1);
    await service.processDue(); expect(requests).toHaveLength(calls);
    const changed = await source.ingest(source.configuration, { ...source.raw, operation: '复检' });
    expect(changed.item.status).toBe('UPDATED');
    expect(changed.row.description).toBe(before.description);
    expect((await service.list(fixture.actor, before.id)).items).toHaveLength(1);
  });

  it('marks a previously complete defect incomplete as soon as a new prompt restores an empty fallback', async () => {
    mode = 'SUCCESS'; const source = await engineSource('');
    const initial = await source.ingest(); await service.processDue();
    expect(await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: initial.row.id } })).toMatchObject({ pendingCompletion: false, registrationIssues: [] });
    const next = await source.changePrompt();
    const fallback = await source.ingest(next);
    expect(fallback.row).toMatchObject({ description: '', pendingCompletion: true, registrationIssues: ['DESCRIPTION_REQUIRED'] });
    mode = 'EMPTY'; await service.processDue();
    expect(await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: initial.row.id } })).toMatchObject({ description: '', pendingCompletion: true, registrationIssues: ['DESCRIPTION_REQUIRED'] });
  });

  it('restores description-required and preserves other source issues on empty fallback immediately and after failure', async () => {
    mode = 'SUCCESS'; const source = await engineSource('');
    const initial = await source.ingest(); await service.processDue();
    expect(await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: initial.row.id } })).toMatchObject({ pendingCompletion: false, registrationIssues: [] });
    const withIssue = { ...source.raw, line: { invalid: 'not-a-string' } };
    await source.ingest(source.configuration, withIssue);
    const next = await source.changePrompt();
    const fallback = await source.ingest(next, withIssue);
    expect(fallback.row.description).toBe('');
    expect(fallback.row.registrationIssues).toEqual(expect.arrayContaining(['DESCRIPTION_REQUIRED','lineCode:TYPE']));
    expect(fallback.row.pendingCompletion).toBe(true);
    mode = 'EMPTY'; await service.processDue();
    const failed = await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: initial.row.id } });
    expect(failed.registrationIssues).toEqual(expect.arrayContaining(['DESCRIPTION_REQUIRED','lineCode:TYPE']));
    expect(failed.pendingCompletion).toBe(true);
  });

  it('versions visible fallback facts, records history, rejects old CAS and synchronizes real ingestion source watermarks', async () => {
    mode = 'SUCCESS'; const source = await engineSource('保底版本事实');
    const initial = await source.ingest(); await service.processDue();
    const adopted = await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: initial.row.id } });
    const next = await source.changePrompt();
    const fallback = await source.ingest(next);
    expect(fallback.row.description).toBe('保底版本事实');
    expect(fallback.row.version).toBe(adopted.version + 1);
    expect(fallback.item.targetVersion).toBe(fallback.row.version);
    const [watermark] = await fixture.prisma.$queryRaw<{ target_version: number }[]>`SELECT target_version FROM integration_ingestion_target_versions WHERE organization_id=${fixture.actor.organizationId}::uuid AND target='PROCESS_DEFECT' AND target_id=${adopted.id}::uuid`;
    expect(watermark!.target_version).toBe(fallback.row.version);
    const [history] = await fixture.prisma.$queryRaw<{ after_facts: { description: string }; defect_version: number }[]>`SELECT after_facts,defect_version FROM process_defect_registration_history WHERE defect_id=${adopted.id}::uuid ORDER BY defect_version DESC,id DESC LIMIT 1`;
    expect(history).toMatchObject({ defect_version: fallback.row.version, after_facts: { description: '保底版本事实' } });
    await expect(fixture.ledger.update(fixture.actor, adopted.id, { expectedVersion: adopted.version, description: '旧界面修改' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    const repeated = await source.ingest(next, { ...source.raw, direct: undefined });
    expect(repeated.row.version).toBe(fallback.row.version);
    expect(repeated.row.descriptionDirect).toBe('保底版本事实');
    expect((await service.list(fixture.actor, adopted.id)).items).toHaveLength(2);
    const changed = await source.ingest(next, { ...source.raw, operation: '后续正常更新' });
    expect(changed.item.status).toBe('UPDATED');
    expect(changed.item.targetVersion).toBe(changed.row.version);
    await service.processDue();
    const current = await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: adopted.id } });
    expect(current.descriptionAiStatus).toBe('APPLIED');
    expect(current.manualFields).not.toContain('description');
  });

  it.each(['DISABLED','CLEARED','MODEL_REMOVED'] as const)('allows disabling an existing unchanged AI rule after its connection becomes %s while denying reenable and a new reference', async situation => {
    const source = await engineSource();
    const active = await engine.saveRule(fixture.actor, { ...source.configuration, expectedVersion: source.configuration.version, enabled: true }, randomUUID(), randomUUID(), source.configuration.id);
    let metadata = (await connections.list(fixture.actor, fixture.actor.organizationId)).find(row => row.id === connection.id)!;
    try {
      if (situation === 'CLEARED') connection = await connections.clear(fixture.actor, fixture.actor.organizationId, connection.id, { expectedVersion: metadata.version }, randomUUID(), randomUUID());
      else connection = await connections.update(fixture.actor, fixture.actor.organizationId, connection.id, { expectedVersion: metadata.version, name: metadata.name,
        baseUrl: metadata.baseUrl, models: situation === 'MODEL_REMOVED' ? ['model-a'] : metadata.models,
        defaultModel: 'model-a', enabled: situation !== 'DISABLED' }, randomUUID(), randomUUID());
      const disabled = await engine.saveRule(fixture.actor, { ...active, expectedVersion: active.version, enabled: false }, randomUUID(), randomUUID(), active.id);
      expect(disabled.enabled).toBe(false);
      expect(disabled.aiDescription).toMatchObject({ connectionId: connection.id, model: 'model-b', prompt: active.aiDescription!.prompt });
      await expect(engine.saveRule(fixture.actor, { ...disabled, expectedVersion: disabled.version, enabled: true }, randomUUID(), randomUUID(), disabled.id)).rejects.toMatchObject({
        response: { code: situation === 'MODEL_REMOVED' ? 'INGESTION_RULE_INVALID' : 'AI_CONNECTION_UNAVAILABLE' },
      });
      await expect(engine.saveRule(fixture.actor, { ...disabled, aiApplication: undefined, expectedVersion: disabled.version, aiDescription: { ...disabled.aiDescription!, connectionId: randomUUID() } }, randomUUID(), randomUUID(), disabled.id)).rejects.toMatchObject({ response: { code: 'AI_CONNECTION_NOT_FOUND' } });
    } finally {
      metadata = (await connections.list(fixture.actor, fixture.actor.organizationId)).find(row => row.id === connection.id)!;
      connection = await connections.update(fixture.actor, fixture.actor.organizationId, connection.id, { expectedVersion: metadata.version, name: metadata.name,
        baseUrl: metadata.baseUrl, models: ['model-a','model-b'], defaultModel: 'model-a', enabled: true, apiKey: 'disposable-admin-rule-restore-key' }, randomUUID(), randomUUID());
      await fixture.prisma.$executeRaw`UPDATE integration_ingestion_rules SET enabled=false,configuration=jsonb_set(configuration,'{enabled}','false'::jsonb) WHERE organization_id=${fixture.actor.organizationId}::uuid AND id=${active.id}::uuid`;
    }
  });

  it('binds an immutable published prompt, exposes newer revisions and requires explicit rule saving to switch', async () => {
    mode = 'SUCCESS'; const source = await engineSource();
    expect(source.configuration.aiApplication).toBeDefined();
    const applications = new AiApplicationService(fixture.prisma, new AdminMutationService(fixture.prisma, fixture.audit), connections, fixture.audit);
    const binding = source.configuration.aiApplication!;
    const original = await applications.read(fixture.actor, fixture.actor.organizationId, binding.applicationId);
    const edited = await applications.update(fixture.actor, fixture.actor.organizationId, original.id, { ...original, expectedVersion: original.version, prompt: '新发布{{fact}}' }, randomUUID(), randomUUID());
    const published = await applications.publish(fixture.actor, fixture.actor.organizationId, original.id, { expectedVersion: edited.version }, randomUUID(), randomUUID());
    const unchanged = (await engine.listRules(fixture.actor, {})).items.find(row => row.id === source.configuration.id)!;
    expect(unchanged.aiDescription!.prompt).toBe(source.configuration.aiDescription!.prompt);
    expect(unchanged.aiApplication!.publishedVersion).toBe(binding.publishedVersion);
    expect(unchanged.aiApplicationLatestVersion).toBe(published.publishedVersion);
    const first = await source.ingest();
    const switched = await engine.saveRule(fixture.actor, { ...unchanged, aiDescription: undefined, expectedVersion: unchanged.version,
      aiApplication: { ...binding, publishedVersion: published.publishedVersion! } }, randomUUID(), randomUUID(), unchanged.id);
    expect(switched.aiDescription!.prompt).toBe('新发布{{fact}}');
    const [oldTask] = await fixture.prisma.$queryRaw<{ prompt: string; application_version: number }[]>`SELECT prompt,application_version FROM integration_ai_description_tasks WHERE defect_id=${first.row.id}::uuid`;
    expect(oldTask).toMatchObject({ prompt: source.configuration.aiDescription!.prompt, application_version: binding.publishedVersion });
    await expect(engine.saveRule(fixture.actor, { ...switched, expectedVersion: switched.version, aiDescription: { ...switched.aiDescription!, prompt: '客户端伪造{{fact}}' } }, randomUUID(), randomUUID(), switched.id)).rejects.toMatchObject({ response: { code: 'INGESTION_RULE_INVALID' } });
  });

  it('keeps direct fallback and avoids HTTP after application disable; reenabling permits controlled task retry', async () => {
    mode = 'SUCCESS'; const source = await engineSource('应用停用保底');
    const applications = new AiApplicationService(fixture.prisma, new AdminMutationService(fixture.prisma, fixture.audit), connections, fixture.audit);
    const application = await applications.read(fixture.actor, fixture.actor.organizationId, source.configuration.aiApplication!.applicationId);
    const disabled = await applications.update(fixture.actor, fixture.actor.organizationId, application.id, { ...application, enabled: false, expectedVersion: application.version }, randomUUID(), randomUUID());
    const count = requests.length;
    const imported = await source.ingest();
    await service.processDue();
    expect(requests).toHaveLength(count);
    expect(imported.row.description).toBe('应用停用保底');
    const failed = (await service.list(fixture.actor, imported.row.id)).items[0]!;
    expect(failed).toMatchObject({ status: 'FAILED', errorCode: 'AI_APPLICATION_UNAVAILABLE' });
    await applications.update(fixture.actor, fixture.actor.organizationId, application.id, { ...disabled, enabled: true, expectedVersion: disabled.version }, randomUUID(), randomUUID());
    await service.action(fixture.actor, failed.id, { expectedVersion: failed.version }, false, randomUUID(), randomUUID());
    await service.processDue();
    expect(requests).toHaveLength(count + 1);
    expect((await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: imported.row.id } })).description).toBe('已选事实的整理结果');
  });

  it('rejects an in-flight application disable-enable ABA without altering fallback or old task snapshot', async () => {
    mode = 'WAIT'; const source = await engineSource('ABA保底'); const imported = await source.ingest();
    const applications = new AiApplicationService(fixture.prisma, new AdminMutationService(fixture.prisma, fixture.audit), connections, fixture.audit);
    const application = await applications.read(fixture.actor, fixture.actor.organizationId, source.configuration.aiApplication!.applicationId);
    const startedRequest = new Promise<void>(resolve => { started = resolve; });
    const run = service.processDue(); await startedRequest;
    try {
      const disabled = await applications.update(fixture.actor, fixture.actor.organizationId, application.id, { ...application, enabled: false, expectedVersion: application.version }, randomUUID(), randomUUID());
      await applications.update(fixture.actor, fixture.actor.organizationId, application.id, { ...disabled, enabled: true, expectedVersion: disabled.version }, randomUUID(), randomUUID());
    } finally { pending!(); await run; started = undefined; mode = 'SUCCESS'; }
    expect((await service.list(fixture.actor, imported.row.id)).items[0]).toMatchObject({ status: 'FAILED', errorCode: 'AI_APPLICATION_VERSION_CONFLICT' });
    expect((await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: imported.row.id } })).description).toBe('ABA保底');
  });

  it('rechecks configuration and target permissions on successful rule-save replay without granting business writes', async () => {
    mode = 'SUCCESS'; const source = await engineSource();
    const key = randomUUID(), input = { ...source.configuration, aiApplication: undefined, aiDescription: { ...source.configuration.aiDescription!, prompt: '变更配置{{fact}}' }, expectedVersion: source.configuration.version };
    const saved = await engine.saveRule(fixture.actor, input, randomUUID(), key, source.configuration.id);
    expect(await engine.saveRule(fixture.actor, input, randomUUID(), key, source.configuration.id)).toEqual(saved);
    for (const code of ['process-quality:defects:write', 'ai:applications:read']) {
      const permission = await fixture.prisma.permission.findUniqueOrThrow({ where: { code } });
      await fixture.prisma.rolePermission.deleteMany({ where: { roleId: fixture.role.id, permissionId: permission.id } });
      try { await expect(engine.saveRule(fixture.actor, input, randomUUID(), key, source.configuration.id)).rejects.toMatchObject({ status: 403 }); }
      finally { await fixture.prisma.rolePermission.create({ data: { roleId: fixture.role.id, permissionId: permission.id } }); }
    }
  });

  it.each(['binding', 'inline', 'both'] as const)('allows a scoped unchanged %s AI rule to be disabled and replayed without configuration read', async representation => {
    mode = 'SUCCESS'; const value = await engineSource();
    const active = await engine.saveRule(fixture.actor, { ...value.configuration, expectedVersion: value.configuration.version, enabled: true }, randomUUID(), randomUUID(), value.configuration.id);
    const input = { ...active, expectedVersion: active.version, enabled: false,
      aiApplication: representation === 'inline' ? undefined : active.aiApplication,
      aiDescription: representation === 'binding' ? undefined : active.aiDescription };
    const configurationPermission = await fixture.prisma.permission.findUniqueOrThrow({ where: { code: 'ai:applications:read' } });
    const runPermission = await fixture.prisma.permission.findUniqueOrThrow({ where: { code: 'ingestion:run' } });
    const removed = [configurationPermission.id, runPermission.id];
    await fixture.prisma.rolePermission.deleteMany({ where: { roleId: fixture.role.id, permissionId: { in: removed } } });
    try {
      const key = randomUUID();
      const disabled = await engine.saveRule(fixture.actor, input, randomUUID(), key, active.id);
      expect(disabled).toMatchObject({ enabled: false, aiApplication: active.aiApplication, aiDescription: active.aiDescription });
      expect(disabled).not.toHaveProperty('configurationReadRequired');
      expect(await engine.saveRule(fixture.actor, input, randomUUID(), key, active.id)).toEqual(disabled);
      await expect(engine.saveRule(fixture.actor, { ...disabled, expectedVersion: disabled.version, enabled: true }, randomUUID(), randomUUID(), disabled.id)).rejects.toMatchObject({ status: 403 });
      await expect(engine.saveRule(fixture.actor, { ...disabled, expectedVersion: disabled.version, aiApplication: undefined,
        aiDescription: { ...disabled.aiDescription!, prompt: '擅改提示词{{fact}}' } }, randomUUID(), randomUUID(), disabled.id)).rejects.toMatchObject({ status: 403 });
      await expect(engine.saveRule(fixture.actor, { ...disabled, expectedVersion: disabled.version,
        aiApplication: { ...disabled.aiApplication!, publishedVersion: disabled.aiApplication!.publishedVersion + 1 }, aiDescription: undefined }, randomUUID(), randomUUID(), disabled.id)).rejects.toMatchObject({ status: 403 });
      await expect(engine.saveRule(fixture.actor, { ...disabled, aiApplication: undefined, aiDescription: undefined, expectedVersion: disabled.version }, randomUUID(), randomUUID(), disabled.id)).rejects.toMatchObject({ status: 403 });
      await expect(engine.saveRule(fixture.actor, { ...disabled, name: '未授权新规则' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
      for (const code of ['process-quality:defects:write', 'ingestion:manage']) {
        const permission = await fixture.prisma.permission.findUniqueOrThrow({ where: { code } });
        await fixture.prisma.rolePermission.deleteMany({ where: { roleId: fixture.role.id, permissionId: permission.id } });
        try { await expect(engine.saveRule(fixture.actor, input, randomUUID(), key, active.id)).rejects.toMatchObject({ status: 403 }); }
        finally { await fixture.prisma.rolePermission.create({ data: { roleId: fixture.role.id, permissionId: permission.id } }); }
      }
    } finally {
      for (const permissionId of removed) await fixture.prisma.rolePermission.create({ data: { roleId: fixture.role.id, permissionId } });
      await fixture.prisma.$executeRaw`UPDATE integration_ingestion_rules SET enabled=false,configuration=jsonb_set(configuration,'{enabled}','false'::jsonb) WHERE id=${active.id}::uuid AND organization_id=${fixture.actor.organizationId}::uuid`;
    }
  });

  it('limits the unchanged AI disable exemption to the original endpoint, target and organization', async () => {
    mode = 'SUCCESS'; const value = await engineSource();
    const input = { ...value.configuration, expectedVersion: value.configuration.version, enabled: false };
    const permission = await fixture.prisma.permission.findUniqueOrThrow({ where: { code: 'ai:applications:read' } });
    await fixture.prisma.rolePermission.deleteMany({ where: { roleId: fixture.role.id, permissionId: permission.id } });
    try {
      const endpoint = await fixture.prisma.integrationEndpoint.create({ data: { organizationId: fixture.actor.organizationId, code: randomUUID(), name: '另一来源', sourceCode: 'TEST', sourceName: '范围验证', status: 'ENABLED' } });
      await expect(engine.saveRule(fixture.actor, { ...input, endpointId: endpoint.id }, randomUUID(), randomUUID(), input.id)).rejects.toMatchObject({ response: { code: 'INGESTION_RULE_INVALID' } });
      const foreign = await fixture.prisma.organization.create({ data: { code: randomUUID(), name: '停用边界另一组织', type: 'INTERNAL' } });
      await expect(engine.saveRule({ ...fixture.actor, scopeOrganizationId: foreign.id }, input, randomUUID(), randomUUID(), input.id)).rejects.toMatchObject({ status: 403 });
      await expect(engine.saveRule(fixture.actor, { ...input, target: 'MATERIAL', sourceTimezone: undefined, mapping: { code: 'code', name: 'name' }, updateFields: ['name'], aiDescription: undefined, aiApplication: undefined }, randomUUID(), randomUUID(), input.id)).rejects.toMatchObject({ status: 403 });
      await expect(engine.saveRule(fixture.actor, { ...input, enabled: true }, randomUUID(), randomUUID(), input.id)).rejects.toMatchObject({ status: 403 });
    } finally { await fixture.prisma.rolePermission.create({ data: { roleId: fixture.role.id, permissionId: permission.id } }); }
  });

  it('keeps a disable replay exemption tied to its original operation after later configuration changes and protects older receipts', async () => {
    mode = 'SUCCESS'; const value = await engineSource();
    const key = randomUUID(), input = { ...value.configuration, expectedVersion: value.configuration.version, enabled: false };
    const disabled = await engine.saveRule(fixture.actor, input, randomUUID(), key, input.id);
    const changedKey = randomUUID(), changedInput = { ...disabled, expectedVersion: disabled.version, aiApplication: undefined,
      aiDescription: { ...disabled.aiDescription!, prompt: '后续合法变更{{fact}}' } };
    await engine.saveRule(fixture.actor, changedInput, randomUUID(), changedKey, input.id);
    const permission = await fixture.prisma.permission.findUniqueOrThrow({ where: { code: 'ai:applications:read' } });
    await fixture.prisma.rolePermission.deleteMany({ where: { roleId: fixture.role.id, permissionId: permission.id } });
    try {
      expect(await engine.saveRule(fixture.actor, input, randomUUID(), key, input.id)).toEqual(disabled);
      await expect(engine.saveRule(fixture.actor, changedInput, randomUUID(), changedKey, input.id)).rejects.toMatchObject({ status: 403 });
      await fixture.prisma.$executeRaw`UPDATE admin_mutations SET response=jsonb_set(response,'{value}',(response->'value')-'configurationReadRequired') WHERE organization_id=${fixture.actor.organizationId}::uuid AND actor_user_id=${fixture.actor.id}::uuid AND key=${changedKey}`;
      await expect(engine.saveRule(fixture.actor, changedInput, randomUUID(), changedKey, input.id)).rejects.toMatchObject({ status: 403 });
    } finally { await fixture.prisma.rolePermission.create({ data: { roleId: fixture.role.id, permissionId: permission.id } }); }
  });

  it('guards an existing null-reference task through its same-version migrated rule binding without rewriting the task', async () => {
    mode = 'SUCCESS'; const value = await source(); await value.enqueue();
    const applications = new AiApplicationService(fixture.prisma, new AdminMutationService(fixture.prisma, fixture.audit), connections, fixture.audit);
    const resolved = await fixture.prisma.$transaction(tx => applications.importLegacy(tx, fixture.actor, value.input.rule.name, value.input.rule.aiDescription!));
    await fixture.prisma.$executeRaw`UPDATE integration_ingestion_rules SET configuration=configuration || ${JSON.stringify({ aiApplication: resolved.binding })}::jsonb WHERE id=${value.input.ruleId}::uuid`;
    const application = await applications.read(fixture.actor, fixture.actor.organizationId, resolved.binding.applicationId);
    await applications.update(fixture.actor, fixture.actor.organizationId, application.id, { ...application, enabled: false, expectedVersion: application.version }, randomUUID(), randomUUID());
    const count = requests.length; await service.processDue();
    expect(requests).toHaveLength(count);
    const [task] = await fixture.prisma.$queryRaw<{ status: string; error_code: string; application_id: string | null; prompt: string }[]>`SELECT status,error_code,application_id,prompt FROM integration_ai_description_tasks WHERE defect_id=${value.defect.id}::uuid`;
    expect(task).toMatchObject({ status: 'FAILED', error_code: 'AI_APPLICATION_UNAVAILABLE', application_id: null, prompt: value.input.rule.aiDescription!.prompt });
    expect((await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: value.defect.id } })).description).toBe(value.input.direct);
  });

  it('rechecks the run grant when replaying a successful enabled rule save', async () => {
    mode = 'SUCCESS'; const value = await engineSource();
    const key = randomUUID(), input = { ...value.configuration, expectedVersion: value.configuration.version, enabled: true };
    const saved = await engine.saveRule(fixture.actor, input, randomUUID(), key, value.configuration.id);
    const permission = await fixture.prisma.permission.findUniqueOrThrow({ where: { code: 'ingestion:run' } });
    await fixture.prisma.rolePermission.deleteMany({ where: { roleId: fixture.role.id, permissionId: permission.id } });
    try { await expect(engine.saveRule(fixture.actor, input, randomUUID(), key, value.configuration.id)).rejects.toMatchObject({ status: 403 }); }
    finally {
      await fixture.prisma.rolePermission.create({ data: { roleId: fixture.role.id, permissionId: permission.id } });
      await engine.saveRule(fixture.actor, { ...saved, expectedVersion: saved.version, enabled: false }, randomUUID(), randomUUID(), saved.id);
    }
  });

  it('guards enqueue from an old job snapshot after migration while preserving booked fallback and the old job configuration', async () => {
    mode = 'SUCCESS'; const value = await engineSource('旧任务直接保底');
    const { preview } = await value.prepare();
    const imported = await engine.submitImport(fixture.actor, { previewId: preview.previewId, confirmed: true }, randomUUID(), randomUUID());
    const jobId = imported.jobIds[0]!;
    await fixture.prisma.$executeRaw`UPDATE integration_ingestion_jobs SET rule_snapshot=rule_snapshot-'aiApplication' WHERE id=${jobId}::uuid`;
    const [before] = await fixture.prisma.$queryRaw<{ rule_snapshot: unknown }[]>`SELECT rule_snapshot FROM integration_ingestion_jobs WHERE id=${jobId}::uuid`;
    const applications = new AiApplicationService(fixture.prisma, new AdminMutationService(fixture.prisma, fixture.audit), connections, fixture.audit);
    const application = await applications.read(fixture.actor, fixture.actor.organizationId, value.configuration.aiApplication!.applicationId);
    await applications.update(fixture.actor, fixture.actor.organizationId, application.id, { ...application, enabled: false, expectedVersion: application.version }, randomUUID(), randomUUID());
    const count = requests.length; await engine.processDue(20); await service.processDue();
    expect(requests).toHaveLength(count);
    const item = (await engine.listItems(fixture.actor, jobId, {})).items[0]!;
    expect(item.status).toBe('INSERTED');
    expect((await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: item.targetId! } })).description).toBe('旧任务直接保底');
    expect((await service.list(fixture.actor, item.targetId!)).items[0]).toMatchObject({ status: 'FAILED', errorCode: 'AI_APPLICATION_UNAVAILABLE' });
    const [after] = await fixture.prisma.$queryRaw<{ rule_snapshot: unknown }[]>`SELECT rule_snapshot FROM integration_ingestion_jobs WHERE id=${jobId}::uuid`;
    expect(after!.rule_snapshot).toEqual(before!.rule_snapshot);
  });

  it('checks availability ABA for a migrated null-reference task while retaining its original prompt', async () => {
    mode = 'WAIT'; const value = await source(); await value.enqueue();
    const applications = new AiApplicationService(fixture.prisma, new AdminMutationService(fixture.prisma, fixture.audit), connections, fixture.audit);
    const resolved = await fixture.prisma.$transaction(tx => applications.importLegacy(tx, fixture.actor, value.input.rule.name, value.input.rule.aiDescription!));
    await fixture.prisma.$executeRaw`UPDATE integration_ingestion_rules SET configuration=configuration || ${JSON.stringify({ aiApplication: resolved.binding })}::jsonb WHERE id=${value.input.ruleId}::uuid`;
    const application = await applications.read(fixture.actor, fixture.actor.organizationId, resolved.binding.applicationId);
    const startedRequest = new Promise<void>(resolve => { started = resolve; });
    const run = service.processDue(); await startedRequest;
    try {
      const disabled = await applications.update(fixture.actor, fixture.actor.organizationId, application.id, { ...application, enabled: false, expectedVersion: application.version }, randomUUID(), randomUUID());
      await applications.update(fixture.actor, fixture.actor.organizationId, application.id, { ...disabled, enabled: true, expectedVersion: disabled.version }, randomUUID(), randomUUID());
    } finally { pending!(); await run; started = undefined; mode = 'SUCCESS'; }
    expect((await service.list(fixture.actor, value.defect.id)).items[0]).toMatchObject({ status: 'FAILED', errorCode: 'AI_APPLICATION_VERSION_CONFLICT' });
    const [snapshot] = await fixture.prisma.$queryRaw<{ prompt: string; application_id: string | null }[]>`SELECT prompt,application_id FROM integration_ai_description_tasks WHERE defect_id=${value.defect.id}::uuid`;
    expect(snapshot).toEqual({ prompt: value.input.rule.aiDescription!.prompt, application_id: null });
  });

  it('allows business AI preview with only ingestion run and process write after configuration read is revoked', async () => {
    mode = 'SUCCESS'; const value = await source();
    const permissions = await fixture.prisma.permission.findMany({ where: { code: { in: ['configuration:read', 'ai:applications:read', 'ai:connections:read'] } } });
    await fixture.prisma.rolePermission.deleteMany({ where: { roleId: fixture.role.id, permissionId: { in: permissions.map(permission => permission.id) } } });
    try {
      expect(await service.preview(fixture.actor, { connectionId: connection.id, model: 'model-b', prompt: '整理{{fact}}', fields: value.input.fields,
        output: value.input.rule.aiDescription!.output })).toBe('已选事实的整理结果');
      const permission = await fixture.prisma.permission.findUniqueOrThrow({ where: { code: 'process-quality:defects:write' } });
      await fixture.prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: fixture.role.id, permissionId: permission.id } } });
      try {
        await expect(service.preview(fixture.actor, { connectionId: connection.id, model: 'model-b', prompt: '整理{{fact}}', fields: value.input.fields,
          output: value.input.rule.aiDescription!.output })).rejects.toMatchObject({ status: 403 });
      } finally { await fixture.prisma.rolePermission.create({ data: { roleId: fixture.role.id, permissionId: permission.id } }); }
    } finally { await fixture.prisma.rolePermission.createMany({ data: permissions.map(permission => ({ roleId: fixture.role.id, permissionId: permission.id })) }); }
  });

  it('stales a pending background AI task after deleting the ledger without another provider request or source write', async () => {
    mode = 'SUCCESS'; const value = await source(); await value.enqueue();
    const current = await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: value.defect.id } });
    await fixture.ledger.deleteDefects(fixture.actor, { sources: [{ defectId: current.id, expectedVersion: current.version }], reason: '取消误导入不良' }, randomUUID(), randomUUID());
    const before = await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: current.id } }), calls = requests.length;
    await service.processDue();
    expect(requests).toHaveLength(calls);
    expect((await service.list(fixture.actor, current.id)).items[0]).toMatchObject({ status: 'STALE' });
    expect(await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: current.id } })).toEqual(before);
  });

  it('discards an actual in-flight AI response after the source is deleted', async () => {
    mode = 'WAIT'; const value = await source(); await value.enqueue();
    const startedRequest = new Promise<void>(resolve => { started = resolve; });
    const run = service.processDue(); await startedRequest;
    let deleted: object | undefined;
    try {
      const current = await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: value.defect.id } });
      await fixture.ledger.deleteDefects(fixture.actor, { sources: [{ defectId: current.id, expectedVersion: current.version }], reason: '网络响应前确认删除' }, randomUUID(), randomUUID());
      deleted = await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: current.id } });
    } finally { pending!(); await run; started = undefined; mode = 'SUCCESS'; }
    expect((await service.list(fixture.actor, value.defect.id)).items[0]).toMatchObject({ status: 'STALE' });
    expect(await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: value.defect.id } })).toEqual(deleted!);
  });

  it('skips an IMS identity redelivery after deletion and preserves its deduplication watermark', async () => {
    mode = 'SUCCESS'; const value = await engineSource(), initial = await value.ingest();
    const [watermark] = await fixture.prisma.$queryRaw<object[]>`SELECT * FROM integration_ingestion_target_versions WHERE organization_id=${fixture.actor.organizationId}::uuid AND target='PROCESS_DEFECT' AND target_id=${initial.row.id}::uuid`;
    const current = await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: initial.row.id } });
    await fixture.ledger.deleteDefects(fixture.actor, { sources: [{ defectId: current.id, expectedVersion: current.version }], reason: '入库后确认删除' }, randomUUID(), randomUUID());
    const next = await value.prepare(value.configuration, { ...value.raw, operation: '下一道工序' });
    expect(next.preview).toMatchObject({ action: 'EXISTING_SKIPPED', errorCode: 'PROCESS_DEFECT_ARCHIVED', targetId: initial.row.id });
    const imported = await engine.submitImport(fixture.actor, { previewId: next.preview.previewId, confirmed: true }, randomUUID(), randomUUID());
    await engine.processDue(20);
    const item = (await engine.listItems(fixture.actor, imported.jobIds[0]!, {})).items[0]!;
    expect(item).toMatchObject({ status: 'EXISTING_SKIPPED', errorCode: 'PROCESS_DEFECT_ARCHIVED', targetId: initial.row.id });
    const [after] = await fixture.prisma.$queryRaw<object[]>`SELECT * FROM integration_ingestion_target_versions WHERE organization_id=${fixture.actor.organizationId}::uuid AND target='PROCESS_DEFECT' AND target_id=${initial.row.id}::uuid`;
    expect(after).toEqual(watermark);
    expect(await fixture.prisma.processDefect.count({ where: { organizationId: fixture.actor.organizationId, externalRecordKey: value.raw.id as string } })).toBe(1);
  });

  it('isolates a soft deletion during actual HTTP without reviving the protected identity', async () => {
    mode = 'WAIT'; const deleted = await source(); await deleted.enqueue();
    const startedRequest = new Promise<void>(resolve => { started = resolve; });
    const run = service.processDue(); await startedRequest;
    try {
      await fixture.prisma.organization.update({ where: { id: fixture.actor.organizationId }, data: { status: 'DISABLED', deletedAt: new Date() } });
    } finally { pending!(); await run; started = undefined; }
    const [task] = await fixture.prisma.$queryRaw<{ status: string }[]>`SELECT status FROM integration_ai_description_tasks WHERE defect_id=${deleted.defect.id}::uuid`;
    expect(task!.status).toBe('FAILED');
    expect((await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: deleted.defect.id } })).description).toBe('保底：毛刺');
  });
});
