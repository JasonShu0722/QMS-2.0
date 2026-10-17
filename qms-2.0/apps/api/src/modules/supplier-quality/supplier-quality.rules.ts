import { isISO8601 } from 'class-validator';
import { RESPONSE_FORMS, type ResponseForm } from '../problem-index/problem.types.js';
import {
  MATERIAL_CATEGORIES, SUPPLIER_REPLY_MODES, SUPPLIER_SEVERITIES, SupplierRuleError,
  type SupplierActor, type SupplierEvidence, type SupplierProblemFacts, type SupplierProblemResource,
  type SupplierResponseContent, type SupplierVerification,
} from './supplier-quality.types.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const factKeys = new Set([
  'supplierOrganizationId', 'title', 'materialCode', 'materialCategory', 'defectDescription',
  'defectQuantity', 'severity', 'responseForm', 'replyMode', 'internalResponderId',
]);
const responseContentKeys: readonly (keyof SupplierResponseContent)[] = [
  'problemDescription', 'containmentAction', 'interimAction', 'rootCause', 'correctiveAction',
  'preventiveAction', 'verificationResult', 'completionTime',
];

export function validateProblemFacts(input: unknown): SupplierProblemFacts {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SupplierRuleError('SUPPLIER_FACTS_INVALID', { facts: '请提供问题事实' });
  }
  const facts = { ...input } as Record<string, unknown>;
  const fields: Record<string, string> = Object.create(null);
  for (const key of Object.keys(facts)) {
    if (!factKeys.has(key)) fields[key] = '不支持的字段';
  }
  for (const [key, maximum] of [['title', 500], ['materialCode', 100], ['defectDescription', 10000]] as const) {
    const value = facts[key];
    if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) {
      fields[key] = `请填写不超过 ${maximum} 字符的内容`;
    } else {
      facts[key] = value.trim();
    }
  }
  if (facts.supplierOrganizationId !== null && (typeof facts.supplierOrganizationId !== 'string' || !uuidPattern.test(facts.supplierOrganizationId))) {
    fields.supplierOrganizationId = '请选择一家供应商';
  }
  if (typeof facts.defectQuantity !== 'number' || !Number.isSafeInteger(facts.defectQuantity) || facts.defectQuantity < 1) {
    fields.defectQuantity = '不良数量必须为正整数';
  }
  for (const [key, values] of [
    ['severity', SUPPLIER_SEVERITIES], ['responseForm', RESPONSE_FORMS], ['replyMode', SUPPLIER_REPLY_MODES],
  ] as const) {
    if (!(values as readonly unknown[]).includes(facts[key])) fields[key] = '请选择有效选项';
  }
  if (facts.materialCategory !== undefined && !(MATERIAL_CATEGORIES as readonly unknown[]).includes(facts.materialCategory)) {
    fields.materialCategory = '请选择有效来料分类';
  }
  if (facts.replyMode === 'INTERNAL') {
    if (typeof facts.internalResponderId !== 'string' || !uuidPattern.test(facts.internalResponderId)) {
      fields.internalResponderId = '请选择内部回复人';
    }
  } else if (facts.internalResponderId !== undefined) {
    fields.internalResponderId = '供应商回复模式不能指定内部回复人';
  }
  if (Object.keys(fields).length) throw new SupplierRuleError('SUPPLIER_FACTS_INVALID', fields);
  return facts as unknown as SupplierProblemFacts;
}

export function assertResourceScope(
  actor: SupplierActor, resource: SupplierProblemResource, authorizedInternalOrganizationId?: string,
): void {
  const allowed = actor.accountType === 'INTERNAL'
    ? authorizedInternalOrganizationId === resource.ownerOrganizationId
    : actor.accountType === 'SUPPLIER' && resource.replyMode === 'SUPPLIER'
      && resource.releasedToSupplier && actor.organizationId === resource.supplierOrganizationId;
  if (!allowed) throw new SupplierRuleError('SUPPLIER_RESOURCE_DENIED');
}

export function assertReplyActor(
  actor: SupplierActor, resource: SupplierProblemResource, authorizedInternalOrganizationId?: string,
): void {
  assertResourceScope(actor, resource, authorizedInternalOrganizationId);
  const allowed = resource.replyMode === 'INTERNAL'
    ? actor.accountType === 'INTERNAL' && actor.id === resource.internalResponderId
    : actor.accountType === 'SUPPLIER';
  if (!allowed) throw new SupplierRuleError('SUPPLIER_REPLY_DENIED');
}

export function assertInternalClosure(
  actor: SupplierActor, resource: SupplierProblemResource, verification: SupplierVerification | null,
  authorizedInternalOrganizationId?: string,
): void {
  assertResourceScope(actor, resource, authorizedInternalOrganizationId);
  if (actor.accountType !== 'INTERNAL' || !verification?.accepted
    || verification.problemId !== resource.id || !uuidPattern.test(verification.verifierId)
    || verification.verifierId === actor.id || verification.contentVersion !== resource.contentVersion
    || !Number.isSafeInteger(resource.contentVersion) || resource.contentVersion < 1) {
    throw new SupplierRuleError('SUPPLIER_CLOSURE_DENIED');
  }
}

export function assertEvidenceReferences(
  resource: SupplierProblemResource, fileIds: readonly string[], resolvedFiles: readonly SupplierEvidence[],
): void {
  const references = new Set(fileIds);
  const files = new Map(resolvedFiles.map((file) => [file.id, file]));
  if (references.size !== fileIds.length || files.size !== resolvedFiles.length || files.size !== references.size) {
    throw new SupplierRuleError('SUPPLIER_EVIDENCE_INVALID');
  }
  for (const fileId of references) {
    const file = files.get(fileId);
    if (!file || file.status !== 'AVAILABLE' || file.resourceType !== 'supplier-quality'
      || file.resourceId !== resource.id
      || ![resource.ownerOrganizationId, resource.supplierOrganizationId].includes(file.organizationId)) {
      throw new SupplierRuleError('SUPPLIER_EVIDENCE_INVALID');
    }
  }
}

export function mergeBriefContent(
  brief: SupplierResponseContent, existingEightD: SupplierResponseContent,
): SupplierResponseContent {
  const merged = { ...existingEightD };
  for (const key of responseContentKeys) {
    if (merged[key] === undefined && brief[key] !== undefined) merged[key] = brief[key];
  }
  return merged;
}

export function validateResponseContent(
  form: ResponseForm, input: unknown, mode: 'DRAFT' | 'SUBMIT',
): SupplierResponseContent {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || !RESPONSE_FORMS.includes(form) || !['DRAFT', 'SUBMIT'].includes(mode)) {
    throw new SupplierRuleError('SUPPLIER_RESPONSE_INVALID');
  }
  const fields: Record<string, string> = Object.create(null);
  const content: Record<string, string> = Object.create(null);
  for (const [key, value] of Object.entries(input)) {
    if (!(responseContentKeys as readonly string[]).includes(key)) {
      fields[key] = '不支持的字段';
    } else if (value === undefined) {
      continue;
    } else if (typeof value !== 'string' || value.trim().length > 10000) {
      fields[key] = '请填写不超过 10000 字符的内容';
    } else {
      content[key] = value.trim();
    }
  }
  if (content.completionTime && (!isISO8601(content.completionTime, { strict: true, strictSeparator: true })
    || !/(?:Z|[+-]\d{2}:\d{2})$/.test(content.completionTime))) {
    fields.completionTime = '请填写包含时区的有效完成时间';
  }
  if (mode === 'SUBMIT') {
    const required = form === 'BRIEF'
      ? ['rootCause', 'correctiveAction', 'completionTime']
      : responseContentKeys.filter((key) => key !== 'completionTime');
    for (const key of required) {
      if (!content[key]) fields[key] = '请填写该项内容';
    }
  }
  if (Object.keys(fields).length) throw new SupplierRuleError('SUPPLIER_RESPONSE_INVALID', fields);
  return { ...content };
}
