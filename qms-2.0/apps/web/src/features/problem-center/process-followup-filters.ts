import type { components } from '@qms/contracts';

type SavedFilters = components['schemas']['ProblemSavedViewFiltersDto'];
export type FollowupGroup = components['schemas']['ProcessFollowupFiltersDto'];
export type FollowupCondition = FollowupGroup['items'][number];
export type FollowupField = FollowupCondition['field'];

export const followupFields = [
  ['stage', '当前环节'], ['status', '状态'], ['severity', '风险'],
  ['responsibleSectionName', '责任科室'], ['ownerName', '负责人'], ['dueAt', '办理期限'],
] as const satisfies ReadonlyArray<readonly [FollowupField, string]>;
export const followupStageLabels = {
  ANALYSIS: '分析阶段', SUBMISSION: '完整提交阶段', CLOSURE: '关闭阶段', CLOSURE_REVIEW: '关闭审批中', CLOSED: '已关闭', ARCHIVED: '已归档',
  CANCELLED: '已取消', SUSPENDED: '已暂停', FAILED: '流程失败', COMPLETED: '流程已结束',
} as const;
export const followupSeverities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const emptyFollowupGroup: FollowupGroup = { logic: 'ALL', items: [] };
export const followupMaxItems = 10;

type OperatorOption = readonly [FollowupCondition['operator'], string];
const enumOperators: readonly OperatorOption[] = [['EQ', '等于'], ['NE', '不等于'], ['EMPTY', '为空'], ['NOT_EMPTY', '不为空']];
const names: readonly OperatorOption[] = [['CONTAINS', '包含'], ['NOT_CONTAINS', '不包含'], ...enumOperators];
const dates: readonly OperatorOption[] = [['GTE', '不早于'], ['LTE', '不晚于'], ['AFTER', '晚于'], ['BEFORE', '早于'], ...enumOperators];
export const withoutValue = (operator: FollowupCondition['operator']) => operator === 'EMPTY' || operator === 'NOT_EMPTY';

export function followupOperators(field: FollowupField) {
  if (field === 'dueAt') return dates;
  if (field === 'ownerName' || field === 'responsibleSectionName') return names;
  return enumOperators;
}

export function normalizeFollowupFilters(filters: SavedFilters): SavedFilters {
  const legacyItems: FollowupCondition[] = [];
  if (!filters.processFollowupFilters) {
    if (filters.stage && Object.hasOwn(followupStageLabels, filters.stage)) legacyItems.push({ field: 'stage', operator: 'EQ', value: filters.stage });
    if (filters.status) legacyItems.push({ field: 'status', operator: 'EQ', value: filters.status });
    if (followupSeverities.some(severity => severity === filters.severity)) legacyItems.push({ field: 'severity', operator: 'EQ', value: filters.severity });
    if (filters.ownerName) legacyItems.push({ field: 'ownerName', operator: 'CONTAINS', value: filters.ownerName });
    if (filters.responsibleSectionName) legacyItems.push({ field: 'responsibleSectionName', operator: 'CONTAINS', value: filters.responsibleSectionName });
    if (filters.dueFrom) legacyItems.push({ field: 'dueAt', operator: 'GTE', value: filters.dueFrom });
    if (filters.dueTo) legacyItems.push({ field: 'dueAt', operator: 'LTE', value: filters.dueTo });
  }
  const group = filters.processFollowupFilters ?? { logic: 'ALL', items: legacyItems };
  const items = group.items.flatMap((item): FollowupCondition[] => {
    if (withoutValue(item.operator)) return [{ field: item.field, operator: item.operator }];
    const value = item.value?.trim();
    return value ? [{ ...item, value }] : [];
  });
  const search = filters.search?.trim();
  return { ...(search ? { search } : {}), ...(filters.overdueAt ? { overdueAt: filters.overdueAt } : {}),
    ...(items.length ? { processFollowupFilters: { logic: group.logic, items } } : {}) };
}

export function followupFiltersTooLong(group?: FollowupGroup) {
  return !!group && new URLSearchParams({ filters: JSON.stringify(group) }).toString().length > 5500;
}
