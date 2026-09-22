import type { components } from '@qms/contracts';

export function editableWorkflowGraph(graph: components['schemas']['WorkflowGraphResponseDto']): components['schemas']['WorkflowGraphDto'] {
  return { transitions: graph.transitions, nodes: graph.nodes.map((node) => {
    const type = node.type;
    if (type !== 'ACTION' && type !== 'APPROVAL' && type !== 'VERIFICATION' && type !== 'CC' && type !== 'CLOSE') throw new Error('WORKFLOW_LEGACY_NODE_READ_ONLY');
    return { ...node, type };
  }) };
}
