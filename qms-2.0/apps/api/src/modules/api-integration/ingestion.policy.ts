import { HttpException } from '@nestjs/common';
import { isISO8601, isUUID } from 'class-validator';
import type { IntegrationFields, IntegrationTarget, ProcessDefectIntegrationFields } from '../../common/integration-master-data.js';
import type { AiDescriptionOutput } from '../../common/ai-description.js';
import { normalizeAiOutput } from '../ai-configuration/ai-connection.policy.js';
import type { AiApplicationBinding } from '../ai-configuration/ai-application.service.js';
export { aiDescriptionDisposition } from '../../common/ai-description.js';

export type IngestionTarget = IntegrationTarget;
export type IngestionFields = IntegrationFields | Omit<ProcessDefectIntegrationFields, 'receiptId' | 'rowIndex'>;
export type IngestionDescriptionComposition = { fields: { path: string; label?: string }[]; separator: string };
export type IngestionCondition = { path: string; operator: 'EQ' | 'NE' | 'IN' | 'NOT_IN' | 'EMPTY' | 'NOT_EMPTY'; value?: string | number | boolean | null | (string | number | boolean)[] };
export type IngestionRule = { name: string; endpointId: string; target: IngestionTarget; enabled: boolean; match: 'ALL' | 'ANY'; conditions: IngestionCondition[]; mapping: Record<string, string>; mode: 'INSERT_ONLY' | 'UPDATE' | 'CONFIRM'; updateFields: string[]; sourceUpdatedAtField?: string; sourceTimezone?: string; descriptionComposition?: IngestionDescriptionComposition; aiApplication?: AiApplicationBinding; aiDescription?: { connectionId: string; model: string; prompt: string; inputFields: { path: string; label?: string; variable: string }[]; output: AiDescriptionOutput; connectionVersion?: number } };
export const processDefectSourceFields = ['occurredAt', 'productCode', 'workOrderCode', 'lineCode', 'lineName', 'operationCode', 'operationName', 'traceCode', 'description', 'externalRecordKey'];

export function ingestionError(code: string, status = 400, field?: string): never { throw new HttpException({ code, message: code, ...(field ? { field } : {}) }, status); }
export function ingestionTargetPermission(target: IngestionTarget): string {
  return { SUPPLIER: 'supplier-quality:profiles:write', CUSTOMER: 'customer-quality:complaints:write', MATERIAL: 'material-master:write', COMPONENT: 'component-project:manage', PROCESS_DEFECT: 'process-quality:defects:write' }[target];
}
const scalar = (value: unknown) => value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value);
const validPath = (value: unknown): value is string => typeof value === 'string' && value.length <= 200 && value.split('.').length <= 8 && value.split('.').every(part => /^[A-Za-z0-9_-]{1,64}$/.test(part) && !['__proto__', 'prototype', 'constructor'].includes(part));

export function normalizeIngestionRule(input: unknown): IngestionRule {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ingestionError('INGESTION_RULE_INVALID');
  const rule = input as IngestionRule;
  const process = rule.target === 'PROCESS_DEFECT';
  if (rule.aiApplication !== undefined) {
    const binding = rule.aiApplication;
    if (!process || !binding || !isUUID(binding.applicationId) || !Number.isSafeInteger(binding.publishedVersion) || binding.publishedVersion < 1 || binding.publishedVersion > 2147483647
      || !Array.isArray(binding.inputFields) || !binding.inputFields.length || binding.inputFields.length > 20
      || binding.inputFields.some(field => !field || !validPath(field.path) || typeof field.variable !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(field.variable)
        || field.label !== undefined && (typeof field.label !== 'string' || field.label.length > 100 || /[\u0000]/u.test(field.label)))
      || new Set(binding.inputFields.map(field => field.variable)).size !== binding.inputFields.length) ingestionError('INGESTION_RULE_INVALID');
  }
  const fields = process ? processDefectSourceFields : rule.target === 'SUPPLIER' ? ['code', 'name', 'contactName', 'contactEmail'] : ['code', 'name'];
  if (rule.aiDescription !== undefined && (!process || !rule.aiDescription || !isUUID(rule.aiDescription.connectionId)
    || typeof rule.aiDescription.prompt !== 'string' || !rule.aiDescription.prompt.trim() || rule.aiDescription.prompt.length > 4000
    || /[\u0000]/u.test(rule.aiDescription.prompt))) ingestionError('INGESTION_RULE_INVALID');
  if (rule.aiDescription) {
    const ai = rule.aiDescription;
    if (typeof ai.model !== 'string' || !ai.model.trim() || ai.model.length > 120 || !Array.isArray(ai.inputFields) || !ai.inputFields.length || ai.inputFields.length > 20
      || ai.inputFields.some(field => !field || !validPath(field.path) || typeof field.variable !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(field.variable)
        || field.label !== undefined && (typeof field.label !== 'string' || field.label.length > 100 || /[\u0000]/u.test(field.label)))
      || new Set(ai.inputFields.map(field => field.variable)).size !== ai.inputFields.length || !ai.output) ingestionError('INGESTION_RULE_INVALID');
    try { normalizeAiOutput(ai.output); } catch { ingestionError('INGESTION_RULE_INVALID'); }
    const variables = new Set(ai.inputFields.map(field => field.variable));
    if ([...ai.prompt.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)].some(match => !variables.has(match[1]!.trim()))) ingestionError('INGESTION_RULE_INVALID');
  }
  if (typeof rule.name !== 'string' || !rule.name.trim() || rule.name.trim().length > 120
    || !['SUPPLIER', 'CUSTOMER', 'MATERIAL', 'COMPONENT', 'PROCESS_DEFECT'].includes(rule.target) || typeof rule.enabled !== 'boolean'
    || !['ALL', 'ANY'].includes(rule.match) || !['INSERT_ONLY', 'UPDATE', 'CONFIRM'].includes(rule.mode)
    || !Array.isArray(rule.conditions) || rule.conditions.length > 20 || !Array.isArray(rule.updateFields)
    || new Set(rule.updateFields).size !== rule.updateFields.length || rule.updateFields.some(field => ['code', 'externalRecordKey'].includes(field) || !fields.includes(field))
    || !rule.mapping || typeof rule.mapping !== 'object' || Array.isArray(rule.mapping) || !process && (!validPath(rule.mapping.code) || !validPath(rule.mapping.name))
    || Object.entries(rule.mapping).some(([field, path]) => !fields.includes(field) || !validPath(path))
    || rule.sourceUpdatedAtField !== undefined && !validPath(rule.sourceUpdatedAtField)) return ingestionError('INGESTION_RULE_INVALID');
  if (!process && (rule.descriptionComposition !== undefined || rule.sourceTimezone !== undefined)) ingestionError('INGESTION_RULE_INVALID');
  if (rule.sourceTimezone !== undefined) {
    if (typeof rule.sourceTimezone !== 'string' || rule.sourceTimezone.length > 100) ingestionError('INGESTION_RULE_INVALID');
    try { new Intl.DateTimeFormat('en', { timeZone: rule.sourceTimezone }); } catch { ingestionError('INGESTION_RULE_INVALID'); }
  }
  if (rule.descriptionComposition !== undefined) {
    const composition = rule.descriptionComposition;
    if (!composition || typeof composition !== 'object' || Array.isArray(composition) || rule.mapping.description !== undefined || !Array.isArray(composition.fields) || !composition.fields.length || composition.fields.length > 20
      || typeof composition.separator !== 'string' || !/^[\n ,，;；:：、|/。.-]{0,10}$/.test(composition.separator)
      || composition.fields.some(field => !field || !validPath(field.path) || field.label !== undefined && (typeof field.label !== 'string' || field.label.length > 100 || /[\u0000\uD800-\uDFFF]/u.test(field.label)))) ingestionError('INGESTION_RULE_INVALID');
  }
  for (const condition of rule.conditions) {
    if (!condition || !validPath(condition.path) || !['EQ', 'NE', 'IN', 'NOT_IN', 'EMPTY', 'NOT_EMPTY'].includes(condition.operator)) ingestionError('INGESTION_RULE_INVALID');
    if (['EQ', 'NE'].includes(condition.operator) && !scalar(condition.value)) ingestionError('INGESTION_RULE_INVALID');
    if (['IN', 'NOT_IN'].includes(condition.operator) && (!Array.isArray(condition.value) || condition.value.length === 0 || condition.value.length > 50 || condition.value.some(value => !scalar(value)) || new Set(condition.value.map(value => typeof value)).size > 1)) ingestionError('INGESTION_RULE_INVALID');
    if (['EMPTY', 'NOT_EMPTY'].includes(condition.operator) && condition.value !== undefined) ingestionError('INGESTION_RULE_INVALID');
  }
  return { name: rule.name.trim(), endpointId: rule.endpointId, target: rule.target, enabled: rule.enabled, match: rule.match, conditions: rule.conditions, mapping: rule.mapping, mode: rule.mode, updateFields: rule.updateFields, ...(rule.sourceUpdatedAtField ? { sourceUpdatedAtField: rule.sourceUpdatedAtField } : {}), ...(process ? { sourceTimezone: rule.sourceTimezone ?? 'Asia/Shanghai' } : {}), ...(rule.descriptionComposition ? { descriptionComposition: rule.descriptionComposition } : {}), ...(rule.aiApplication ? { aiApplication: { applicationId: rule.aiApplication.applicationId, publishedVersion: rule.aiApplication.publishedVersion, inputFields: rule.aiApplication.inputFields } } : {}), ...(rule.aiDescription ? { aiDescription: { connectionId: rule.aiDescription.connectionId, model: rule.aiDescription.model.trim(), prompt: rule.aiDescription.prompt.trim(), inputFields: rule.aiDescription.inputFields, output: rule.aiDescription.output } } : {}) };
}

export function selectedDescriptionInput(rule: IngestionRule, row: unknown): { path: string; label: string; variable?: string; value: string | number | boolean | null }[] {
  return (rule.aiDescription?.inputFields ?? []).flatMap(field => {
    const value = pathValue(row, field.path);
    return value !== undefined && scalar(value) ? [{ path: field.path, label: field.label ?? '', variable: field.variable, value: value as string | number | boolean | null }] : [];
  });
}

function pathValue(row: unknown, path: string): unknown {
  let value: unknown = row;
  for (const part of path.split('.')) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, part)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function processTimestamp(value: string, timeZone: string): string | undefined {
  if (!/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)?$/.test(value) || !isISO8601(value.replace(' ', 'T'), { strict: true })) return undefined;
  if (/(?:Z|[+-]\d\d:\d\d)$/.test(value)) return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
  const normalized = value.replace(' ', 'T'), calendar = Date.parse(`${normalized}Z`);
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const wallTime = (instant: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]));
    return Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`) + calendar % 1000;
  };
  const offsets = new Set([-86400000, 0, 86400000].map(delta => wallTime(calendar + delta) - calendar - delta));
  const candidates = [...offsets].map(offset => calendar - offset).filter(instant => wallTime(instant) === calendar);
  return candidates.length === 1 ? new Date(candidates[0]!).toISOString() : undefined;
}

function evaluateProcessDefect(rule: IngestionRule, row: unknown): { matched: true; fields: IngestionFields; sourceUpdatedAt: string | null } {
  const fields: Record<string, string> = {}, issues: string[] = [];
  for (const [field, path] of Object.entries(rule.mapping)) {
    let value = pathValue(row, path);
    if (value === undefined || value === null || value === '') continue;
    if (field === 'description' && scalar(value)) value = String(value);
    if (typeof value !== 'string') { issues.push(`${field}:TYPE`); continue; }
    const text = value.trim(), maximum = field === 'description' ? 10000 : ['lineName', 'operationName', 'traceCode', 'externalRecordKey'].includes(field) ? 200 : 100;
    if (!text) continue;
    if (text.length > maximum || /[\u0000\uD800-\uDFFF]/u.test(text)) { issues.push(`${field}:INVALID`); continue; }
    if (field === 'occurredAt') {
      const timestamp = processTimestamp(text, rule.sourceTimezone ?? 'Asia/Shanghai');
      if (timestamp) fields.occurredAt = timestamp; else issues.push('occurredAt:INVALID');
    } else fields[field] = text;
  }
  if (rule.descriptionComposition) {
    const fragments: string[] = [];
    for (const part of rule.descriptionComposition.fields) {
      const value = pathValue(row, part.path);
      if (value === undefined || value === null || typeof value === 'string' && !value.trim()) continue;
      if (!scalar(value)) { issues.push('description:TYPE'); continue; }
      const text = `${part.label?.trim() ?? ''}${String(value).trim()}`;
      if (/[\u0000\uD800-\uDFFF]/u.test(text)) { issues.push('description:INVALID'); continue; }
      fragments.push(text);
    }
    const description = fragments.join(rule.descriptionComposition.separator);
    if (description.length > 10000) issues.push('description:INVALID');
    else if (description) fields.description = description;
  }
  let sourceUpdatedAt: string | null = null;
  if (rule.sourceUpdatedAtField) {
    const value = pathValue(row, rule.sourceUpdatedAtField);
    sourceUpdatedAt = typeof value === 'string' ? processTimestamp(value.trim(), rule.sourceTimezone ?? 'Asia/Shanghai') ?? null : null;
    if (!sourceUpdatedAt) issues.push('sourceObservedAt:INVALID');
    else fields.sourceObservedAt = sourceUpdatedAt;
  }
  return { matched: true, fields: { ...fields, issues: [...new Set(issues)] }, sourceUpdatedAt };
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
  if (rule.target === 'PROCESS_DEFECT') return evaluateProcessDefect(rule, row);
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
