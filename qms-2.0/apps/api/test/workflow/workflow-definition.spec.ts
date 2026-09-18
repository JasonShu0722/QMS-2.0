import { describe, expect, it } from '@jest/globals';
import { WorkflowValidationService } from '../../src/modules/workflow/workflow-validation.service.js';

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

  it('rejects invalid SLA, reminder and condition values', () => {
    const draft = validDraft();
    draft.nodes[0]!.config = { isStart: true, assignment: { roleCode: 'QUALITY' }, slaMinutes: 0, reminders: [{ offsetMinutes: -1 }] };
    draft.transitions[0]!.condition = { field: 'severity', operator: 'between', value: ['A', 'B'] };
    const result = service.validateDraft(draft);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/SLA|REMINDER|CONDITION/);
  });
});
