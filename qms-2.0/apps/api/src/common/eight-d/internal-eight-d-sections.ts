import type { ProcessEightDDocumentDto } from '../../modules/process-quality/process-eight-d-document.dto.js';
import type { ProblemDomainSection } from '../../modules/problem-index/problem-domain-registry.js';

export function internalEightDSections(document: ProcessEightDDocumentDto, domain?: 'process'): ProblemDomainSection[] {
  const fields = (keys: (keyof typeof document)[]) => keys.map(key => ({ key, label: key, value: typeof document[key] === 'string' ? document[key] as string : JSON.stringify(document[key]) ?? null }));
  const rows = (key: string, value: unknown) => [{ key, label: key, value: JSON.stringify(value) }];
  return [
    ...(domain === 'process' ? [
      { key: 'input', title: '问题输入与风险评估', fields: fields(['title', 'riskAssessment']) },
      { key: 'D1', title: 'D1 建立团队', fields: [{ key: 'teamMemberCount', label: '团队成员数', value: String(document.team?.length ?? 0) }] },
    ] : []),
    { key: 'D2', title: 'D2 问题描述', fields: fields(['description', 'okFileIds', 'ngFileIds']) },
    { key: 'D3', title: 'D3 临时措施与围堵', fields: fields(['temporaryMeasures', 'containment', 'optionalAffectedContainment']) },
    { key: 'D4', title: 'D4 原因分析', fields: fields(['analysisProcess', 'analysisFileIds', 'occurrenceCause', 'escapeCause', 'systemCause']) },
    ...(domain === 'process' ? [
      { key: 'D5', title: 'D5 制定永久纠正措施', fields: rows('correctiveActionPlans', document.correctiveActions.map(({ id, causeKind, action, owner, plannedAt, verificationMethod, selectionReason, fileIds }) =>
        ({ id, causeKind, action, owner, plannedAt, verificationMethod, selectionReason, fileIds }))) },
      { key: 'D6', title: 'D6 实施与有效性验证', fields: rows('correctiveActionVerifications', document.correctiveActions.map(({ id, implementationAt, implementer, verifier, result, beforeState, afterState,
        firstBatch, followUpBatchCount, followUpDuration, verificationRecord, verificationFileIds, effective }) =>
        ({ id, implementationAt, implementer, verifier, result, beforeState, afterState, firstBatch, followUpBatchCount, followUpDuration, verificationRecord, verificationFileIds, effective }))) },
    ] : [{ key: 'D5-D6', title: 'D5/D6 对策实施与有效性', fields: fields(['correctiveActions']) }]),
    { key: 'D7', title: 'D7 横向展开与标准化', fields: fields(['horizontalDeployment', 'standardization']) },
    { key: 'D8', title: 'D8 总结', fields: fields(['closureSummary']) },
  ];
}
