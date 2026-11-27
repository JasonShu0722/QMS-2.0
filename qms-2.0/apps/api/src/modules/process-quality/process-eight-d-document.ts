import 'reflect-metadata';
import { validateSync, type ValidationError } from 'class-validator';
import {
  PROCESS_EIGHT_D_MAX_FILES, PROCESS_EIGHT_D_MAX_ROWS, ProcessEightDContainmentDto, ProcessEightDCorrectiveActionDto,
  ProcessEightDDocumentDto, ProcessEightDEffectTrackingDto, ProcessEightDHorizontalDeploymentDto,
  ProcessEightDStandardizationDto, ProcessEightDTeamMemberDto, ProcessEightDTemporaryMeasureDto,
} from './process-eight-d-document.dto.js';

export type ProcessEightDDocument = ProcessEightDDocumentDto;
export interface ProcessEightDDocumentIssue { path: string; message: string }

export class ProcessEightDDocumentError extends Error {
  constructor(public readonly issues: ProcessEightDDocumentIssue[]) {
    super('PROCESS_EIGHT_D_DOCUMENT_INVALID');
    this.name = 'ProcessEightDDocumentError';
  }
}

const standardizationPresets = [
  ['DFMEA', 'DFMEA 设计潜在失效模式和后果分析'],
  ['PFMEA', 'PFMEA 过程潜在失效模式和后果分析'],
  ['DESIGN_RECORD', '设计记录（图纸、技术规格书等）'],
  ['SPECIAL_CHARACTERISTICS', '特殊特性清单'],
  ['PROCESS_FLOW', '过程流程图'],
  ['CONTROL_PLAN', '控制计划'],
  ['SOP', 'SOP 标准作业指导书'],
  ['INSPECTION_STANDARD', '检验基准书'],
  ['PACKAGING_CONFIRMATION', '包装确认单'],
  ['INTERNAL_PROCESS_AUDIT', '内部过程审核检查表'],
  ['LLR', '经验总结报告（LLR）'],
] as const;

const rowTypes = {
  team: ProcessEightDTeamMemberDto,
  temporaryMeasures: ProcessEightDTemporaryMeasureDto,
  containment: ProcessEightDContainmentDto,
  optionalAffectedContainment: ProcessEightDContainmentDto,
  correctiveActions: ProcessEightDCorrectiveActionDto,
  horizontalDeployment: ProcessEightDHorizontalDeploymentDto,
  standardization: ProcessEightDStandardizationDto,
} as const;

function reject(path: string, message: string): never {
  throw new ProcessEightDDocumentError([{ path, message }]);
}

function readObject<T extends object>(input: unknown, type: new () => T, path: string): T {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return reject(path, '必须为正文对象');
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== type.prototype && prototype !== null && Object.getPrototypeOf(prototype) !== null) reject(path, '必须为普通正文对象');
  const result = new type();
  for (const key of Reflect.ownKeys(input)) {
    const location = path ? `${path}.${String(key)}` : String(key);
    if (typeof key !== 'string' || !Object.hasOwn(result, key)) reject(location, '未知字段');
    const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
    if (!Object.hasOwn(descriptor, 'value')) reject(location, '不接受访问器字段');
    Object.assign(result, { [key]: descriptor.value });
  }
  return result;
}

function validationIssues(errors: ValidationError[], parent = ''): ProcessEightDDocumentIssue[] {
  return errors.flatMap((error) => {
    const path = /^\d+$/.test(error.property)
      ? `${parent}[${error.property}]` : parent ? `${parent}.${error.property}` : error.property;
    return [
      ...Object.values(error.constraints ?? {}).map((message) => ({ path, message })),
      ...validationIssues(error.children ?? [], path),
    ];
  });
}

function evidenceLimitIssues(document: ProcessEightDDocument): ProcessEightDDocumentIssue[] {
  return documentFileIds(document).length > PROCESS_EIGHT_D_MAX_FILES
    ? [{ path: 'fileIds', message: `正文最多关联 ${PROCESS_EIGHT_D_MAX_FILES} 个不同附件` }] : [];
}

export function emptyProcessEightDDocument(): ProcessEightDDocument {
  return normalizeProcessEightDDocument({ horizontalDeployment: [{ id: 'horizontal-default' }] });
}

export function normalizeProcessEightDDocument(input: unknown): ProcessEightDDocument {
  const document = readObject(input, ProcessEightDDocumentDto, '');
  if (!Object.hasOwn(input as object, 'standardization')) {
    document.standardization = standardizationPresets.map(([key, documentName]) =>
      Object.assign(new ProcessEightDStandardizationDto(), { id: key, key, documentName }));
  }
  if (document.effectTracking !== undefined) {
    document.effectTracking = readObject(document.effectTracking, ProcessEightDEffectTrackingDto, 'effectTracking');
  }
  for (const key of Object.keys(rowTypes) as (keyof typeof rowTypes)[]) {
    const rows = document[key] as unknown[] | undefined;
    if (key === 'team' && rows === undefined) continue;
    if (!Array.isArray(rows) || rows.length > PROCESS_EIGHT_D_MAX_ROWS) reject(key, `必须为不超过 ${PROCESS_EIGHT_D_MAX_ROWS} 行的数组`);
    const type: new () => { id: string } = rowTypes[key];
    const normalized = Array.from(rows, (row, index) => readObject(row, type, `${key}[${index}]`));
    const seen = new Set<string>();
    for (const [index, row] of normalized.entries()) {
      if (seen.has(row.id)) reject(`${key}[${index}].id`, '行 id 不得重复');
      seen.add(row.id);
    }
    Object.assign(document, { [key]: normalized });
  }
  const issues = validationIssues(validateSync(document, { whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true }));
  if (issues.length) throw new ProcessEightDDocumentError(issues);
  const leaders = (document.team ?? []).flatMap((member, index) => member.isLeader === true ? [index] : []);
  if (leaders.length > 1) reject(`team[${leaders[1]}].isLeader`, '只能指定一名组长');
  const evidenceIssues = evidenceLimitIssues(document);
  if (evidenceIssues.length) throw new ProcessEightDDocumentError(evidenceIssues);

  const seenKeys = new Set<string>();
  for (const [index, row] of document.standardization.entries()) {
    if (seenKeys.has(row.key)) reject(`standardization[${index}].key`, '标准化 key 不得重复');
    seenKeys.add(row.key);
    const preset = standardizationPresets.find(([key]) => key === row.key);
    if (preset && row.documentName !== preset[1]) reject(`standardization[${index}].documentName`, '预置文件名称不得改写');
  }
  for (const [key] of standardizationPresets) {
    if (!seenKeys.has(key) && document.standardization.some(row => row.id === key)) reject('standardization', '新增行 id 不得占用预置 id');
  }
  return structuredClone(document);
}

export function analysisCompletionIssues(document: ProcessEightDDocument): ProcessEightDDocumentIssue[] {
  const issues: ProcessEightDDocumentIssue[] = [];
  for (const field of ['occurrenceCause', 'escapeCause'] as const) {
    if (!document[field].trim()) issues.push({ path: field, message: '请填写原因总结' });
  }
  for (const kind of ['OCCURRENCE', 'ESCAPE'] as const) {
    if (!document.correctiveActions.some((row) => row.causeKind === kind)) {
      issues.push({ path: 'correctiveActions', message: `请填写 ${kind === 'OCCURRENCE' ? '发生因' : '流出因'} 对策计划` });
    }
  }
  document.correctiveActions.forEach((row, index) => {
    if (row.causeKind === 'SYSTEM') return;
    for (const field of ['action', 'owner', 'plannedAt'] as const) {
      if (!row[field]?.trim()) issues.push({ path: `correctiveActions[${index}].${field}`, message: '请完善对策计划' });
    }
  });
  return issues;
}

export function submissionIssues(document: ProcessEightDDocument, deadlines?: { analysisCompletedAt: Date | null; submissionDueAt: Date | null },
  availableIds?: ReadonlySet<string>): ProcessEightDDocumentIssue[] {
  const issues = [...evidenceLimitIssues(document), ...analysisCompletionIssues(document)];
  document.correctiveActions.forEach((row, index) => {
    if (row.causeKind === 'SYSTEM') return;
    for (const field of ['implementationAt', 'result', 'beforeState', 'afterState', 'firstBatch'] as const) {
      if (!row[field]?.trim()) issues.push({ path: `correctiveActions[${index}].${field}`, message: '请填写实际实施及验证记录' });
    }
    if (!(row.followUpBatchCount !== null && row.followUpBatchCount > 0) && !row.followUpDuration.trim()) {
      issues.push({ path: `correctiveActions[${index}].followUpBatchCount`, message: '请填写实际跟进批数或时长' });
    }
    if (!row.verificationRecord.trim() && row.verificationFileIds.length === 0) {
      issues.push({ path: `correctiveActions[${index}].verificationRecord`, message: '请填写验证记录或提供受控验证文件' });
    }
    if (row.effective !== true) issues.push({ path: `correctiveActions[${index}].effective`, message: '必须人工明确确认措施验证有效' });
  });
  document.standardization.forEach((row, index) => {
    if (row.needsUpdate === true) {
      if (!row.completedAt) issues.push({ path: `standardization[${index}].completedAt`, message: '需要更新的项目须记录实际完成日期' });
      if (row.status !== 'COMPLETED') issues.push({ path: `standardization[${index}].status`, message: '需要更新的项目尚未完成' });
    }
  });
  const d7 = completedD7EvidenceIssues(document, availableIds);
  if (deadlines && (!deadlines.analysisCompletedAt || !deadlines.submissionDueAt)) {
    issues.push({ path: 'analysisCompletedAt', message: '需由负责人先确认分析完成并明确完整提交计划' });
  }
  if (availableIds && !d7.length && documentFileIds(document).some(id => !availableIds.has(id))) {
    issues.push({ path: 'fileIds', message: '正文关联的附件须通过安全扫描且可用' });
  }
  return [...issues, ...d7];
}

export function completedD7EvidenceIssues(document: ProcessEightDDocument, availableIds?: ReadonlySet<string>, previous?: ProcessEightDDocument): ProcessEightDDocumentIssue[] {
  const message = '已完成的项目须关联本行通过安全扫描的附件';
  return [
    ...d7EvidenceReferenceIssues(document),
    ...completedD7EvidenceRows(document, previous).filter(row => !row.fileIds.some(id => !availableIds || availableIds.has(id)))
      .map(row => ({ path: row.path, message })),
  ];
}

function d7EvidenceReferenceIssues(document: ProcessEightDDocument): ProcessEightDDocumentIssue[] {
  const references = new Map<string, string>();
  const conflicts = new Set<string>();
  for (const { path, fileIds } of d7EvidenceRows(document)) {
    for (const fileId of fileIds) {
      const id = fileId.toLowerCase();
      const firstPath = references.get(id);
      if (firstPath === undefined) references.set(id, path);
      else if (firstPath !== path) {
        conflicts.add(firstPath);
        conflicts.add(path);
      }
    }
  }
  return [...conflicts].map(path => ({ path, message: '同一附件不得跨 D7 行复用' }));
}

function d7EvidenceRows(document: ProcessEightDDocument) {
  return [
    ...document.horizontalDeployment.map((row, index) => ({ key: `horizontalDeployment:${row.id}`,
      path: `horizontalDeployment[${index}].fileIds`, fileIds: row.fileIds, completed: row.completed === true })),
    ...document.standardization.map((row, index) => ({ key: `standardization:${row.id}`,
      path: `standardization[${index}].fileIds`, fileIds: row.fileIds ?? [], completed: row.status === 'COMPLETED' })),
  ];
}

export function completedD7EvidenceRows(document: ProcessEightDDocument, previous?: ProcessEightDDocument) {
  const completedRows = (edition: ProcessEightDDocument) => d7EvidenceRows(edition)
    .filter(row => row.completed).map(({ key, path, fileIds }) => ({ key, path, fileIds }));
  const rows = completedRows(document);
  if (!previous) return rows;
  const previousFiles = new Map(completedRows(previous).map(row => [row.key, new Set(row.fileIds)]));
  return rows.filter(row => {
    const before = previousFiles.get(row.key);
    return !before || before.size !== row.fileIds.length || row.fileIds.some(id => !before.has(id));
  });
}

export function documentFileIds(document: ProcessEightDDocument): string[] {
  return [...new Set([
    ...document.okFileIds, ...document.ngFileIds, ...document.analysisFileIds,
    ...document.temporaryMeasures.flatMap((row) => row.fileIds),
    ...document.correctiveActions.flatMap((row) => [...row.fileIds, ...row.verificationFileIds]),
    ...document.horizontalDeployment.flatMap((row) => row.fileIds),
    ...document.standardization.flatMap((row) => row.fileIds ?? []),
  ])];
}
