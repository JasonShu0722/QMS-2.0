import { PROCESS_DEFECT_MANUAL_UPDATE, type AuditLogService } from '../audit-log/audit-log.service.js';
import { recentDomainSourceLinkChanges } from '../problem-index/domain-source-link-history.read-model.js';
import type { Prisma } from '../../generated/prisma/client.js';

const updateFieldLabels = {
  defectTypeCode: '失效类型', description: '不良描述', defectQuantity: '不良数量', occurredAt: '发生时间', factoryCode: '工厂', shift: '班次',
  batchCode: '批次', workOrderCode: '工单', operationCode: '工序编码', operationName: '工序名称', lineCode: '产线编码', lineName: '生产线名称',
  projectCode: '项目号', productCode: '产品编码', traceCode: '追溯码', externalRecordKey: '来源记录键',
  analysisProgress: '分析进度', responsibilityCategory: '责任类别', materialCode: '物料编码', materialName: '物料名称',
  supplierProfileId: '供应商', supplierOrganizationId: '供应商', materialBatch: '物料批次', sqeUserId: '责任 SQE', notes: '物料备注',
  verification: '复核情况', verificationNotes: '复核说明', dispositionPlan: '处置方案', dispositionProgress: '处置进度', dispositionCompletedAt: '处置完成时间',
  materialAdded: '新增异常物料', materialRemoved: '移除异常物料', materialOrder: '调整异常物料顺序',
  ledgerClosed: '关闭台账', ledgerReopened: '打开已关闭台账', attachmentAdded: '新增附件', attachmentRemoved: '删除附件',
} as const;

export type ProcessDefectUpdateField = keyof typeof updateFieldLabels;
const actionFields = new Set<ProcessDefectUpdateField>(['materialAdded', 'materialRemoved', 'materialOrder', 'ledgerClosed', 'ledgerReopened', 'attachmentAdded', 'attachmentRemoved']);
const updateRecordLimit = 100;

export function processDefectChanges<RecordType, Field extends keyof RecordType & ProcessDefectUpdateField>(previous: RecordType, current: RecordType, fields: readonly Field[]): Field[] {
  return fields.filter(field => {
    const before = previous[field];
    const after = current[field];
    return before instanceof Date && after instanceof Date ? before.getTime() !== after.getTime() : before !== after;
  });
}

export async function recordProcessDefectUpdate(audit: AuditLogService, tx: Prisma.TransactionClient,
  input: { organizationId: string; actorUserId: string; resourceId: string; traceId: string }, fields: readonly ProcessDefectUpdateField[]) {
  if (!fields.length) return;
  await audit.record({ ...input, action: PROCESS_DEFECT_MANUAL_UPDATE, resourceType: 'ProcessDefect', outcome: 'SUCCESS',
    metadata: { changedFields: [...new Set(fields)].join(',') } }, tx);
}

export async function processDefectUpdateRecords(audit: AuditLogService, tx: Prisma.TransactionClient, organizationId: string, resourceId: string) {
  const [events, links] = await Promise.all([
    audit.recentSuccessfulResourceEvents(tx, { organizationId, action: PROCESS_DEFECT_MANUAL_UPDATE, resourceType: 'ProcessDefect', resourceId }),
    recentDomainSourceLinkChanges(tx, { organizationId, sourceDomain: 'process-quality', sourceType: 'process-defect', sourceId: resourceId }, updateRecordLimit),
  ]);
  const records = events.flatMap(event => {
    const metadata = event.metadata as { changedFields?: unknown } | null;
    const fields = (typeof metadata?.changedFields === 'string' ? metadata.changedFields.split(',') : []).filter((field): field is ProcessDefectUpdateField => Object.hasOwn(updateFieldLabels, field));
    if (!fields.length) return [];
    const updated = [...new Set(fields.filter(field => !actionFields.has(field)).map(field => updateFieldLabels[field]))];
    const actions = fields.filter(field => actionFields.has(field)).map(field => updateFieldLabels[field]);
    const content = [...(updated.length ? [`更新${updated.join('、')}`] : []), ...actions].join('；');
    return [{ id: event.id, occurredAt: event.createdAt.toISOString(), content, actorName: event.actor?.fullName?.trim() || event.actor?.username || '—' }];
  });
  for (const link of links) {
    records.push({ id: link.id, occurredAt: link.changedAt.toISOString(), actorName: link.actorName,
      content: link.action === 'LINKED' ? '关联问题' : '取消关联问题' });
  }
  return records.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id)).slice(0, updateRecordLimit);
}
