import { expect, it } from 'vitest';
import { editableWorkflowGraph } from './workflow-graph';

it('preserves supported node configuration but rejects historical standalone action nodes', () => {
  const config = { assignment: { roleCode: 'QA' }, slaMinutes: 120, reminders: [{ offsetMinutes: 15 }] };
  expect(editableWorkflowGraph({ nodes: [{ id: 'handle', type: 'ACTION', name: 'Handle', config }], transitions: [] })).toEqual({ nodes: [{ id: 'handle', type: 'ACTION', name: 'Handle', config }], transitions: [] });
  for (const type of ['RETURN', 'REJECT', 'REOPEN'] as const) expect(() => editableWorkflowGraph({ nodes: [{ id: 'old', type, name: 'Historical' }], transitions: [] })).toThrow('WORKFLOW_LEGACY_NODE_READ_ONLY');
});
