import { describe, expect, it } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { WorkflowValidationService } from '../../src/modules/workflow/workflow-validation.service.js';
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
