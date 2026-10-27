import type { ProcessEightDDocumentDto } from '../../modules/process-quality/process-eight-d-document.dto.js';
import type { ProblemDomainSection } from '../../modules/problem-index/problem-domain-registry.js';

export function internalEightDSections(document: ProcessEightDDocumentDto): ProblemDomainSection[] {
  const fields = (keys: (keyof typeof document)[]) => keys.map(key => ({ key, label: key, value: typeof document[key] === 'string' ? document[key] as string : JSON.stringify(document[key]) }));
  return [
    { key: 'D2', title: 'D2 问题描述', fields: fields(['description', 'okFileIds', 'ngFileIds']) },
    { key: 'D3', title: 'D3 临时措施与围堵', fields: fields(['temporaryMeasures', 'containment', 'optionalAffectedContainment']) },
    { key: 'D4', title: 'D4 原因分析', fields: fields(['analysisProcess', 'analysisFileIds', 'occurrenceCause', 'escapeCause', 'systemCause']) },
    { key: 'D5-D6', title: 'D5/D6 对策实施与有效性', fields: fields(['correctiveActions']) },
    { key: 'D7', title: 'D7 横向展开与标准化', fields: fields(['horizontalDeployment', 'standardization']) },
    { key: 'D8', title: 'D8 总结', fields: fields(['closureSummary']) },
  ];
}
