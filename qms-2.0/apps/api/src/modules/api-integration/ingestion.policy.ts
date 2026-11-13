import { HttpException } from '@nestjs/common';
import { isISO8601 } from 'class-validator';

export type IngestionTarget = 'SUPPLIER' | 'CUSTOMER' | 'MATERIAL' | 'COMPONENT';
export type IngestionFields = { code: string; name: string; contactName?: string; contactEmail?: string };
export type IngestionCondition = { path: string; operator: 'EQ' | 'NE' | 'IN' | 'NOT_IN' | 'EMPTY' | 'NOT_EMPTY'; value?: string | number | boolean | null | (string | number | boolean)[] };
export type IngestionRule = { name: string; endpointId: string; target: IngestionTarget; enabled: boolean; match: 'ALL' | 'ANY'; conditions: IngestionCondition[]; mapping: Record<string, string>; mode: 'INSERT_ONLY' | 'UPDATE' | 'CONFIRM'; updateFields: string[]; sourceUpdatedAtField?: string };

export function ingestionError(code: string, status = 400, field?: string): never { throw new HttpException({ code, message: code, ...(field ? { field } : {}) }, status); }
export function ingestionTargetPermission(target: IngestionTarget): string {
  return { SUPPLIER: 'supplier-quality:profiles:write', CUSTOMER: 'customer-quality:complaints:write', MATERIAL: 'material-master:write', COMPONENT: 'component-project:manage' }[target];
}
const scalar = (value: unknown) => value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value);
const validPath = (value: unknown): value is string => typeof value === 'string' && value.length <= 200 && value.split('.').length <= 8 && value.split('.').every(part => /^[A-Za-z0-9_-]{1,64}$/.test(part) && !['__proto__', 'prototype', 'constructor'].includes(part));

export function normalizeIngestionRule(input: unknown): IngestionRule {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ingestionError('INGESTION_RULE_INVALID');
  const rule = input as IngestionRule;
  const fields = rule.target === 'SUPPLIER' ? ['code', 'name', 'contactName', 'contactEmail'] : ['code', 'name'];
  if (typeof rule.name !== 'string' || !rule.name.trim() || rule.name.trim().length > 120
    || !['SUPPLIER', 'CUSTOMER', 'MATERIAL', 'COMPONENT'].includes(rule.target) || typeof rule.enabled !== 'boolean'
    || !['ALL', 'ANY'].includes(rule.match) || !['INSERT_ONLY', 'UPDATE', 'CONFIRM'].includes(rule.mode)
    || !Array.isArray(rule.conditions) || rule.conditions.length > 20 || !Array.isArray(rule.updateFields)
    || new Set(rule.updateFields).size !== rule.updateFields.length || rule.updateFields.some(field => field === 'code' || !fields.includes(field))
    || !rule.mapping || typeof rule.mapping !== 'object' || Array.isArray(rule.mapping) || !validPath(rule.mapping.code) || !validPath(rule.mapping.name)
    || Object.entries(rule.mapping).some(([field, path]) => !fields.includes(field) || !validPath(path))
    || rule.sourceUpdatedAtField !== undefined && !validPath(rule.sourceUpdatedAtField)) return ingestionError('INGESTION_RULE_INVALID');
  for (const condition of rule.conditions) {
    if (!condition || !validPath(condition.path) || !['EQ', 'NE', 'IN', 'NOT_IN', 'EMPTY', 'NOT_EMPTY'].includes(condition.operator)) ingestionError('INGESTION_RULE_INVALID');
    if (['EQ', 'NE'].includes(condition.operator) && !scalar(condition.value)) ingestionError('INGESTION_RULE_INVALID');
    if (['IN', 'NOT_IN'].includes(condition.operator) && (!Array.isArray(condition.value) || condition.value.length === 0 || condition.value.length > 50 || condition.value.some(value => !scalar(value)) || new Set(condition.value.map(value => typeof value)).size > 1)) ingestionError('INGESTION_RULE_INVALID');
    if (['EMPTY', 'NOT_EMPTY'].includes(condition.operator) && condition.value !== undefined) ingestionError('INGESTION_RULE_INVALID');
  }
  return { name: rule.name.trim(), endpointId: rule.endpointId, target: rule.target, enabled: rule.enabled, match: rule.match, conditions: rule.conditions, mapping: rule.mapping, mode: rule.mode, updateFields: rule.updateFields, ...(rule.sourceUpdatedAtField ? { sourceUpdatedAtField: rule.sourceUpdatedAtField } : {}) };
}

function pathValue(row: unknown, path: string): unknown {
  let value: unknown = row;
  for (const part of path.split('.')) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, part)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

export function evaluateIngestionRow(rule: IngestionRule, row: unknown): { matched: false } | { matched: true; fields: IngestionFields; sourceUpdatedAt: string | null } {
  const conditions = rule.conditions.map(condition => {
    const value = pathValue(row, condition.path);
    if (value === undefined) ingestionError('INGESTION_FIELD_MISSING', 400, condition.path);
    if (!scalar(value)) ingestionError('INGESTION_FIELD_TYPE', 400, condition.path);
    if (condition.operator === 'EMPTY') return value === null || value === '';
    if (condition.operator === 'NOT_EMPTY') return value !== null && value !== '';
    const expected = Array.isArray(condition.value) ? condition.value : [condition.value];
    if (value !== null && expected.some(item => item !== null && typeof item !== typeof value)) ingestionError('INGESTION_FIELD_TYPE', 400, condition.path);
    const equal = expected.some(item => item === value);
    return condition.operator === 'NE' || condition.operator === 'NOT_IN' ? !equal : equal;
  });
  if (conditions.length && !(rule.match === 'ALL' ? conditions.every(Boolean) : conditions.some(Boolean))) return { matched: false };
  const fields: Record<string, string> = {};
  for (const [field, path] of Object.entries(rule.mapping)) {
    const value = pathValue(row, path);
    if (value === undefined || value === null || value === '') {
      if (field === 'code' || field === 'name') ingestionError('INGESTION_FIELD_MISSING', 400, path);
      continue;
    }
    if (typeof value !== 'string') ingestionError('INGESTION_FIELD_TYPE', 400, path);
    const maximum = field === 'code' ? 100 : field === 'name' ? 200 : field === 'contactEmail' ? 254 : 100;
    if (!value.trim() || value.trim().length > maximum || /[\u0000\uD800-\uDFFF]/u.test(value) || field === 'contactEmail' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) ingestionError('INGESTION_FIELD_INVALID', 400, path);
    fields[field] = value.trim();
  }
  let sourceUpdatedAt: string | null = null;
  if (rule.sourceUpdatedAtField) {
    const value = pathValue(row, rule.sourceUpdatedAtField);
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !isISO8601(value, { strict: true }) || !Number.isFinite(Date.parse(value))) ingestionError('INGESTION_SOURCE_VERSION_INVALID', 400, rule.sourceUpdatedAtField);
    sourceUpdatedAt = new Date(value).toISOString();
  }
  return { matched: true, fields: fields as IngestionFields, sourceUpdatedAt };
}
