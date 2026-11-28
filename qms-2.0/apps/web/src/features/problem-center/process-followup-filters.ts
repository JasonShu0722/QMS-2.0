import type { components } from '@qms/contracts';
import type { ProcessFollowupPage } from './problem-center-api';

type SavedFilters = components['schemas']['ProblemSavedViewFiltersDto'];
export type FollowupGroup = components['schemas']['ProcessFollowupFiltersDto'];
export type FollowupCondition = FollowupGroup['items'][number];
export type FollowupField = FollowupCondition['field'];
type Stage = ProcessFollowupPage['items'][number]['stage'];

export const followupFields = [
  ['stage', '跟进状态'], ['severity', '风险'],
  ['responsibleSectionName', '责任板块'], ['ownerName', '负责人'], ['dueAt', '办理期限'],
] as const satisfies ReadonlyArray<readonly [FollowupField, string]>;
export const followupStageGroups = [
  { value: 'ANALYSIS', label: '待处理／分析', stages: ['ANALYSIS'] },
  { value: 'SUBMISSION', label: '待提交', stages: ['SUBMISSION'] },
  { value: 'CLOSURE', label: '待关闭／审核', stages: ['CLOSURE', 'CLOSURE_REVIEW'] },
  { value: 'CLOSED', label: '已关闭／归档', stages: ['CLOSED', 'ARCHIVED'] },
  { value: 'FAILED', label: '流程异常', stages: ['CANCELLED', 'SUSPENDED', 'FAILED', 'COMPLETED'] },
] as const satisfies readonly { value: Stage; label: string; stages: readonly Stage[] }[];
const stageLabels = new Map<Stage, string>(followupStageGroups.flatMap(({ label, stages }) => stages.map(stage => [stage, label] as const)));
export const followupStageLabel = (stage: Stage) => stageLabels.get(stage);
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
  return field === 'stage' ? enumOperators.slice(0, 2) : enumOperators;
}

export function normalizeFollowupFilters(filters: SavedFilters): SavedFilters {
  const group = filters.processFollowupFilters ?? emptyFollowupGroup;
  const items = group.items.flatMap((item): FollowupCondition[] => {
    if (withoutValue(item.operator)) return [{ field: item.field, operator: item.operator }];
    const value = item.value?.trim();
    return value ? [{ ...item, value }] : [];
  });
  const search = filters.search?.trim();
  return { ...(search ? { search } : {}), ...(filters.overdueAt ? { overdueAt: filters.overdueAt } : {}),
    ...(items.length ? { processFollowupFilters: { logic: group.logic, items } } : {}) };
}

export function toServerFollowupFilters(group?: FollowupGroup): FollowupGroup | undefined {
  if (!group) return;
  const { logic, items } = group;
  const stageConditions = items.filter(item => item.field === 'stage');
  if (!stageConditions.length) return group;

  const allStages = [...stageLabels.keys()];
  const tests = stageConditions.map(({ value, operator }) => {
    const stages: readonly Stage[] = followupStageGroups.find(entry => entry.value === value)?.stages ?? [];
    return (stage: Stage) => operator === 'NE' ? !stages.includes(stage) : stages.includes(stage);
  });
  const included = allStages.filter(stage => logic === 'ALL' ? tests.every(test => test(stage)) : tests.some(test => test(stage)));
  const excluded = allStages.filter(stage => !included.includes(stage));
  if (logic === 'ALL' && !included.length) return { logic, items: [{ field: 'stage', operator: 'EMPTY' }] };
  if (logic === 'ANY' && !excluded.length) return;

  const other = items.filter(item => item.field !== 'stage');
  const useEquality = logic === 'ALL' ? included.length === 1 : excluded.length !== 1;
  const stageItems: FollowupCondition[] = (useEquality ? included : excluded).map(value => ({ field: 'stage', operator: useEquality ? 'EQ' : 'NE', value }));
  const combined = [...other, ...stageItems];
  return combined.length ? { logic, items: combined } : undefined;
}

export function followupFilterError(group?: FollowupGroup) {
  const compiled = toServerFollowupFilters(group);
  if (!compiled) return;
  if (compiled.items.length > followupMaxItems) return '当前筛选组合超过条件上限，请减少条件。';
  if (new URLSearchParams({ filters: JSON.stringify(compiled) }).toString().length > 5500) return '筛选内容过长，请缩短文字或减少条件。';
}
