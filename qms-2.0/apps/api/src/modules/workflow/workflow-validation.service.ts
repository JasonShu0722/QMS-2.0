import { BadRequestException, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { actionAllowed, forwardAction } from './workflow-runtime-policy.js';
import { parseDeadlinePolicy } from './workflow-deadline-extension.policy.js';
import { MAX_WORKFLOW_NODES, MAX_WORKFLOW_SLA_MINUTES, MAX_WORKFLOW_TRANSITIONS, WORKFLOW_ACTIONS, WORKFLOW_CONDITION_FIELDS, WORKFLOW_CONDITION_OPERATORS, WORKFLOW_EDITABLE_NODE_TYPES } from './workflow.types.js';

export const WORKFLOW_NODE_TYPES = [
  'ACTION', 'APPROVAL', 'VERIFICATION', 'CC', 'REJECT', 'RETURN', 'REOPEN', 'CLOSE',
] as const;
export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number];

const CONDITION_FIELDS = new Set<string>(WORKFLOW_CONDITION_FIELDS);
const CONDITION_OPERATORS = new Set<string>(WORKFLOW_CONDITION_OPERATORS);
const ASSIGNMENT_NODES = new Set<WorkflowNodeType>(WORKFLOW_NODE_TYPES);
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
  action?: string;
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
  validateStructure(draft: WorkflowDraft): WorkflowValidationResult {
    const errors: string[] = [];
    if (!this.object(draft) || !Array.isArray(draft.nodes) || !Array.isArray(draft.transitions)) return { valid: false, errors: ['WORKFLOW_DRAFT_REQUIRED'] };
    if (Object.keys(draft).some((key) => !['nodes', 'transitions'].includes(key))) errors.push('WORKFLOW_DRAFT_FIELD_NOT_ALLOWED');
    if (!draft.nodes.length || draft.nodes.length > MAX_WORKFLOW_NODES || draft.transitions.length > MAX_WORKFLOW_TRANSITIONS) errors.push('WORKFLOW_GRAPH_SIZE_INVALID');
    const ids = new Set<string>();
    for (const node of draft.nodes) {
      if (!this.object(node)) { errors.push('WORKFLOW_NODE_INVALID'); continue; }
      if (!this.text(node.id, 100) || ids.has(node.id)) errors.push('WORKFLOW_NODE_ID_DUPLICATE');
      ids.add(node.id);
      if (Object.keys(node).some((key) => !['id', 'type', 'name', 'config'].includes(key))) errors.push(`WORKFLOW_NODE_FIELD_NOT_ALLOWED:${node.id}`);
      if (!WORKFLOW_EDITABLE_NODE_TYPES.some((type) => type === node.type)) errors.push(`WORKFLOW_NODE_TYPE_NOT_ALLOWED:${node.type}`);
      if (!this.text(node.name, 200)) errors.push(`WORKFLOW_NODE_NAME_REQUIRED:${node.id}`);
      const config = node.config ?? {};
      if (node.config === null || !this.object(config)) { errors.push(`WORKFLOW_CONFIG_INVALID:${node.id}`); continue; }
      if (Object.keys(config).some((key) => !['assignment', 'isStart', 'isEnd', 'slaMinutes', 'reminders', 'escalation', 'requireIndependentVerification', 'editorPosition', 'closureReview', 'processEightD', 'supplierEightD'].includes(key))) errors.push(`WORKFLOW_CONFIG_FIELD_NOT_ALLOWED:${node.id}`);
      if (Object.hasOwn(config, 'supplierEightD')) {
        const supplier = config.supplierEightD;
        if (!this.object(supplier) || Object.keys(supplier).some(key => !['schemaVersion', 'reminderEveryHours'].includes(key))
          || supplier.schemaVersion !== 1 || supplier.reminderEveryHours !== null
            && (!Number.isSafeInteger(supplier.reminderEveryHours) || Number(supplier.reminderEveryHours) < 1 || Number(supplier.reminderEveryHours) > 8760)) errors.push(`WORKFLOW_SUPPLIER_CONFIG_INVALID:${node.id}`);
        const assignment = config.assignment;
        if (node.type !== 'ACTION' || config.isStart !== true || config.isEnd === true || config.closureReview !== undefined
          || config.processEightD !== undefined || config.slaMinutes !== undefined || config.reminders !== undefined || config.escalation !== undefined
          || !this.object(assignment) || Object.entries(assignment).filter(([, value]) => value !== undefined).length !== 1 || assignment.permission !== 'supplier-quality:responses:write') {
          errors.push(`WORKFLOW_SUPPLIER_NODE_INVALID:${node.id}`);
        }
      }
      if (config.processEightD !== undefined) {
        if (!parseDeadlinePolicy(config.processEightD)) errors.push(`WORKFLOW_PROCESS_CONFIG_INVALID:${node.id}`);
        const assignment = config.assignment;
        if (node.type !== 'ACTION' || config.isStart !== true || config.isEnd === true || config.closureReview !== undefined
          || config.slaMinutes !== undefined || config.reminders !== undefined || config.escalation !== undefined
          || !this.object(assignment) || Object.entries(assignment).filter(([, value]) => value !== undefined).length !== 1 || assignment.permission !== 'workflow:act') {
          errors.push(`WORKFLOW_PROCESS_NODE_INVALID:${node.id}`);
        }
      }
      if (config.closureReview !== undefined) {
        const review = config.closureReview;
        if (!this.object(review) || Object.keys(review).some(key => !['schemaVersion', 'policy', 'domainCode'].includes(key))
          || review.schemaVersion !== 1 || (review.policy !== 'INTERNAL' && review.policy !== 'SUPPLIER')
          || !this.text(review.domainCode, 100) || !/^\S(?:.*\S)?$/.test(review.domainCode)) errors.push(`WORKFLOW_CLOSURE_CONFIG_INVALID:${node.id}`);
        if (node.type !== 'APPROVAL' || config.isStart === true || config.isEnd === true || config.assignment !== undefined || config.escalation !== undefined) errors.push(`WORKFLOW_CLOSURE_NODE_INVALID:${node.id}`);
      }
      for (const field of ['isStart', 'isEnd', 'requireIndependentVerification']) if (config[field] !== undefined && typeof config[field] !== 'boolean') errors.push(`WORKFLOW_CONFIG_INVALID:${node.id}`);
      if (config.requireIndependentVerification !== undefined && node.type !== 'CLOSE') errors.push(`WORKFLOW_VERIFICATION_POLICY_INVALID:${node.id}`);
      if (config.assignment !== undefined && !this.hasAssignment(config)) errors.push(`WORKFLOW_ASSIGNMENT_REQUIRED:${node.id}`);
      if (config.editorPosition !== undefined) {
        const position = config.editorPosition;
        if (!this.object(position) || Object.keys(position).some((key) => !['x', 'y'].includes(key)) || ![position.x, position.y].every((value) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 100000)) errors.push(`WORKFLOW_POSITION_INVALID:${node.id}`);
      }
      this.validateTiming(node.id, config, errors);
      this.rejectScript(config, `WORKFLOW_SCRIPT_NOT_ALLOWED:${node.id}`, errors);
    }
    const edgeIds = new Set<string>();
    for (const edge of draft.transitions) {
      if (!this.object(edge)) { errors.push('WORKFLOW_TRANSITION_INVALID'); continue; }
      if (!this.text(edge.id, 100) || edgeIds.has(edge.id)) errors.push('WORKFLOW_TRANSITION_ID_DUPLICATE');
      edgeIds.add(edge.id);
      if (Object.keys(edge).some((key) => !['id', 'from', 'to', 'action', 'condition'].includes(key))) errors.push(`WORKFLOW_TRANSITION_FIELD_NOT_ALLOWED:${edge.id}`);
      if (!this.text(edge.from, 100) || !this.text(edge.to, 100) || !ids.has(edge.from) || !ids.has(edge.to)) errors.push(`WORKFLOW_TRANSITION_NODE_NOT_FOUND:${edge.id}`);
      if (edge.action !== undefined && !WORKFLOW_ACTIONS.some((action) => action === edge.action)) errors.push(`WORKFLOW_TRANSITION_ACTION_INVALID:${edge.id}`);
      this.validateCondition(edge.condition, edge.id, errors);
    }
    return { valid: errors.length === 0, errors: [...new Set(errors)] };
  }

  normalizeDraft(draft: WorkflowDraft): WorkflowDraft {
    const result = this.validateStructure(draft);
    if (!result.valid) throw new BadRequestException({ code: 'WORKFLOW_DRAFT_INVALID', errors: result.errors });
    return {
      nodes: draft.nodes.map((node) => ({ ...node, config: Object.fromEntries(Object.entries(node.config ?? {}).map(([key, value]) => [key, ['assignment', 'escalation'].includes(key) && typeof value === 'string' ? { roleCode: value } : value])) })),
      transitions: draft.transitions.map((edge) => ({ id: edge.id, from: edge.from, to: edge.to, action: edge.action ?? forwardAction(draft.nodes.find((node) => node.id === edge.from)!.type), ...(edge.condition && Object.keys(edge.condition).length ? { condition: edge.condition } : {}) })),
    };
  }

  validateDraft(draft: WorkflowDraft): WorkflowValidationResult {
    const structure = this.validateStructure(draft);
    if (!structure.valid) return structure;
    const errors: string[] = [];
    if (!draft || !Array.isArray(draft.nodes) || !Array.isArray(draft.transitions)) {
      return { valid: false, errors: ['WORKFLOW_DRAFT_REQUIRED'] };
    }
    const nodes = draft.nodes;
    const transitions = draft.transitions;
    const supplierHandling = nodes.filter(node => Object.hasOwn(node.config ?? {}, 'supplierEightD'));
    if (supplierHandling.length) {
      const gates = nodes.filter(node => node.config?.closureReview !== undefined);
      const review = gates[0]?.config?.closureReview;
      if (supplierHandling.length !== 1 || gates.length !== 1 || !this.object(review) || review.policy !== 'SUPPLIER' || review.domainCode !== 'supplier-quality') {
        errors.push('WORKFLOW_SUPPLIER_HANDLING_REQUIRED');
      } else {
        const owner = supplierHandling[0]!; const gate = gates[0]!;
        const edges = transitions.filter(edge => edge.from === owner.id);
        if (edges.length !== 1 || edges[0]!.to !== gate.id || (edges[0]!.action ?? forwardAction(owner.type)) !== 'SUBMIT'
          || Object.keys(edges[0]!.condition ?? {}).length) errors.push('WORKFLOW_SUPPLIER_SUBMIT_REQUIRED');
        if (!transitions.some(edge => edge.from === gate.id && edge.to === owner.id && edge.action === 'RETURN')) errors.push('WORKFLOW_SUPPLIER_RETURN_REQUIRED');
      }
    }
    const handling = nodes.filter(node => node.config?.processEightD !== undefined);
    const processGates = nodes.filter(node => {
      const review = node.config?.closureReview;
      return this.object(review) && ['process-quality', 'customer-quality', 'new-product-quality'].includes(review.domainCode as string) && review.policy === 'INTERNAL';
    });
    if (handling.length || processGates.length) {
      if (handling.length !== 1 || processGates.length !== 1) errors.push('WORKFLOW_PROCESS_HANDLING_REQUIRED');
      else {
        const owner = handling[0]!; const gate = processGates[0]!;
        if ((gate.config!.closureReview as Record<string, unknown>).policy !== 'INTERNAL') errors.push('WORKFLOW_PROCESS_POLICY_INVALID');
        const edges = transitions.filter(edge => edge.from === owner.id);
        if (edges.length !== 1 || edges[0]!.to !== gate.id || (edges[0]!.action ?? forwardAction(owner.type)) !== 'SUBMIT'
          || Object.keys(edges[0]!.condition ?? {}).length) errors.push('WORKFLOW_PROCESS_SUBMIT_REQUIRED');
        if (!transitions.some(edge => edge.from === gate.id && edge.to === owner.id && edge.action === 'RETURN')) errors.push('WORKFLOW_PROCESS_RETURN_REQUIRED');
      }
    }
    const byId = new Map<string, WorkflowDraftNode>();
    for (const node of nodes) {
      if (!node.id || byId.has(node.id)) errors.push('WORKFLOW_NODE_ID_DUPLICATE');
      byId.set(node.id, node);
      if (!WORKFLOW_NODE_TYPES.includes(node.type as WorkflowNodeType)) {
        errors.push(`WORKFLOW_NODE_TYPE_NOT_ALLOWED:${node.type}`);
        continue;
      }
      const config = node.config ?? {};
      if (config.requireIndependentVerification !== undefined && (node.type !== 'CLOSE' || typeof config.requireIndependentVerification !== 'boolean')) errors.push(`WORKFLOW_VERIFICATION_POLICY_INVALID:${node.id}`);
      if (!node.name?.trim()) errors.push(`WORKFLOW_NODE_NAME_REQUIRED:${node.id}`);
      if (ASSIGNMENT_NODES.has(node.type as WorkflowNodeType) && config.closureReview === undefined && !this.hasAssignment(config)) {
        errors.push(`WORKFLOW_ASSIGNMENT_REQUIRED:${node.id}`);
      }
      this.validateTiming(node.id, config, errors);
      this.rejectScript(config, `WORKFLOW_SCRIPT_NOT_ALLOWED:${node.id}`, errors);
    }

    const starts = nodes.filter((node) => node.config?.isStart === true);
    const ends = nodes.filter((node) => node.config?.isEnd === true);
    if (starts.length !== 1) errors.push('WORKFLOW_START_REQUIRED');
    if (starts.some((node) => node.type === 'CLOSE')) errors.push('WORKFLOW_START_CANNOT_CLOSE');
    if (ends.length !== 1) errors.push('WORKFLOW_END_REQUIRED');
    if (ends.some((node) => node.type !== 'CLOSE')) errors.push('WORKFLOW_END_MUST_CLOSE');
    if (nodes.length === 0) errors.push('WORKFLOW_NODE_REQUIRED');

    const outgoing = new Map<string, string[]>();
    const incoming = new Map<string, string[]>();
    for (const node of nodes) {
      outgoing.set(node.id, []);
      incoming.set(node.id, []);
    }
    const transitionIds = new Set<string>();
    const backward: WorkflowDraftTransition[] = [];
    for (const transition of transitions) {
      if (transitionIds.has(transition.id)) errors.push('WORKFLOW_TRANSITION_ID_DUPLICATE');
      transitionIds.add(transition.id);
      if (!byId.has(transition.from) || !byId.has(transition.to)) {
        errors.push(`WORKFLOW_TRANSITION_NODE_NOT_FOUND:${transition.id}`);
        continue;
      }
      if (transition.from === transition.to) errors.push(`WORKFLOW_SELF_LOOP:${transition.id}`);
      const source = byId.get(transition.from)!;
      const action = transition.action ?? forwardAction(source.type);
      if (!WORKFLOW_ACTIONS.some((allowed) => allowed === action) || action === 'CLOSE' || !actionAllowed(source.type, action)) errors.push(`WORKFLOW_TRANSITION_ACTION_INVALID:${transition.id}`);
      this.validateCondition(transition.condition, transition.id, errors);
      if (['RETURN', 'REJECT', 'REOPEN'].includes(action)) {
        backward.push(transition);
        continue;
      }
      outgoing.get(transition.from)!.push(transition.to);
      incoming.get(transition.to)!.push(transition.from);
    }
    for (const transition of backward) {
      if (!this.walk(transition.to, outgoing).has(transition.from)) errors.push(`WORKFLOW_BACKWARD_TARGET_INVALID:${transition.id}`);
    }
    for (const node of nodes.filter(node => node.config?.closureReview !== undefined)) {
      const edges = transitions.filter(edge => edge.from === node.id);
      const returns = edges.filter(edge => edge.action === 'RETURN');
      const approvals = edges.filter(edge => edge.action === 'APPROVE');
      if (returns.length !== 1 || returns.some(edge => byId.get(edge.to)?.type !== 'ACTION' || !this.walk(edge.to, outgoing).has(node.id) || Object.keys(edge.condition ?? {}).length > 0)) errors.push(`WORKFLOW_CLOSURE_RETURN_REQUIRED:${node.id}`);
      const closes = nodes.filter(candidate => candidate.type === 'CLOSE');
      if (closes.length !== 1 || approvals.length !== 1 || approvals.some(edge => edge.to !== closes[0]!.id || Object.keys(edge.condition ?? {}).length > 0)) errors.push(`WORKFLOW_CLOSURE_APPROVE_REQUIRED:${node.id}`);
      if (edges.some(edge => edge.action !== 'APPROVE' && edge.action !== 'RETURN')) errors.push(`WORKFLOW_CLOSURE_TRANSITION_INVALID:${node.id}`);
    }
    if (this.hasCycle(outgoing)) errors.push('WORKFLOW_CYCLE_NOT_ALLOWED');
    if (starts.length === 1 && ends.length === 1) {
      const closureIds = new Set(nodes.filter(node => node.config?.closureReview !== undefined).map(node => node.id));
      if (closureIds.size) {
        const withoutClosure = new Map([...outgoing].filter(([id]) => !closureIds.has(id)).map(([id, targets]) => [id, targets.filter(target => !closureIds.has(target))]));
        if (this.walk(starts[0]!.id, withoutClosure).has(ends[0]!.id)) errors.push('WORKFLOW_CLOSURE_BYPASS_NOT_ALLOWED');
      }
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
    if (typeof assignment === 'string') return this.text(assignment, 100);
    if (!assignment || typeof assignment !== 'object' || Array.isArray(assignment)) return false;
    const value = assignment as Record<string, unknown>;
    const constraints = [value.roleCode, value.assigneeUserId, value.permission].filter((entry) => entry !== undefined);
    return constraints.length > 0 && Object.keys(value).every((key) => ['roleCode', 'assigneeUserId', 'permission'].includes(key))
      && constraints.every((entry) => this.text(entry, 100))
      && (value.assigneeUserId === undefined || isUUID(String(value.assigneeUserId)));
  }

  private validateTiming(id: string, config: Record<string, unknown>, errors: string[]): void {
    if (config.slaMinutes !== undefined && (!Number.isSafeInteger(config.slaMinutes) || Number(config.slaMinutes) <= 0 || Number(config.slaMinutes) > MAX_WORKFLOW_SLA_MINUTES)) {
      errors.push(`WORKFLOW_SLA_INVALID:${id}`);
    }
    const reminders = config.reminders;
    if (reminders !== undefined) {
      const offsets = new Set<unknown>();
      if (!Array.isArray(reminders) || reminders.length > 20 || config.slaMinutes === undefined) errors.push(`WORKFLOW_REMINDER_INVALID:${id}`);
      else for (const reminder of reminders) {
        if (!this.object(reminder) || Object.keys(reminder).some((key) => key !== 'offsetMinutes')) errors.push(`WORKFLOW_REMINDER_INVALID:${id}`);
        const offset = typeof reminder === 'object' && reminder !== null ? (reminder as Record<string, unknown>).offsetMinutes : undefined;
        if (!Number.isSafeInteger(offset) || Number(offset) < 0 || Number(offset) > Number(config.slaMinutes) || offsets.has(offset)) errors.push(`WORKFLOW_REMINDER_INVALID:${id}`);
        offsets.add(offset);
      }
    }
    if (config.escalation !== undefined && (config.slaMinutes === undefined || !this.hasAssignment({ assignment: config.escalation }))) errors.push(`WORKFLOW_ESCALATION_INVALID:${id}`);
  }

  private validateCondition(condition: Record<string, unknown> | undefined, id: string, errors: string[]): void {
    if (condition === undefined) return;
    if (!this.object(condition)) { errors.push(`WORKFLOW_CONDITION_INVALID:${id}`); return; }
    if (Object.keys(condition).length === 0) return;
    if (Object.keys(condition).some((key) => !['field', 'operator', 'value'].includes(key))) errors.push(`WORKFLOW_CONDITION_FIELD_NOT_ALLOWED:${id}`);
    if (this.containsScriptKey(condition)) errors.push(`WORKFLOW_SCRIPT_NOT_ALLOWED:${id}`);
    const field = condition.field;
    const operator = condition.operator;
    if (typeof field !== 'string' || !CONDITION_FIELDS.has(field)) errors.push(`WORKFLOW_CONDITION_FIELD_NOT_ALLOWED:${id}`);
    if (typeof operator !== 'string' || !CONDITION_OPERATORS.has(operator)) errors.push(`WORKFLOW_CONDITION_OPERATOR_NOT_ALLOWED:${id}`);
    const value = condition.value;
    if (value === undefined || (Array.isArray(value) && (value.length === 0 || value.length > 20))) errors.push(`WORKFLOW_CONDITION_VALUE_INVALID:${id}`);
    if (value !== undefined && !this.safeValue(value)) errors.push(`WORKFLOW_CONDITION_VALUE_INVALID:${id}`);
    if (['in', 'notIn'].includes(String(operator)) && !Array.isArray(value)) errors.push(`WORKFLOW_CONDITION_VALUE_INVALID:${id}`);
    if (['eq', 'ne'].includes(String(operator)) && Array.isArray(value)) errors.push(`WORKFLOW_CONDITION_VALUE_INVALID:${id}`);
    if (field !== 'responsibleParty' && (value === null || (Array.isArray(value) && value.includes(null)))) errors.push(`WORKFLOW_CONDITION_VALUE_INVALID:${id}`);
  }

  private safeValue(value: unknown): boolean {
    const scalar = (entry: unknown) => entry === null || (typeof entry === 'string' && entry.length <= 200);
    return scalar(value) || (Array.isArray(value) && value.every(scalar));
  }

  private object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  private text(value: unknown, max: number): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= max; }

  private rejectScript(config: Record<string, unknown>, code: string, errors: string[]): void {
    if (this.containsScriptKey(config)) errors.push(code);
  }

  private containsScriptKey(value: unknown): boolean {
    if (Array.isArray(value)) return value.some((entry) => this.containsScriptKey(entry));
    if (!value || typeof value !== 'object') return false;
    for (const [key, entry] of Object.entries(value)) {
      const normalized = key.toLowerCase();
      if (SCRIPT_KEYS.has(normalized) || normalized.includes('script') || normalized === 'eval' || normalized.includes('function')) return true;
      if (this.containsScriptKey(entry)) return true;
    }
    return false;
  }

  private hasCycle(graph: Map<string, string[]>): boolean {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (node: string): boolean => {
      if (visiting.has(node)) return true;
      if (visited.has(node)) return false;
      visiting.add(node);
      for (const next of graph.get(node) ?? []) if (visit(next)) return true;
      visiting.delete(node);
      visited.add(node);
      return false;
    };
    for (const node of graph.keys()) if (visit(node)) return true;
    return false;
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
