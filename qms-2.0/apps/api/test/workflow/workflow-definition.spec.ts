import { describe, expect, it } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { WorkflowValidationService, type WorkflowDraft } from '../../src/modules/workflow/workflow-validation.service.js';
import { CreateWorkflowDto } from '../../src/modules/workflow/workflow.dto.js';

const validDraft = () => ({
  nodes: [
    { id: 'start', type: 'ACTION', name: '处理', config: { isStart: true, assignment: { roleCode: 'QUALITY' }, slaMinutes: 60 } },
    { id: 'approval', type: 'APPROVAL', name: '审批', config: { assignment: { roleCode: 'MANAGER' }, slaMinutes: 60 } },
    { id: 'verify', type: 'VERIFICATION', name: '验证', config: { assignment: { roleCode: 'QUALITY' }, slaMinutes: 60 } },
    { id: 'close', type: 'CLOSE', name: '关闭', config: { isEnd: true, assignment: { roleCode: 'QUALITY' } } },
  ],
  transitions: [
    { id: 't1', from: 'start', to: 'approval' },
    { id: 't2', from: 'approval', to: 'verify' },
    { id: 't3', from: 'verify', to: 'close' },
  ],
});

describe('controlled closure review schema', () => {
  const service = new WorkflowValidationService();
  const graph = (): WorkflowDraft => ({
    nodes: [
      { id: 'owner', type: 'ACTION', name: 'Owner', config: { isStart: true, assignment: { permission: 'workflow:act' } } },
      { id: 'review', type: 'APPROVAL', name: 'Review', config: { closureReview: { schemaVersion: 1, policy: 'INTERNAL', domainCode: 'NEUTRAL' } } },
      { id: 'close', type: 'CLOSE', name: 'Close', config: { isEnd: true, assignment: { permission: 'workflow:act' } } },
    ],
    transitions: [
      { id: 'submit', from: 'owner', to: 'review', action: 'SUBMIT' },
      { id: 'approve', from: 'review', to: 'close', action: 'APPROVE' },
      { id: 'return', from: 'review', to: 'owner', action: 'RETURN' },
    ],
  });

  it('rejects a conditional start-to-close path bypassing every controlled closure gate', () => {
    const draft = graph();
    draft.transitions[0]!.condition = { field: 'severity', operator: 'ne', value: 'LOW' };
    draft.transitions.push({ id: 'bypass', from: 'owner', to: 'close', action: 'SUBMIT', condition: { field: 'severity', operator: 'eq', value: 'LOW' } });
    expect(service.validateDraft(draft).errors).toContain('WORKFLOW_CLOSURE_BYPASS_NOT_ALLOWED');
  });

  it.each(['INTERNAL', 'SUPPLIER'])('uses %s closure duties instead of a legacy assignment', policy => {
    const draft = graph();
    (draft.nodes[1]!.config!.closureReview as Record<string, unknown>).policy = policy;
    expect(service.validateDraft(draft)).toEqual({ valid: true, errors: [] });
  });

  it.each(['INTERNAL', 'SUPPLIER'])('rejects a single-element %s policy array without coercion at normalization', (policy: string) => {
    const draft = graph();
    (draft.nodes[1]!.config!.closureReview as Record<string, unknown>).policy = [policy];
    expect(service.validateStructure(draft).errors).toContain('WORKFLOW_CLOSURE_CONFIG_INVALID:review');
    expect(() => service.normalizeDraft(draft)).toThrow(expect.objectContaining({ status: 400, response: expect.objectContaining({ code: 'WORKFLOW_DRAFT_INVALID' }) }));
  });

  it('rejects an additional approve detour while retaining the valid approve-to-close edge', () => {
    const draft = graph();
    draft.nodes.push({ id: 'detour', type: 'ACTION', name: 'Detour', config: { assignment: 'QUALITY' } });
    draft.transitions.push({ id: 'extra-approve', from: 'review', to: 'detour', action: 'APPROVE' },
      { id: 'finish-detour', from: 'detour', to: 'close', action: 'SUBMIT' });
    expect(service.validateStructure(draft).valid).toBe(true);
    expect(service.validateDraft(draft).errors).toContain('WORKFLOW_CLOSURE_APPROVE_REQUIRED:review');
  });

  it.each(['ACTION', 'APPROVAL'])('rejects an additional return to an upstream %s while retaining the valid owner return', (type: string) => {
    const draft = graph();
    draft.nodes.push({ id: 'prior', type, name: 'Prior', config: { assignment: 'QUALITY' } });
    draft.transitions[0]!.to = 'prior';
    draft.transitions.push({ id: 'prior-submit', from: 'prior', to: 'review', action: type === 'ACTION' ? 'SUBMIT' : 'APPROVE' },
      { id: 'extra-return', from: 'review', to: 'prior', action: 'RETURN' });
    expect(service.validateStructure(draft).valid).toBe(true);
    expect(service.validateDraft(draft).errors).toContain('WORKFLOW_CLOSURE_RETURN_REQUIRED:review');
  });

  it.each(['APPROVE', 'RETURN'])('rejects duplicate %s routes even when their target is valid', (action: string) => {
    const draft = graph();
    const route = draft.transitions.find(edge => edge.action === action)!;
    draft.transitions.push({ ...route, id: 'duplicate-route' });
    expect(service.validateDraft(draft).valid).toBe(false);
  });

  it.each(['APPROVE', 'RETURN'])('rejects conditional %s routes that leave a controlled duty decision without an unconditional route', (action: string) => {
    const draft = graph();
    draft.transitions.find(edge => edge.action === action)!.condition = { field: 'severity', operator: 'eq', value: 'HIGH' };
    expect(service.validateDraft(draft).valid).toBe(false);
  });

  it('rejects an extra reject route alongside the valid approve and return routes', () => {
    const draft = graph();
    draft.transitions.push({ id: 'extra-reject', from: 'review', to: 'owner', action: 'REJECT' });
    expect(service.validateDraft(draft).valid).toBe(false);
  });

  it('accepts a transformed HTTP DTO without treating absent optional fields as static assignments', async () => {
    const dto = plainToInstance(CreateWorkflowDto, { code: 'TEST', name: 'Test', ...graph() });
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    expect(service.validateDraft({ nodes: dto.nodes as unknown as WorkflowDraft['nodes'], transitions: dto.transitions })).toEqual({ valid: true, errors: [] });
  });

  it.each([null, false, [], 'INTERNAL', {}, { schemaVersion: 2, policy: 'INTERNAL', domainCode: 'NEUTRAL' },
    { schemaVersion: 1, policy: 'OTHER', domainCode: 'NEUTRAL' }, { schemaVersion: 1, policy: 'INTERNAL' },
    { schemaVersion: 1, policy: 'INTERNAL', domainCode: '' }, { schemaVersion: 1, policy: 'INTERNAL', domainCode: ' NEUTRAL' },
    { schemaVersion: 1, policy: 'INTERNAL', domainCode: 'x'.repeat(101) },
    { schemaVersion: 1, policy: 'INTERNAL', domainCode: 'NEUTRAL', assigneeUserId: 'extra' },
  ])('rejects malformed closure metadata %j at service and transport boundaries', async (closureReview: unknown) => {
    const draft = graph(); draft.nodes[1]!.config!.closureReview = closureReview;
    expect(service.validateStructure(draft).valid).toBe(false);
    expect(await validate(plainToInstance(CreateWorkflowDto, { code: 'TEST', name: 'Test', ...draft }), { whitelist: true, forbidNonWhitelisted: true })).not.toHaveLength(0);
  });

  it.each(['ACTION', 'VERIFICATION', 'CC', 'CLOSE'])('rejects closure metadata on %s', type => {
    const draft = graph(); draft.nodes[1]!.type = type;
    expect(service.validateStructure(draft).valid).toBe(false);
  });

  it.each([{ isStart: true }, { isEnd: true }, { assignment: { permission: 'workflow:act' } }, { assignment: null },
    { slaMinutes: 60, escalation: { roleCode: 'MANAGER' } }, { escalation: null }])('rejects incompatible closure config %j', config => {
    const draft = graph(); Object.assign(draft.nodes[1]!.config!, config);
    expect(service.validateStructure(draft).valid).toBe(false);
  });

  it('allows safe incomplete drafts but requires an explicit return to an earlier action and approve to the sole close', () => {
    const draft = graph(); draft.transitions.pop();
    expect(service.validateStructure(draft).valid).toBe(true);
    expect(service.validateDraft(draft).errors).toContain('WORKFLOW_CLOSURE_RETURN_REQUIRED:review');
    draft.transitions.push({ id: 'wrong', from: 'review', to: 'close', action: 'RETURN' });
    expect(service.validateDraft(draft).valid).toBe(false);
    const indirect = graph(); indirect.transitions[1]!.to = 'after';
    indirect.nodes.push({ id: 'after', type: 'ACTION', name: 'After', config: { assignment: 'QUALITY' } });
    indirect.transitions.push({ id: 'finish', from: 'after', to: 'close', action: 'SUBMIT' });
    expect(service.validateDraft(indirect).errors).toContain('WORKFLOW_CLOSURE_APPROVE_REQUIRED:review');
  });

  it('retains legacy close assignment, verification and graph safety constraints', () => {
    const draft = graph(); draft.nodes[2]!.config!.assignment = undefined;
    expect(service.validateDraft(draft).errors).toContain('WORKFLOW_ASSIGNMENT_REQUIRED:close');
    const unsafe = graph(); unsafe.nodes[2]!.config!.requireIndependentVerification = 'true';
    expect(service.validateDraft(unsafe).valid).toBe(false);
  });
});

describe('WorkflowValidationService', () => {
  const service = new WorkflowValidationService();

  it('accepts a controlled action, approval, verification and close graph', () => {
    expect(service.validateDraft(validDraft())).toEqual({ valid: true, errors: [] });
  });

  it('accepts explicit backward actions while keeping the forward graph acyclic', () => {
    const draft = validDraft();
    draft.transitions.push(
      { id: 'return', from: 'verify', to: 'start', action: 'RETURN' },
      { id: 'reject', from: 'approval', to: 'start', action: 'REJECT' },
      { id: 'reopen', from: 'close', to: 'start', action: 'REOPEN' },
    );
    expect(service.validateDraft(draft)).toEqual({ valid: true, errors: [] });
  });

  it.each(['RETURN', 'REJECT', 'REOPEN'])('rejects implicit %s edges that move forward to an unvisited close node', (type) => {
    const draft = {
      nodes: [
        { id: 'start', type: 'ACTION', name: 'Start', config: { isStart: true, assignment: 'QUALITY' } },
        { id: 'backward', type, name: 'Backward', config: { assignment: 'QUALITY' } },
        { id: 'close', type: 'CLOSE', name: 'Close', config: { isEnd: true, assignment: 'QUALITY' } },
      ],
      transitions: [{ id: 'first', from: 'start', to: 'backward' }, { id: 'second', from: 'backward', to: 'close' }],
    };
    expect(service.validateDraft(draft).valid).toBe(false);
  });

  it.each(['DELETE', 'APPROVE', 'CLOSE', 'RETURN'])('rejects invalid forward-edge action %s', (action) => {
    const draft = validDraft();
    Object.assign(draft.transitions[0]!, { action });
    expect(service.validateDraft(draft).valid).toBe(false);
  });

  it('rejects non-boolean verification policy and non-close end nodes', () => {
    const draft = validDraft();
    Object.assign(draft.nodes[3]!.config, { requireIndependentVerification: 'true' });
    expect(service.validateDraft(draft).valid).toBe(false);
    draft.nodes[3]!.config = { isEnd: true, assignment: { roleCode: 'QUALITY' } };
    draft.nodes[3]!.type = 'ACTION';
    expect(service.validateDraft(draft).valid).toBe(false);
  });

  it('describes and validates explicit transition actions at the transport boundary', async () => {
    const draft = validDraft();
    Object.assign(draft.transitions[0]!, { action: 'DELETE' });
    const dto = plainToInstance(CreateWorkflowDto, { code: 'QMS', name: 'QMS', ...draft });
    expect(JSON.stringify(await validate(dto))).toMatch(/isIn/);
  });

  it.each([
    ['missing start', (draft: ReturnType<typeof validDraft>) => { draft.nodes[0]!.config = { assignment: { roleCode: 'QUALITY' } }; }],
    ['missing end', (draft: ReturnType<typeof validDraft>) => { draft.nodes[3]!.config = { assignment: { roleCode: 'QUALITY' } }; }],
    ['orphan node', (draft: ReturnType<typeof validDraft>) => { draft.nodes.push({ id: 'orphan', type: 'ACTION', name: '孤立', config: { assignment: { roleCode: 'QUALITY' } } }); }],
    ['invalid node type', (draft: ReturnType<typeof validDraft>) => { draft.nodes[1]!.type = 'SCRIPT'; }],
    ['closed cycle', (draft: ReturnType<typeof validDraft>) => { draft.transitions = [{ id: 't1', from: 'start', to: 'approval' }, { id: 't2', from: 'approval', to: 'verify' }, { id: 't3', from: 'verify', to: 'approval' }]; }],
    ['missing assignment', (draft: ReturnType<typeof validDraft>) => { draft.nodes[1]!.config = {}; }],
    ['non-whitelisted condition', (draft: ReturnType<typeof validDraft>) => { draft.transitions[0]!.condition = { field: 'process.env', operator: 'eq', value: 'x' }; }],
    ['arbitrary script', (draft: ReturnType<typeof validDraft>) => { draft.transitions[0]!.condition = { expression: 'return process.env.SECRET' }; }],
  ])('%s is rejected', (_label, mutate) => {
    const draft = validDraft();
    mutate(draft);
    expect(service.validateDraft(draft).valid).toBe(false);
  });

  it('rejects a directed cycle even when the end remains reachable', () => {
    const draft = validDraft();
    draft.transitions.push({ id: 'cycle', from: 'verify', to: 'approval' });
    const result = service.validateDraft(draft);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('WORKFLOW_CYCLE_NOT_ALLOWED');
  });

  it('rejects script keys nested in node config and transition condition', () => {
    const nodeDraft = validDraft();
    nodeDraft.nodes[1]!.config = {
      assignment: { roleCode: 'MANAGER', metadata: { steps: [{ eval: 'process.env.SECRET' }] } },
    };
    const nodeResult = service.validateDraft(nodeDraft);
    expect(nodeResult.valid).toBe(false);
    expect(nodeResult.errors).toContain('WORKFLOW_SCRIPT_NOT_ALLOWED:approval');

    const conditionDraft = validDraft();
    conditionDraft.transitions[0]!.condition = {
      field: 'severity', operator: 'eq', value: 'high', nested: { options: [{ functionBody: 'return true' }] },
    };
    const conditionResult = service.validateDraft(conditionDraft);
    expect(conditionResult.valid).toBe(false);
    expect(conditionResult.errors).toContain('WORKFLOW_SCRIPT_NOT_ALLOWED:t1');
  });

  it('rejects case-insensitive script keys', () => {
    const draft = validDraft();
    draft.nodes[0]!.config = { assignment: { roleCode: 'QUALITY', JavaScript: 'return true' } };
    expect(service.validateDraft(draft).valid).toBe(false);
  });

  it('rejects invalid SLA, reminder and condition values', () => {
    const draft = validDraft();
    draft.nodes[0]!.config = { isStart: true, assignment: { roleCode: 'QUALITY' }, slaMinutes: 0, reminders: [{ offsetMinutes: -1 }] };
    draft.transitions[0]!.condition = { field: 'severity', operator: 'between', value: ['A', 'B'] };
    const result = service.validateDraft(draft);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/SLA|REMINDER|CONDITION/);
  });

  it('raises a stable bad request when a draft fails the controlled validator', () => {
    try {
      service.assertValid({ nodes: [], transitions: [] });
      throw new Error('expected draft validation to fail');
    } catch (error) {
      expect(error).toMatchObject({ response: { code: 'WORKFLOW_DRAFT_INVALID' }, status: 400 });
    }
  });

  it.each([2_147_483_648, Number.MAX_SAFE_INTEGER, 1e20])('rejects SLA duration %s outside the supported integer range', (slaMinutes) => {
    const draft = validDraft();
    draft.nodes[0]!.config.slaMinutes = slaMinutes;
    expect(service.validateDraft(draft).errors).toContain('WORKFLOW_SLA_INVALID:start');
  });

  it('accepts the maximum supported SLA duration', () => {
    const draft = validDraft();
    draft.nodes[0]!.config.slaMinutes = 2_147_483_647;
    expect(service.validateDraft(draft).valid).toBe(true);
  });

  it.each([
    { reminders: [{ offsetMinutes: 0 }] },
    { escalation: 'MANAGER' },
    { slaMinutes: 60, reminders: [{ offsetMinutes: 10 }, { offsetMinutes: 10 }] },
    { slaMinutes: 60, reminders: [{ offsetMinutes: Number.MAX_SAFE_INTEGER + 1 }] },
  ])('rejects timing without SLA or deterministic unique offsets: %j', (timing) => {
    const draft = validDraft();
    draft.nodes[0]!.config = { isStart: true, assignment: { roleCode: 'QUALITY' }, ...timing };
    expect(service.validateDraft(draft).valid).toBe(false);
  });

  it('accepts deadline reminders and escalation with fixed SLA', () => {
    const draft = validDraft();
    Object.assign(draft.nodes[0]!.config, { reminders: [{ offsetMinutes: 0 }, { offsetMinutes: 60 }], escalation: 'MANAGER' });
    expect(service.validateDraft(draft).valid).toBe(true);
  });

  it.each([
    { roleCode: 'QUALITY', permission: '' },
    { roleCode: 'QUALITY', assigneeUserId: 'not-a-user-id' },
    { roleCode: 42, permission: 'workflow:act' },
  ])('rejects assignments with an invalid explicit constraint: %j', (assignment) => {
    const draft = validDraft();
    Object.assign(draft.nodes[0]!.config, { assignment });
    expect(service.validateDraft(draft).errors).toContain('WORKFLOW_ASSIGNMENT_REQUIRED:start');
  });

  it('requires an assignment for CC nodes handled by the current manual runtime', () => {
    const draft = validDraft();
    draft.nodes[1]!.type = 'CC';
    draft.nodes[1]!.config = {};
    expect(service.validateDraft(draft).errors).toContain('WORKFLOW_ASSIGNMENT_REQUIRED:approval');
  });

  it('validates node enums and required graph arrays at the transport boundary', async () => {
    const dto = plainToInstance(CreateWorkflowDto, {
      code: 'QMS', name: 'QMS', nodes: [{ id: 'start', type: 'SCRIPT', name: '脚本' }], transitions: [{ id: 't', from: 'start', to: 'start' }],
    });
    const errors = await validate(dto);
    const messages = JSON.stringify(errors);
    expect(messages).toMatch(/isIn/);
    const missingGraph = plainToInstance(CreateWorkflowDto, { code: 'QMS', name: 'QMS', nodes: [] });
    await expect(validate(missingGraph)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ property: 'nodes' }),
      expect.objectContaining({ property: 'transitions' }),
    ]));
  });
});
