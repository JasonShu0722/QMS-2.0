import { emptyProcessEightDDocument } from '../../src/modules/process-quality/process-eight-d-document.js';
import type { ProcessEightDControlledReportDto } from '../../src/modules/process-quality/process-eight-d-report.dto.js';

export const imageId = '10000000-0000-4000-8000-000000000001';
export const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64');

export function sampleReport(): ProcessEightDControlledReportDto {
  const document = emptyProcessEightDDocument();
  document.description = '压装开裂，中文过程问题与多来源追溯';
  document.okFileIds = [imageId];
  document.analysisProcess = '先还原生产过程，再进行原因分析';
  document.occurrenceCause = '压装间隙不合适';
  document.escapeCause = '检验方法不充分';
  document.closureSummary = '关闭总结，未伪造批准';
  document.temporaryMeasures = Array.from({ length: 80 }, (_, index) => ({
    id: `row-${index}`, description: `围堵长表第${index + 1}行：复核工位与在制品，保留真实处置说明。`,
    departmentOwner: '质量科 张工', introducedAt: '2026-10-25', fileIds: [],
  }));
  document.correctiveActions = [{ id: 'action-1', causeKind: 'OCCURRENCE', action: '修正工装', owner: '李工', plannedAt: '2026-10-25',
    verificationMethod: '测量并跟踪', fileIds: [], implementationAt: '2026-10-25', result: '已实施', beforeState: '改善前有裂纹',
    afterState: '改善后无裂纹', firstBatch: '首批B-001', followUpBatchCount: 3, followUpDuration: '', verificationRecord: '三批实测',
    verificationFileIds: [], effective: true }];
  return {
    problemId: '20000000-0000-4000-8000-000000000002', reportNumber: '8D-2026-001', view: 'CURRENT', revisionId: null,
    label: '草稿（未批准）', status: 'DRAFT', contentVersion: 4, rowVersion: 7, generatedAt: '2026-10-25T08:00:00.000Z',
    snapshot: { document, problem: { reportNumber: '8D-2026-001', severity: 'HIGH', createdAt: '2026-10-24T08:00:00.000Z', closedAt: null },
      instance: { status: 'RUNNING' }, contentVersion: 4, rowVersion: 7, ownerUserId: 'owner', professionalUserId: 'professional',
      responsibleSectionDepartmentId: 'section', collaboratorUserIds: [], analysisCompletedAt: null, submittedAt: null,
      deadlines: { analysisDueAt: '2026-10-26', submissionDueAt: null, closureDueAt: '2026-10-30' },
      sources: [{ sourceDomain: 'process-quality', sourceType: 'process-defect', sourceId: 'source-1', sourceVersion: 2, sourceSnapshot: { description: '第一来源', operationCode: 'OP10', materials: [{ materialCode: 'M-01', materialName: '壳体', materialBatch: 'B01', sqeUserId: 'SQE-1' }] } },
        { sourceDomain: 'process-quality', sourceType: 'process-defect', sourceId: 'source-2', sourceVersion: 5, sourceSnapshot: { description: '第二来源', traceCode: 'TRACE-02', defectQuantity: null } }],
      approvalRounds: [{ roundNumber: 1, status: 'CANCELLED', contentVersion: 3, duties: [{ duty: 'PROFESSIONAL', status: 'APPROVED', decidedBy: 'old-reviewer', decidedAt: '2026-10-24T08:00:00Z' }] },
        { roundNumber: 2, status: 'PENDING', contentVersion: 4, duties: [{ duty: 'MANAGEMENT', status: 'SKIPPED_SAME_PERSON', userId: 'owner', decidedBy: null, decidedAt: null }] }],
    }, attachments: [{ id: imageId, originalName: 'OK对照.png', contentType: 'image/png', sizeBytes: png.length, sha256: 'a'.repeat(64),
      objectVersionId: 'object-v1', version: 2, uses: ['D2 OK'], rendering: 'EMBEDDED', note: '按章节嵌入；原文件请使用授权下载' }],
  };
}
