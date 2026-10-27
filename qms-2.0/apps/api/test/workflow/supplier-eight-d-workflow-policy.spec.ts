import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface.js';
import { WorkflowValidationService, type WorkflowDraft } from '../../src/modules/workflow/workflow-validation.service.js';
import { WorkflowClosureTemplateService } from '../../src/modules/workflow/workflow-closure-template.service.js';
import { CreateWorkflowDto } from '../../src/modules/workflow/workflow.dto.js';
import { WorkflowController } from '../../src/modules/workflow/workflow.controller.js';
import { WorkflowDefinitionService } from '../../src/modules/workflow/workflow-definition.service.js';
import { isControlledEightDVersion, isDomainControlledNode } from '../../src/modules/workflow/workflow-runtime-policy.js';
import type { Prisma } from '../../src/generated/prisma/client.js';

const handling = () => ({ schemaVersion: 1, reminderEveryHours: null });
const graph = (): WorkflowDraft => ({
  nodes: [
    { id: 'owner', type: 'ACTION', name: 'Owner', config: { isStart: true, assignment: { permission: 'supplier-quality:responses:write' }, supplierEightD: handling() } },
    { id: 'review', type: 'APPROVAL', name: 'Review', config: { closureReview: { schemaVersion: 1, policy: 'SUPPLIER', domainCode: 'supplier-quality' } } },
    { id: 'close', type: 'CLOSE', name: 'Close', config: { isEnd: true, assignment: { permission: 'workflow:act' } } },
  ],
  transitions: [
    { id: 'submit', from: 'owner', to: 'review', action: 'SUBMIT' },
    { id: 'approve', from: 'review', to: 'close', action: 'APPROVE' },
    { id: 'return', from: 'review', to: 'owner', action: 'RETURN' },
  ],
});
const transport = (draft: WorkflowDraft) => validate(plainToInstance(CreateWorkflowDto, { code: 'SUPPLIER', name: 'Supplier', ...draft }), { whitelist: true, forbidNonWhitelisted: true });

describe('bounded supplier 8D handling workflow policy', () => {
  const validation = new WorkflowValidationService();
  const templates = new WorkflowClosureTemplateService({} as never, {} as never, {} as never);

  it('initializes only the SUPPLIER supplier-quality candidate with the fixed marker and response permission', async () => {
    const draft = templates['graph']({ code: 'SUPPLIER', name: 'Supplier', domainCode: 'supplier-quality', policy: 'SUPPLIER' });
    expect(draft.nodes[0]!.config).toEqual(graph().nodes[0]!.config);
    expect(draft.transitions).toEqual([
      { id: 'submit', from: 'owner', to: 'closure', action: 'SUBMIT' },
      { id: 'approve', from: 'closure', to: 'close', action: 'APPROVE' },
      { id: 'return', from: 'closure', to: 'owner', action: 'RETURN' },
    ]);
    expect(validation.validateDraft(draft)).toEqual({ valid: true, errors: [] });
    expect(await transport(draft)).toHaveLength(0);
  });

  it('accepts the direct unconditional supplier graph at service and HTTP DTO boundaries', async () => {
    expect(validation.validateDraft(graph())).toEqual({ valid: true, errors: [] });
    expect(await transport(graph())).toHaveLength(0);
  });

  it.each([true, false])('validates transformed HTTP nodes without inventing absent markers (controlled=%p)', async controlled => {
    const draft = graph();
    if (!controlled) delete draft.nodes[0]!.config!.supplierEightD;
    const dto = plainToInstance(CreateWorkflowDto, { code: 'SUPPLIER', name: 'Supplier', ...draft });
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    expect(validation.validateDraft({ nodes: dto.nodes as unknown as WorkflowDraft['nodes'], transitions: dto.transitions })).toEqual({ valid: true, errors: [] });
  });

  it.each([true, false])('checks the fixed organization/version with literal marker keys (found=%p)', async found => {
    let sql = ''; let parameters: unknown[] = [];
    const tx = { $queryRaw: async (parts: TemplateStringsArray, ...values: unknown[]) => {
      sql = parts.join('?'); parameters = values;
      return found ? [{ id: 'owner' }] : [];
    } } as unknown as Prisma.TransactionClient;
    expect(await isControlledEightDVersion(tx, 'organization', 'fixed-version')).toBe(found);
    expect(sql).toContain("AND (config ? 'processEightD' OR config ? 'supplierEightD') LIMIT 1");
    expect(sql).toContain('organization_id = ?::uuid AND workflow_version_id = ?::uuid');
    expect(parameters).toEqual(['organization', 'fixed-version']);
  });

  it('does not treat a failed whole-version lookup as an ordinary legacy version', async () => {
    const tx = { $queryRaw: async () => { throw new Error('QUERY_FAILED'); } } as unknown as Prisma.TransactionClient;
    await expect(isControlledEightDVersion(tx, 'organization', 'fixed-version')).rejects.toThrow('QUERY_FAILED');
  });

  it.each([undefined, null, false, [], 'supplier', {}, { schemaVersion: 2, reminderEveryHours: null },
    { schemaVersion: 1 }, { ...handling(), reminderEveryHours: 24 }, { ...handling(), reminderEveryHours: false },
    { ...handling(), defaultSlaMinutes: 60 }, { ...handling(), extensionPolicy: 'LEADER_THEN_PROFESSIONAL' },
    { ...handling(), bypass: true }])('fails closed for every declared malformed supplier marker: %p', async supplierEightD => {
    const draft = graph(); draft.nodes[0]!.config!.supplierEightD = supplierEightD;
    expect(isDomainControlledNode(draft.nodes[0] as { config: unknown })).toBe(true);
    expect(validation.validateDraft(draft).valid).toBe(false);
    // Undefined cannot be represented as a declared JSON property on HTTP.
    if (supplierEightD !== undefined) expect(await transport(draft)).not.toHaveLength(0);
  });

  it.each(['slaMinutes', 'reminders', 'escalation', 'closureReview', 'processEightD'])('rejects generic or internal owner config: %s', field => {
    const draft = graph(); draft.nodes[0]!.config![field] = field === 'slaMinutes' ? 60 : field === 'reminders' ? [] : {};
    expect(validation.validateDraft(draft).valid).toBe(false);
  });

  it.each([
    { permission: 'workflow:act' }, { permission: 'supplier-quality:responses:write', roleCode: 'SQE' },
    { assigneeUserId: '00000000-0000-4000-8000-000000000001' }, 'SQE',
  ])('rejects a substitute or additional static assignment: %p', assignment => {
    const draft = graph(); draft.nodes[0]!.config!.assignment = assignment;
    expect(validation.validateDraft(draft).valid).toBe(false);
  });

  it.each(['APPROVAL', 'CC', 'CLOSE'])('rejects a marked %s node instead of the ACTION owner', type => {
    const draft = graph(); draft.nodes[0]!.type = type;
    expect(validation.validateDraft(draft).valid).toBe(false);
  });

  it.each(['isStart', 'isEnd'])('rejects an invalid supplier owner %s flag', field => {
    const draft = graph(); draft.nodes[0]!.config![field] = field === 'isEnd';
    expect(validation.validateDraft(draft).valid).toBe(false);
  });

  it.each(['SUBMIT', 'RETURN'])('requires a direct unconditional %s route', action => {
    const conditional = graph(); conditional.transitions.find(edge => edge.action === action)!.condition = { field: 'severity', operator: 'eq', value: 'HIGH' };
    expect(validation.validateDraft(conditional).valid).toBe(false);
    const missing = graph(); missing.transitions = missing.transitions.filter(edge => edge.action !== action);
    expect(validation.validateDraft(missing).valid).toBe(false);
  });

  it('rejects extra owner actions, a closure bypass or a duplicate handling marker', () => {
    const extra = graph(); extra.transitions.push({ id: 'extra', from: 'owner', to: 'close', action: 'SUBMIT' });
    expect(validation.validateDraft(extra).valid).toBe(false);
    const duplicate = graph(); duplicate.nodes[2]!.config!.supplierEightD = handling();
    expect(validation.validateDraft(duplicate).valid).toBe(false);
  });

  it.each([
    ['INTERNAL', 'supplier-quality'], ['SUPPLIER', 'process-quality'], ['SUPPLIER', 'customer-quality'],
    ['SUPPLIER', 'new-product-quality'], ['SUPPLIER', 'unknown-domain'],
  ])('rejects the supplier owner paired with %s / %s', (policy, domainCode) => {
    const draft = graph(); draft.nodes[1]!.config!.closureReview = { schemaVersion: 1, policy, domainCode };
    expect(validation.validateDraft(draft).valid).toBe(false);
  });

  it('rejects the marker with no supplier gate or a second domain gate', () => {
    const missing = graph(); delete missing.nodes[1]!.config!.closureReview;
    expect(validation.validateDraft(missing).valid).toBe(false);
    const second = graph(); second.nodes.push({ id: 'other', type: 'APPROVAL', name: 'Other', config: { closureReview: { schemaVersion: 1, policy: 'SUPPLIER', domainCode: 'other' } } });
    expect(validation.validateDraft(second).valid).toBe(false);
  });

  it('keeps old unmarked supplier flows and unrelated templates unchanged', () => {
    const legacy = graph(); delete legacy.nodes[0]!.config!.supplierEightD;
    legacy.nodes[0]!.config!.assignment = { permission: 'workflow:act' };
    expect(validation.validateDraft(legacy)).toEqual({ valid: true, errors: [] });
    expect(isDomainControlledNode(legacy.nodes[0] as { config: unknown })).toBe(false);
    for (const [policy, domainCode] of [['INTERNAL', 'supplier-quality'], ['SUPPLIER', 'other']] as const) {
      const draft = templates['graph']({ code: 'OTHER', name: 'Other', policy, domainCode });
      expect(draft.nodes[0]!.config).toEqual({ isStart: true, assignment: { permission: 'workflow:act' } });
    }
  });

  it('freezes the supplierEightD Swagger object for parent-owned contract generation', async () => {
    const module = await Test.createTestingModule({ controllers: [WorkflowController], providers: [{ provide: WorkflowDefinitionService, useValue: {} }] }).compile();
    const app = module.createNestApplication();
    try {
      const schemas = SwaggerModule.createDocument(app, new DocumentBuilder().build()).components!.schemas!;
      const config = schemas.WorkflowNodeConfigDto as SchemaObject;
      expect(config.properties!.supplierEightD).toEqual({ $ref: '#/components/schemas/WorkflowSupplierEightDDto' });
      expect(config.required ?? []).not.toContain('supplierEightD');
      const schema = schemas.WorkflowSupplierEightDDto as SchemaObject;
      expect(schema.required).toEqual(['schemaVersion', 'reminderEveryHours']);
      expect(schema.properties!.schemaVersion).toMatchObject({ type: 'number', enum: [1] });
      expect(schema.properties!.reminderEveryHours).toEqual({ type: 'number', nullable: true, enum: [null] });
    } finally { await app.close(); }
  });
});
