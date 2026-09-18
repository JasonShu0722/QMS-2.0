export const WORKFLOW_NODE_TYPES = ['ACTION', 'APPROVAL', 'VERIFICATION', 'CC', 'REJECT', 'RETURN', 'REOPEN', 'CLOSE'] as const;
export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number];
export const WORKFLOW_VERSION_STATUSES = ['DRAFT', 'PUBLISHED', 'RETIRED'] as const;
export type WorkflowVersionStatus = (typeof WORKFLOW_VERSION_STATUSES)[number];
