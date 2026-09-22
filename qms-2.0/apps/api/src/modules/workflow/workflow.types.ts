export const WORKFLOW_NODE_TYPES = ['ACTION', 'APPROVAL', 'VERIFICATION', 'CC', 'REJECT', 'RETURN', 'REOPEN', 'CLOSE'] as const;
export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number];
export const WORKFLOW_VERSION_STATUSES = ['DRAFT', 'PUBLISHED', 'RETIRED'] as const;
export type WorkflowVersionStatus = (typeof WORKFLOW_VERSION_STATUSES)[number];
export const WORKFLOW_ACTIONS = ['SUBMIT', 'APPROVE', 'VERIFY', 'REJECT', 'RETURN', 'REOPEN', 'CLOSE'] as const;
export type WorkflowAction = (typeof WORKFLOW_ACTIONS)[number];

export const MAX_WORKFLOW_SLA_MINUTES = 2_147_483_647;
export const WORKFLOW_EDITABLE_NODE_TYPES = ['ACTION', 'APPROVAL', 'VERIFICATION', 'CC', 'CLOSE'] as const;
export const WORKFLOW_CONDITION_FIELDS = ['status', 'severity', 'problemType', 'domainCode', 'sourceType', 'responsibleParty'] as const;
export const WORKFLOW_CONDITION_OPERATORS = ['eq', 'ne', 'in', 'notIn'] as const;
export const MAX_WORKFLOW_NODES = 100;
export const MAX_WORKFLOW_TRANSITIONS = 300;
