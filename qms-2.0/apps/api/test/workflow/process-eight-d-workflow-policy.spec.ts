import 'reflect-metadata';
import { WorkflowValidationService, type WorkflowDraft } from '../../src/modules/workflow/workflow-validation.service.js';
import * as policy from '../../src/modules/workflow/workflow-runtime-policy.js';
import { WorkflowClosureTemplateService } from '../../src/modules/workflow/workflow-closure-template.service.js';
import type { PrismaService } from '../../src/database/prisma.service.js';
import type { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { WorkflowDefinitionService } from '../../src/modules/workflow/workflow-definition.service.js';
import type { Prisma } from '../../src/generated/prisma/client.js';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateWorkflowDto } from '../../src/modules/workflow/workflow.dto.js';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { WorkflowController } from '../../src/modules/workflow/workflow.controller.js';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface.js';

const handling = () => ({ schemaVersion: 1, extensionPolicy: 'LEADER_THEN_PROFESSIONAL', reminderEveryHours: null });
const graph = (): WorkflowDraft => ({
  nodes: [
    { id: 'owner', type: 'ACTION', name: 'Owner', config: { isStart: true, assignment: { permission: 'workflow:act' }, processEightD: handling() } },
    { id: 'review', type: 'APPROVAL', name: 'Review', config: { closureReview: { schemaVersion: 1, policy: 'INTERNAL', domainCode: 'process-quality' } } },
    { id: 'close', type: 'CLOSE', name: 'Close', config: { isEnd: true, assignment: { permission: 'workflow:act' } } },
  ],
  transitions: [
    { id: 'submit', from: 'owner', to: 'review', action: 'SUBMIT' },
    { id: 'approve', from: 'review', to: 'close', action: 'APPROVE' },
    { id: 'return', from: 'review', to: 'owner', action: 'RETURN' },
  ],
});
const controlled = (node: { config: unknown }) => (policy as typeof policy & { isDomainControlledNode(node: { config: unknown }): boolean }).isDomainControlledNode(node);

describe('bounded process 8D handling workflow policy', () => {
  const validation = new WorkflowValidationService();

  it.each([null, false, {}, { schemaVersion: 999 }, handling()])('blocks generic execution for any declared handling marker: %p', processEightD => {
    const node = { config: { processEightD } };
    expect(controlled(node)).toBe(true);
    expect(policy.isClosureReviewNode(node)).toBe(false);
  });

  it('keeps legacy nodes executable while closure gates remain domain controlled', () => {
    expect(controlled({ config: { assignment: { permission: 'workflow:act' } } })).toBe(false);
    expect(controlled({ config: { closureReview: null } })).toBe(true);
  });

  it('detects a controlled version even when the current close node has no handling marker', async () => {
    let parts: TemplateStringsArray | undefined; let parameters: unknown[] = [];
    const tx = { $queryRaw: async (query: TemplateStringsArray, ...values: unknown[]) => { parts = query; parameters = values; return [{ id: 'owner' }]; } } as unknown as Prisma.TransactionClient;
    const versionPolicy = policy as typeof policy & { isControlledEightDVersion(tx: Prisma.TransactionClient, org: string, version: string): Promise<boolean> };
    expect(await versionPolicy.isControlledEightDVersion(tx, 'org', 'version')).toBe(true);
    expect(parts?.join('?')).toContain("config ? 'processEightD'");
    expect(parameters).toEqual(['org', 'version']);
  });

  it('accepts the fixed handling/parallel closure graph and an explicitly disabled reminder', () => {
    expect(validation.validateDraft(graph())).toEqual({ valid: true, errors: [] });
  });

  it.each([null, 1, 8760])('accepts the bounded policy through the real HTTP DTO: %p', async reminderEveryHours => {
    const draft = graph(); (draft.nodes[0]!.config!.processEightD as Record<string, unknown>).reminderEveryHours = reminderEveryHours;
    const dto = plainToInstance(CreateWorkflowDto, { code: 'PROCESS', name: 'Process', ...draft });
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    expect(validation.validateDraft({ nodes: dto.nodes as unknown as WorkflowDraft['nodes'], transitions: dto.transitions as unknown as WorkflowDraft['transitions'] })).toEqual({ valid: true, errors: [] });
  });

  it('freezes the processEightD Swagger object for generated Web contracts', async () => {
    const module = await Test.createTestingModule({ controllers: [WorkflowController], providers: [{ provide: WorkflowDefinitionService, useValue: {} }] }).compile();
    const app = module.createNestApplication();
    try {
      const schemas = SwaggerModule.createDocument(app, new DocumentBuilder().build()).components!.schemas!;
      const config = schemas.WorkflowNodeConfigDto as SchemaObject;
      expect(config.properties!.processEightD).toEqual({ $ref: '#/components/schemas/WorkflowProcessEightDDto' });
      expect(config.required ?? []).not.toContain('processEightD');
      const schema = schemas.WorkflowProcessEightDDto as SchemaObject;
      expect(schema.required).toEqual(['schemaVersion', 'extensionPolicy', 'reminderEveryHours']);
      expect(schema.properties!.schemaVersion).toMatchObject({ type: 'number', enum: [1] });
      expect(schema.properties!.extensionPolicy).toMatchObject({ type: 'string', enum: ['LEADER_THEN_PROFESSIONAL'] });
      expect(schema.properties!.reminderEveryHours).toEqual({ type: 'number', nullable: true, minimum: 1, maximum: 8760 });
    } finally { await app.close(); }
  });

  it.each([undefined, 0, 8761, 1.5, '1', false])('rejects invalid reminder values at transport and service boundaries: %p', async reminderEveryHours => {
    const draft = graph(); (draft.nodes[0]!.config!.processEightD as Record<string, unknown>).reminderEveryHours = reminderEveryHours;
    expect(validation.validateDraft(draft).valid).toBe(false);
    expect(await validate(plainToInstance(CreateWorkflowDto, { code: 'PROCESS', name: 'Process', ...draft }), { whitelist: true, forbidNonWhitelisted: true })).not.toHaveLength(0);
  });

  it.each(['slaMinutes', 'reminders', 'escalation', 'closureReview'])('rejects generic owner configuration: %s', field => {
    const draft = graph(); draft.nodes[0]!.config![field] = field === 'slaMinutes' ? 60 : field === 'reminders' ? [] : {};
    expect(validation.validateDraft(draft).valid).toBe(false);
  });

  it.each(['SUBMIT', 'RETURN'])('requires a direct unconditional %s route', action => {
    const draft = graph(); draft.transitions.find(edge => edge.action === action)!.condition = { field: 'severity', operator: 'eq', value: 'HIGH' };
    expect(validation.validateDraft(draft).valid).toBe(false);
  });

  it('does not accept a process closure graph without its controlled handling policy', () => {
    const draft = graph(); delete draft.nodes[0]!.config!.processEightD;
    expect(validation.validateDraft(draft).valid).toBe(false);
  });

  it.each([null, false, {}, { ...handling(), extensionPolicy: 'NONE' }, { ...handling(), reminderEveryHours: 0 }, { ...handling(), skipProfessional: true }])('rejects malformed or bypassable process policy: %p', value => {
    const draft = graph(); draft.nodes[0]!.config!.processEightD = value;
    expect(validation.validateDraft(draft).valid).toBe(false);
  });

  it.each([null, false, [], 'process', {}, { ...handling(), schemaVersion: 2 }, { ...handling(), extensionPolicy: 'NONE' }, { ...handling(), skipProfessional: true }])('rejects malformed handling policies at the HTTP boundary: %p', async processEightD => {
    const draft = graph(); draft.nodes[0]!.config!.processEightD = processEightD;
    expect(await validate(plainToInstance(CreateWorkflowDto, { code: 'PROCESS', name: 'Process', ...draft }), { whitelist: true, forbidNonWhitelisted: true })).not.toHaveLength(0);
  });

  it('rejects a static replacement owner or supplier policy on the internal process graph', () => {
    const staticOwner = graph(); staticOwner.nodes[0]!.config!.assignment = { assigneeUserId: '00000000-0000-4000-8000-000000000001' };
    expect(validation.validateDraft(staticOwner).valid).toBe(false);
    const supplier = graph(); (supplier.nodes[1]!.config!.closureReview as Record<string, unknown>).policy = 'SUPPLIER';
    expect(validation.validateDraft(supplier).valid).toBe(false);
  });

  it('initializes a process candidate with the real bounded handling policy, not a live business binding', () => {
    const templates = new WorkflowClosureTemplateService({} as PrismaService, {} as WorkflowDefinitionService, {} as AdminMutationService);
    const draft = templates['graph']({ code: 'PROCESS_EIGHT_D', name: 'Process 8D', domainCode: 'process-quality', policy: 'INTERNAL' });
    expect(draft.nodes.find(node => node.config?.isStart)?.config?.processEightD).toEqual(handling());
    expect(validation.validateDraft(draft).valid).toBe(true);
  });
});
