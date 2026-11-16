import 'reflect-metadata';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { encryptSecret } from '../../src/common/security/security-keyring.js';
import { AiConnectionService } from '../../src/modules/ai-configuration/ai-connection.service.js';
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
    for (const code of ['ingestion:read','ingestion:run','ingestion:manage','integration:receipts:read','integration:payload:read']) {
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
      return engine.saveRule(fixture.actor, { ...rule, expectedVersion: rule.version, aiDescription: { ...rule.aiDescription!, prompt: `新版本${rule.version + 1}整理{{fact}}。` } } as SaveIngestionRuleDto, randomUUID(), randomUUID(), rule.id);
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
    expect(preview.differences.find(difference => difference.field === 'aiDescription')?.after).toContain('新版本');
    const queued = await engine.submitImport(fixture.actor, { previewId: preview.previewId, confirmed: true }, randomUUID(), randomUUID()); await engine.processDue(20);
    const pending = (await engine.listItems(fixture.actor, queued.jobIds[0]!, {})).items[0]!;
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
      await expect(engine.saveRule(fixture.actor, { ...disabled, expectedVersion: disabled.version, aiDescription: { ...disabled.aiDescription!, connectionId: randomUUID() } }, randomUUID(), randomUUID(), disabled.id)).rejects.toMatchObject({ response: { code: 'AI_CONNECTION_NOT_FOUND' } });
    } finally {
      metadata = (await connections.list(fixture.actor, fixture.actor.organizationId)).find(row => row.id === connection.id)!;
      connection = await connections.update(fixture.actor, fixture.actor.organizationId, connection.id, { expectedVersion: metadata.version, name: metadata.name,
        baseUrl: metadata.baseUrl, models: ['model-a','model-b'], defaultModel: 'model-a', enabled: true, apiKey: 'disposable-admin-rule-restore-key' }, randomUUID(), randomUUID());
      await fixture.prisma.$executeRaw`UPDATE integration_ingestion_rules SET enabled=false,configuration=jsonb_set(configuration,'{enabled}','false'::jsonb) WHERE organization_id=${fixture.actor.organizationId}::uuid AND id=${active.id}::uuid`;
    }
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
