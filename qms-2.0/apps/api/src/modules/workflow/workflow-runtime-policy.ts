import { HttpException } from '@nestjs/common';
import { PLATFORM_ERROR_MESSAGES, type PlatformErrorCode } from '../../common/contracts/platform-error.js';
import type { WorkflowAction } from './workflow.types.js';

export function workflowError(code: PlatformErrorCode, status: number): never {
  throw new HttpException({ code, message: PLATFORM_ERROR_MESSAGES[code] }, status);
}

export function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function isClosureReviewNode(node: { config: unknown }): boolean {
  return Object.hasOwn(jsonObject(node.config), 'closureReview');
}

export function forwardAction(type: string): WorkflowAction {
  if (type === 'APPROVAL') return 'APPROVE';
  if (type === 'VERIFICATION') return 'VERIFY';
  if (type === 'CLOSE') return 'CLOSE';
  if (type === 'REJECT') return 'REJECT';
  if (type === 'RETURN') return 'RETURN';
  if (type === 'REOPEN') return 'REOPEN';
  return 'SUBMIT';
}

export function actionAllowed(type: string, action: string): boolean {
  if (action === forwardAction(type)) return true;
  if (type === 'CLOSE') return action === 'REOPEN' || action === 'RETURN';
  return ['ACTION', 'APPROVAL', 'VERIFICATION'].includes(type) && ['REJECT', 'RETURN'].includes(action);
}

export function matchesCondition(value: unknown, facts: Record<string, unknown>): boolean {
  const condition = jsonObject(value);
  if (Object.keys(condition).length === 0) return true;
  const actual = facts[String(condition.field)];
  const expected = condition.value;
  if (!['status', 'severity', 'problemType', 'domainCode', 'sourceType', 'responsibleParty'].includes(String(condition.field))) return false;
  switch (condition.operator) {
    case 'eq': return actual === expected;
    case 'ne': return actual !== expected;
    case 'in': return Array.isArray(expected) && expected.includes(actual);
    case 'notIn': return Array.isArray(expected) && !expected.includes(actual);
    case 'gt': return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case 'gte': return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
    case 'lt': return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    case 'lte': return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
    default: return false;
  }
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([first], [second]) => first.localeCompare(second)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
