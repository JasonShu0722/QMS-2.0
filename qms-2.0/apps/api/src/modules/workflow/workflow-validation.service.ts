import { BadRequestException, Injectable } from '@nestjs/common';

export const WORKFLOW_NODE_TYPES = [
  'ACTION', 'APPROVAL', 'VERIFICATION', 'CC', 'REJECT', 'RETURN', 'REOPEN', 'CLOSE',
] as const;
export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number];

const CONDITION_FIELDS = new Set(['status', 'severity', 'problemType', 'domainCode', 'sourceType', 'responsibleParty']);
const CONDITION_OPERATORS = new Set(['eq', 'ne', 'in', 'notIn', 'gt', 'gte', 'lt', 'lte']);
const ASSIGNMENT_NODES = new Set<WorkflowNodeType>(['ACTION', 'APPROVAL', 'VERIFICATION', 'REJECT', 'RETURN', 'REOPEN', 'CLOSE']);
const SCRIPT_KEYS = new Set(['script', 'expression', 'code', 'javascript', 'sql', 'function', 'predicate']);

export interface WorkflowDraftNode {
  id: string;
  type: string;
  name?: string;
  config?: Record<string, unknown>;
}

export interface WorkflowDraftTransition {
  id: string;
  from: string;
  to: string;
  condition?: Record<string, unknown>;
}

export interface WorkflowDraft {
  nodes: WorkflowDraftNode[];
  transitions: WorkflowDraftTransition[];
}

export interface WorkflowValidationResult {
  valid: boolean;
  errors: string[];
}

@Injectable()
export class WorkflowValidationService {
  validateDraft(draft: WorkflowDraft): WorkflowValidationResult {
    const errors: string[] = [];
    if (!draft || !Array.isArray(draft.nodes) || !Array.isArray(draft.transitions)) {
      return { valid: false, errors: ['WORKFLOW_DRAFT_REQUIRED'] };
    }
    const nodes = draft.nodes;
    const transitions = draft.transitions;
    const byId = new Map<string, WorkflowDraftNode>();
    for (const node of nodes) {
      if (!node.id || byId.has(node.id)) errors.push('WORKFLOW_NODE_ID_DUPLICATE');
      byId.set(node.id, node);
      if (!WORKFLOW_NODE_TYPES.includes(node.type as WorkflowNodeType)) {
        errors.push(`WORKFLOW_NODE_TYPE_NOT_ALLOWED:${node.type}`);
        continue;
      }
      const config = node.config ?? {};
      if (!node.name?.trim()) errors.push(`WORKFLOW_NODE_NAME_REQUIRED:${node.id}`);
      if (ASSIGNMENT_NODES.has(node.type as WorkflowNodeType) && !this.hasAssignment(config)) {
        errors.push(`WORKFLOW_ASSIGNMENT_REQUIRED:${node.id}`);
      }
      this.validateTiming(node.id, config, errors);
      this.rejectScript(config, `WORKFLOW_SCRIPT_NOT_ALLOWED:${node.id}`, errors);
    }

    const starts = nodes.filter((node) => node.config?.isStart === true);
    const ends = nodes.filter((node) => node.config?.isEnd === true);
    if (starts.length !== 1) errors.push('WORKFLOW_START_REQUIRED');
    if (ends.length !== 1) errors.push('WORKFLOW_END_REQUIRED');
    if (nodes.length === 0) errors.push('WORKFLOW_NODE_REQUIRED');

    const outgoing = new Map<string, string[]>();
    const incoming = new Map<string, string[]>();
    for (const node of nodes) {
      outgoing.set(node.id, []);
      incoming.set(node.id, []);
    }
    const transitionIds = new Set<string>();
    for (const transition of transitions) {
      if (transitionIds.has(transition.id)) errors.push('WORKFLOW_TRANSITION_ID_DUPLICATE');
      transitionIds.add(transition.id);
      if (!byId.has(transition.from) || !byId.has(transition.to)) {
        errors.push(`WORKFLOW_TRANSITION_NODE_NOT_FOUND:${transition.id}`);
        continue;
      }
      if (transition.from === transition.to) errors.push(`WORKFLOW_SELF_LOOP:${transition.id}`);
      outgoing.get(transition.from)!.push(transition.to);
      incoming.get(transition.to)!.push(transition.from);
      this.validateCondition(transition.condition, transition.id, errors);
    }
    if (starts.length === 1 && ends.length === 1) {
      const reachable = this.walk(starts[0]!.id, outgoing);
      const canClose = this.walk(ends[0]!.id, incoming);
      for (const node of nodes) {
        if (!reachable.has(node.id)) errors.push(`WORKFLOW_NODE_ORPHAN:${node.id}`);
        if (!canClose.has(node.id)) errors.push(`WORKFLOW_PATH_CANNOT_CLOSE:${node.id}`);
      }
      if (!reachable.has(ends[0]!.id)) errors.push('WORKFLOW_START_END_DISCONNECTED');
    }
    for (const node of starts) if ((incoming.get(node.id) ?? []).length > 0) errors.push(`WORKFLOW_START_HAS_INCOMING:${node.id}`);
    for (const node of ends) if ((outgoing.get(node.id) ?? []).length > 0) errors.push(`WORKFLOW_END_HAS_OUTGOING:${node.id}`);
    return { valid: errors.length === 0, errors: [...new Set(errors)] };
  }

  assertValid(draft: WorkflowDraft): void {
    const result = this.validateDraft(draft);
    if (!result.valid) {
      throw new BadRequestException({
        code: 'WORKFLOW_DRAFT_INVALID',
        errors: result.errors,
      });
    }
  }

  private hasAssignment(config: Record<string, unknown>): boolean {
    const assignment = config.assignment;
    if (typeof assignment === 'string') return assignment.trim().length > 0;
    if (!assignment || typeof assignment !== 'object' || Array.isArray(assignment)) return false;
    const value = assignment as Record<string, unknown>;
    return [value.roleCode, value.assigneeUserId, value.permission].some((entry) => typeof entry === 'string' && entry.trim().length > 0);
  }

  private validateTiming(id: string, config: Record<string, unknown>, errors: string[]): void {
    if (config.slaMinutes !== undefined && (!Number.isInteger(config.slaMinutes) || Number(config.slaMinutes) <= 0)) {
      errors.push(`WORKFLOW_SLA_INVALID:${id}`);
    }
    const reminders = config.reminders;
    if (reminders !== undefined) {
      if (!Array.isArray(reminders)) errors.push(`WORKFLOW_REMINDER_INVALID:${id}`);
      else for (const reminder of reminders) {
        const offset = typeof reminder === 'object' && reminder !== null ? (reminder as Record<string, unknown>).offsetMinutes : undefined;
        if (!Number.isInteger(offset) || Number(offset) < 0 || (Number.isInteger(config.slaMinutes) && Number(offset) > Number(config.slaMinutes))) errors.push(`WORKFLOW_REMINDER_INVALID:${id}`);
      }
    }
    if (config.escalation !== undefined && !this.hasAssignment({ assignment: config.escalation })) errors.push(`WORKFLOW_ESCALATION_INVALID:${id}`);
  }

  private validateCondition(condition: Record<string, unknown> | undefined, id: string, errors: string[]): void {
    if (condition === undefined || Object.keys(condition).length === 0) return;
    if (typeof condition !== 'object' || Array.isArray(condition)) { errors.push(`WORKFLOW_CONDITION_INVALID:${id}`); return; }
    for (const key of Object.keys(condition)) if (SCRIPT_KEYS.has(key)) errors.push(`WORKFLOW_SCRIPT_NOT_ALLOWED:${id}`);
    const field = condition.field;
    const operator = condition.operator;
    if (typeof field !== 'string' || !CONDITION_FIELDS.has(field)) errors.push(`WORKFLOW_CONDITION_FIELD_NOT_ALLOWED:${id}`);
    if (typeof operator !== 'string' || !CONDITION_OPERATORS.has(operator)) errors.push(`WORKFLOW_CONDITION_OPERATOR_NOT_ALLOWED:${id}`);
    const value = condition.value;
    if (value === undefined || (Array.isArray(value) && (value.length === 0 || value.length > 20))) errors.push(`WORKFLOW_CONDITION_VALUE_INVALID:${id}`);
    if (value !== undefined && !this.safeValue(value)) errors.push(`WORKFLOW_CONDITION_VALUE_INVALID:${id}`);
    if (['in', 'notIn'].includes(String(operator)) && !Array.isArray(value)) errors.push(`WORKFLOW_CONDITION_VALUE_INVALID:${id}`);
  }

  private safeValue(value: unknown): boolean {
    if (typeof value === 'string') return value.length <= 200 && !/[;{}$()]/.test(value);
    if (typeof value === 'number' || typeof value === 'boolean') return true;
    return Array.isArray(value) && value.every((entry) => this.safeValue(entry));
  }

  private rejectScript(config: Record<string, unknown>, code: string, errors: string[]): void {
    for (const key of Object.keys(config)) if (SCRIPT_KEYS.has(key)) errors.push(code);
  }

  private walk(start: string, graph: Map<string, string[]>): Set<string> {
    const visited = new Set<string>();
    const queue = [start];
    while (queue.length) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      queue.push(...(graph.get(current) ?? []));
    }
    return visited;
  }
}
