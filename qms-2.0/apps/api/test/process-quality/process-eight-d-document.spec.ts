import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import * as policy from '../../src/modules/process-quality/process-eight-d-document.js';
const fileId = '1edc6a4d-87c1-4c6c-948b-ef190ef65df1';
const otherFileId = '9d668705-aee0-48a4-b7b3-8dad3ec57c5a';

function validDocument() {
  return policy.normalizeProcessEightDDocument({
    occurrenceCause: 'Fixture drift', escapeCause: 'Check did not detect drift',
    correctiveActions: ['OCCURRENCE', 'ESCAPE'].map((causeKind, index) => ({
      id: `action-${index}`, causeKind, action: 'Control drift', owner: 'Operator',
      plannedAt: '2026-10-25', verificationMethod: 'Measure output',
      implementationAt: '2026-10-25T08:00:00Z', result: 'Fixture applied',
      beforeState: 'Outside tolerance', afterState: 'Within tolerance', firstBatch: `batch-${index}`,
      followUpBatchCount: 1, verificationRecord: 'Measured output meets the stated standard', effective: true,
    })),
  });
}

function paths(document: ReturnType<typeof validDocument>) {
  return policy.submissionIssues(document).map((issue) => issue.path);
}

describe('process eight-d document policy', () => {
  it('exports the integration surface', () => {
    for (const name of ['emptyProcessEightDDocument', 'normalizeProcessEightDDocument', 'analysisCompletionIssues', 'submissionIssues', 'documentFileIds', 'ProcessEightDDocumentError'] as const) {
      expect(typeof policy[name]).toBe('function');
    }
  });

  it('does not let an unverified occurrence action submit', () => {
    const document = policy.emptyProcessEightDDocument();
    document.correctiveActions.push({
      id: 'occurrence-1', causeKind: 'OCCURRENCE', action: 'Change fixture', owner: 'Operator',
      plannedAt: '2026-10-25', verificationMethod: 'Inspect output', fileIds: [],
      implementationAt: null, result: '', beforeState: '', afterState: '', firstBatch: '',
      followUpBatchCount: null, followUpDuration: '', verificationRecord: '', verificationFileIds: [], effective: null,
    });
    expect(policy.submissionIssues(document).some((issue) => issue.path === 'correctiveActions[0].effective')).toBe(true);
  });

  it('creates independent incomplete drafts with eleven stable standardization rows', () => {
    const draft = policy.emptyProcessEightDDocument();
    expect(policy.normalizeProcessEightDDocument({})).toEqual(draft);
    expect(draft.standardization.map((row) => row.key)).toEqual([
      'DFMEA', 'PFMEA', 'DESIGN_RECORD', 'SPECIAL_CHARACTERISTICS', 'PROCESS_FLOW', 'CONTROL_PLAN',
      'SOP', 'INSPECTION_STANDARD', 'PACKAGING_CONFIRMATION', 'INTERNAL_PROCESS_AUDIT', 'LLR',
    ]);
    expect(draft.standardization.every((row) => row.needsUpdate === null && row.plannedAt === null && row.completedAt === null)).toBe(true);
    draft.standardization[0]!.reason = 'Local change';
    expect(policy.emptyProcessEightDDocument().standardization[0]!.reason).toBe('');
  });

  it('preserves unknown quantities and dates without borrowing screenshot examples', () => {
    const draft = policy.normalizeProcessEightDDocument({
      containment: [{ id: 'stock', group: 'PCBA', location: 'Factory' }],
      temporaryMeasures: [{ id: 'temporary' }],
      correctiveActions: [{ id: 'draft-action', causeKind: 'OCCURRENCE' }],
    });
    expect(draft.containment[0]).toMatchObject({ quantity: null, ngQuantity: null, plannedAt: null });
    expect(draft.temporaryMeasures[0]!.introducedAt).toBeNull();
    expect(draft.correctiveActions[0]).toMatchObject({ plannedAt: null, implementationAt: null, followUpBatchCount: null, effective: null });
  });

  it.each([
    null, [], 'document', 1, { unexpected: true }, { description: null }, { okFileIds: null },
    { okFileIds: ['not-a-uuid'] }, { analysisFileIds: [42] }, { ngFileIds: Array(101).fill(fileId) },
    { description: 'x'.repeat(10001) }, { temporaryMeasures: Array(101).fill({ id: 't' }) },
    { temporaryMeasures: [null] }, { containment: [{ id: 'c', quantity: '' }] },
    { containment: [{ id: 'c', quantity: -1 }] }, { containment: [{ id: 'c', quantity: 0.5 }] },
    { containment: [{ id: 'c', quantity: Number.NaN }] }, { containment: [{ id: 'c', ngQuantity: Infinity }] },
    { containment: [{ id: 'c', quantity: Number.MAX_SAFE_INTEGER + 1 }] },
    { temporaryMeasures: [{ id: 't', introducedAt: '2026-02-30' }] },
    { temporaryMeasures: [{ id: 't', introducedAt: `2026-10-25T08:00:00.${'0'.repeat(1000)}Z` }] },
    { temporaryMeasures: [{ id: 't', introducedAt: '2025-02-29' }] },
    { temporaryMeasures: [{ id: 't', introducedAt: '' }] },
    { temporaryMeasures: [{ id: 't', introducedAt: 'yesterday' }] },
    { temporaryMeasures: [{ id: 't', introducedAt: 1792886400000 }] },
    { temporaryMeasures: [{ id: 't', fileIds: ['bad'] }] },
    { temporaryMeasures: [{ id: 't', unknown: 'not allowed' }] },
    { containment: [{ id: 'same' }, { id: 'same' }] },
    { correctiveActions: [{ id: 'a', causeKind: 'OPTIONAL' }] },
    { correctiveActions: [{ id: 'a', causeKind: 'OCCURRENCE', necessary: false }] },
    { correctiveActions: [{ id: 'a', causeKind: 'OCCURRENCE', effective: 'true' }] },
    { correctiveActions: [{ id: 'a', causeKind: 'OCCURRENCE', verificationFileIds: ['bad'] }] },
    { standardization: [{ id: 's', key: 'CUSTOM', documentName: 'Custom', needsUpdate: 'false' }] },
    JSON.parse('{"__proto__":{"polluted":true}}'),
  ])('rejects malformed boundary input %# with a path-bearing domain error', (input) => {
    try {
      policy.normalizeProcessEightDDocument(input);
      throw new Error('Expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(policy.ProcessEightDDocumentError);
      expect((error as InstanceType<typeof policy.ProcessEightDDocumentError>).issues).toEqual(expect.arrayContaining([
        { path: expect.any(String), message: expect.any(String) },
      ]));
    }
  });

  it('accepts real zero quantities and explicit leap-day dates without coercion', () => {
    const input = { containment: [{ id: 'c', quantity: 0, ngQuantity: 0, plannedAt: '2024-02-29' }] };
    const before = structuredClone(input);
    expect(policy.normalizeProcessEightDDocument(input).containment[0]).toMatchObject(input.containment[0]!);
    expect(input).toEqual(before);
  });

  it.each(['temporaryMeasures', 'containment', 'optionalAffectedContainment', 'correctiveActions', 'horizontalDeployment', 'standardization'] as const)(
    'rejects duplicate ids and unknown row fields in %s', (section) => {
      const row = { id: 'duplicate', causeKind: 'OCCURRENCE', key: 'CUSTOM', documentName: 'Custom' };
      expect(() => policy.normalizeProcessEightDDocument({ [section]: [{ id: row.id }, { id: row.id }] })).toThrow(policy.ProcessEightDDocumentError);
      expect(() => policy.normalizeProcessEightDDocument({ [section]: [{ id: row.id, unknown: true }] })).toThrow(policy.ProcessEightDDocumentError);
    },
  );

  it('rejects class instances, accessors and symbol keys rather than invoking them', () => {
    class ForeignDocument { description = ''; }
    expect(() => policy.normalizeProcessEightDDocument(new ForeignDocument())).toThrow(policy.ProcessEightDDocumentError);
    const input = Object.defineProperty({}, 'description', { get: () => { throw new Error('Must not execute'); } });
    expect(() => policy.normalizeProcessEightDDocument(input)).toThrow(policy.ProcessEightDDocumentError);
    expect(() => policy.normalizeProcessEightDDocument({ [Symbol('unknown')]: '' })).toThrow(policy.ProcessEightDDocumentError);
  });

  it('applies the row limit after restoring missing standardization presets', () => {
    const customRows = (length: number) => Array.from({ length }, (_, index) => ({ id: `custom-${index}`, key: `CUSTOM_${index}`, documentName: 'Custom' }));
    expect(policy.normalizeProcessEightDDocument({ standardization: customRows(89) }).standardization).toHaveLength(100);
    expect(() => policy.normalizeProcessEightDDocument({ standardization: customRows(90) })).toThrow(policy.ProcessEightDDocumentError);
  });

  it('checks summaries and both cause-specific D5 plans without requiring optional D4 or evidence', () => {
    const document = validDocument();
    expect(policy.analysisCompletionIssues(document)).toEqual([]);
    document.occurrenceCause = '  ';
    document.correctiveActions = document.correctiveActions.filter((action) => action.causeKind !== 'ESCAPE');
    expect(policy.analysisCompletionIssues(document).map((issue) => issue.path)).toEqual(expect.arrayContaining(['occurrenceCause', 'correctiveActions']));
  });

  it.each(['action', 'owner', 'plannedAt', 'verificationMethod'] as const)('checks D5 %s on every occurrence and escape action', (field) => {
    const document = validDocument();
    Object.assign(document.correctiveActions[1]!, { [field]: field === 'plannedAt' ? null : '' });
    expect(paths(document)).toContain(`correctiveActions[1].${field}`);
  });

  it('submits verified measures without D3, system cause, OK/NG, D7 updates or closure text', () => {
    expect(policy.submissionIssues(validDocument())).toEqual([]);
  });

  it.each(['implementationAt', 'result', 'beforeState', 'afterState', 'firstBatch', 'verificationRecord', 'effective'] as const)('requires D6 %s per measure', (field) => {
    const document = validDocument();
    Object.assign(document.correctiveActions[1]!, { [field]: field === 'implementationAt' || field === 'effective' ? null : '' });
    expect(paths(document)).toContain(`correctiveActions[1].${field}`);
  });

  it('checks every recorded occurrence/escape measure, including a newly appended unfinished one', () => {
    const document = validDocument();
    document.correctiveActions.push({ ...document.correctiveActions[0]!, id: 'unfinished', effective: false });
    expect(paths(document)).toContain('correctiveActions[2].effective');
  });

  it('accepts follow-up duration instead of batch count, not absence or zero count alone', () => {
    const document = validDocument();
    document.correctiveActions[0]!.followUpBatchCount = null;
    expect(paths(document)).toContain('correctiveActions[0].followUpBatchCount');
    document.correctiveActions[0]!.followUpBatchCount = 0;
    expect(paths(document)).toContain('correctiveActions[0].followUpBatchCount');
    document.correctiveActions[0]!.followUpDuration = 'Observed for two shifts';
    expect(paths(document)).toEqual([]);
  });

  it('accepts verification evidence instead of text but never instead of explicit effectiveness', () => {
    const document = validDocument();
    document.correctiveActions[0]!.verificationRecord = '';
    document.correctiveActions[0]!.verificationFileIds = [fileId];
    expect(paths(document)).toEqual([]);
    document.correctiveActions[0]!.effective = null;
    expect(paths(document)).toContain('correctiveActions[0].effective');
  });

  it('does not turn optional system measures into occurrence/escape submission blockers', () => {
    const document = validDocument();
    document.correctiveActions.push({ ...document.correctiveActions[0]!, id: 'system', causeKind: 'SYSTEM', firstBatch: '', effective: null });
    expect(paths(document)).toEqual([]);
  });

  it('keeps preset names/keys while appending custom standardization rows', () => {
    const document = policy.normalizeProcessEightDDocument({ standardization: [{ id: 'custom', key: 'CUSTOM', documentName: 'Custom work record' }] });
    expect(document.standardization).toHaveLength(12);
    expect(policy.normalizeProcessEightDDocument(document)).toEqual(document);
    expect(() => policy.normalizeProcessEightDDocument({ standardization: [{ ...document.standardization[0]!, documentName: 'Renamed' }] })).toThrow(policy.ProcessEightDDocumentError);
    expect(() => policy.normalizeProcessEightDDocument({ standardization: [document.standardization[0], document.standardization[0]] })).toThrow(policy.ProcessEightDDocumentError);
    expect(() => policy.normalizeProcessEightDDocument({ standardization: [{ id: 'x', key: 'CUSTOM', documentName: 'A' }, { id: 'y', key: 'CUSTOM', documentName: 'B' }] })).toThrow(policy.ProcessEightDDocumentError);
  });

  it('requires completion only for explicitly requested D7 updates, and reasons only for NOT_APPLICABLE', () => {
    const document = validDocument();
    document.standardization[0]!.needsUpdate = true;
    expect(paths(document)).toEqual(expect.arrayContaining(['standardization[0].completedAt', 'standardization[0].status']));
    document.standardization[0]!.completedAt = '2026-10-25';
    document.standardization[0]!.status = 'COMPLETED';
    document.standardization[1]!.needsUpdate = false;
    expect(paths(document)).toEqual([]);
    document.standardization[1]!.status = 'NOT_APPLICABLE';
    expect(paths(document)).toContain('standardization[1].reason');
    document.standardization[1]!.reason = 'Not applicable to this change';
    expect(paths(document)).toEqual([]);
  });

  it('collects each file reference once across all evidence-bearing sections without mutating input', () => {
    const document = validDocument();
    document.okFileIds = [fileId];
    document.ngFileIds = [fileId];
    document.analysisFileIds = [otherFileId];
    document.temporaryMeasures = [{ id: 'temporary', description: '', departmentOwner: '', introducedAt: null, fileIds: [fileId] }];
    document.correctiveActions[0]!.fileIds = [otherFileId];
    document.correctiveActions[0]!.verificationFileIds = [fileId];
    document.horizontalDeployment = [{ id: 'horizontal', scope: '', inspectionResult: '', action: '', owner: '', completion: '', fileIds: [otherFileId] }];
    const before = structuredClone(document);
    expect(policy.documentFileIds(document)).toEqual([fileId, otherFileId]);
    expect(document).toEqual(before);
  });

  describe('whole-document distinct evidence budget', () => {
    const ids = Array.from({ length: 101 }, () => randomUUID());
    const issue = { path: 'fileIds', message: '正文最多关联 100 个不同附件' };
    const extraEvidence = [
      ['NG', { ngFileIds: [ids[100]!] }],
      ['analysis', { analysisFileIds: [ids[100]!] }],
      ['temporary measure', { temporaryMeasures: [{ id: 't', fileIds: [ids[100]!] }] }],
      ['corrective action', { correctiveActions: [{ id: 'a', causeKind: 'SYSTEM', fileIds: [ids[100]!] }] }],
      ['verification', { correctiveActions: [{ id: 'a', causeKind: 'SYSTEM', verificationFileIds: [ids[100]!] }] }],
      ['horizontal deployment', { horizontalDeployment: [{ id: 'h', fileIds: [ids[100]!] }] }],
    ] as const;

    it.each(extraEvidence)('rejects 100 OK plus one distinct %s attachment on save', (_section, extra) => {
      const input = { description: 'private report description', okFileIds: ids.slice(0, 100), ...extra };
      const before = structuredClone(input);
      expect(() => policy.normalizeProcessEightDDocument(input)).toThrow(expect.objectContaining({
        name: 'ProcessEightDDocumentError', message: 'PROCESS_EIGHT_D_DOCUMENT_INVALID', issues: [issue],
      }));
      expect(input).toEqual(before);
    });

    it.each(extraEvidence)('guards historical/direct submission with an extra %s attachment', (_section, extra) => {
      const document = Object.assign(validDocument(), { okFileIds: ids.slice(0, 100) });
      const additional = policy.normalizeProcessEightDDocument(extra);
      if ('correctiveActions' in extra) document.correctiveActions.push(...additional.correctiveActions);
      else Object.assign(document, extra);
      expect(policy.submissionIssues(document)).toEqual([issue]);
    });

    it('counts nested measures, verification and horizontal deployment in one shared budget', () => {
      const document = validDocument();
      document.temporaryMeasures = [{ id: 't', description: '', departmentOwner: '', introducedAt: null, fileIds: ids.slice(0, 50) }];
      document.correctiveActions[0]!.fileIds = ids.slice(50, 75);
      document.correctiveActions[0]!.verificationFileIds = ids.slice(75, 100);
      document.horizontalDeployment = [{ id: 'h', scope: '', inspectionResult: '', action: '', owner: '', completion: '', fileIds: [ids[100]!] }];
      expect(() => policy.normalizeProcessEightDDocument(document)).toThrow(expect.objectContaining({ issues: [issue] }));
      expect(policy.submissionIssues(document)).toEqual([issue]);
    });

    it.each([0, 99, 100])('accepts the %i-file boundary across OK/NG for save and submission', count => {
      const document = validDocument();
      document.okFileIds = ids.slice(0, Math.max(0, count - 1));
      document.ngFileIds = count ? [ids[count - 1]!] : [];
      expect(policy.normalizeProcessEightDDocument(document)).toEqual(document);
      expect(policy.documentFileIds(document)).toHaveLength(count);
      expect(policy.submissionIssues(document)).toEqual([]);
    });

    it('counts the same UUID only once when reused across every evidence section', () => {
      const document = validDocument();
      document.okFileIds = ids.slice(0, 100);
      document.ngFileIds = [ids[0]!]; document.analysisFileIds = [ids[0]!];
      document.temporaryMeasures = [{ id: 't', description: '', departmentOwner: '', introducedAt: null, fileIds: [ids[0]!] }];
      document.correctiveActions[0]!.fileIds = [ids[0]!];
      document.correctiveActions[0]!.verificationFileIds = [ids[0]!];
      document.horizontalDeployment = [{ id: 'h', scope: '', inspectionResult: '', action: '', owner: '', completion: '', fileIds: [ids[0]!] }];
      const before = structuredClone(document);
      expect(policy.normalizeProcessEightDDocument(document)).toEqual(before);
      expect(policy.documentFileIds(document)).toEqual(ids.slice(0, 100));
      expect(policy.submissionIssues(document)).toEqual([]);
      expect(document).toEqual(before);
    });
  });
});
