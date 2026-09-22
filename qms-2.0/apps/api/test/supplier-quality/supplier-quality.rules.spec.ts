import {
  assertEvidenceReferences,
  assertInternalClosure,
  assertReplyActor,
  assertResourceScope,
  mergeBriefContent,
  validateProblemFacts,
  validateResponseContent,
} from '../../src/modules/supplier-quality/supplier-quality.rules.js';
import { availableEvidence, internalActor, problemFacts, problemResource, supplierActor, supplierIds } from './fixtures.js';

describe('supplier problem facts', () => {
  it('accepts an explicitly selected brief for a high severity problem without forcing 8D', () => {
    expect(validateProblemFacts(problemFacts()).responseForm).toBe('BRIEF');
  });

  it('trims text without mutating the original form', () => {
    const facts = { ...problemFacts(), materialCode: ' MAT-001 ' };
    expect(validateProblemFacts(facts).materialCode).toBe('MAT-001');
    expect(facts.materialCode).toBe(' MAT-001 ');
  });

  it.each([
    ['supplierOrganizationId', undefined], ['supplierOrganizationId', [supplierIds.supplier, supplierIds.otherSupplier]],
    ['supplierOrganizationId', 'not-a-uuid'], ['title', '   '], ['title', 'x'.repeat(501)],
    ['materialCode', ''], ['materialCode', 'x'.repeat(101)], ['defectDescription', '\n'],
    ['defectDescription', 'x'.repeat(10001)], ['defectQuantity', 0], ['defectQuantity', -1],
    ['defectQuantity', 1.5], ['defectQuantity', Number.NaN], ['defectQuantity', Number.MAX_SAFE_INTEGER + 1],
    ['severity', 'URGENT'], ['responseForm', undefined], ['responseForm', 'AUTO'],
    ['materialCategory', 'unknown'], ['replyMode', 'AUTO'],
  ])('rejects invalid %s value %s', (field, value) => {
    expect(() => validateProblemFacts({ ...problemFacts(), [field]: value })).toThrow(expect.objectContaining({
      code: 'SUPPLIER_FACTS_INVALID', fields: expect.objectContaining({ [field]: expect.any(String) }),
    }));
  });

  it('allows optional material category as the legacy API did', () => {
    const { materialCategory: _category, ...facts } = problemFacts();
    expect(validateProblemFacts(facts).materialCategory).toBeUndefined();
  });

  it('requires exactly an internal assignee for internal replies', () => {
    expect(() => validateProblemFacts({ ...problemFacts(), replyMode: 'INTERNAL' })).toThrow();
    expect(validateProblemFacts({ ...problemFacts(), replyMode: 'INTERNAL', internalResponderId: supplierIds.engineer }).internalResponderId).toBe(supplierIds.engineer);
    expect(() => validateProblemFacts({ ...problemFacts(), internalResponderId: supplierIds.engineer })).toThrow();
  });

  it('rejects caller-supplied status, verifier and deadline fields', () => {
    for (const field of ['status', 'verifiedById', 'dueAt', 'ownerOrganizationId']) {
      expect(() => validateProblemFacts({ ...problemFacts(), [field]: 'injected' })).toThrow();
    }
  });
});

describe('supplier resource boundaries, after platform feature authorization', () => {
  it('allows an internal actor in an already authorized owner scope', () => {
    expect(() => assertResourceScope(internalActor(), problemResource(), supplierIds.owner)).not.toThrow();
  });

  it('rejects a scope that does not own the resource', () => {
    expect(() => assertResourceScope(internalActor(), problemResource(), supplierIds.otherOwner)).toThrow();
  });

  it('allows the related supplier after release and rejects a different enterprise', () => {
    expect(() => assertResourceScope(supplierActor(), problemResource())).not.toThrow();
    expect(() => assertResourceScope({ ...supplierActor(), organizationId: supplierIds.otherSupplier }, problemResource())).toThrow();
  });

  it('cannot use an internal scope argument to expand supplier access', () => {
    expect(() => assertResourceScope({ ...supplierActor(), organizationId: supplierIds.otherSupplier }, problemResource(), supplierIds.owner)).toThrow();
  });

  it('hides unreleased and internally handled problems from suppliers', () => {
    expect(() => assertResourceScope(supplierActor(), { ...problemResource(), releasedToSupplier: false })).toThrow();
    expect(() => assertResourceScope(supplierActor(), { ...problemResource(), replyMode: 'INTERNAL', internalResponderId: supplierIds.engineer })).toThrow();
  });

  it('allows only the nominated person to reply internally', () => {
    const resource = { ...problemResource(), replyMode: 'INTERNAL' as const, internalResponderId: supplierIds.engineer };
    expect(() => assertReplyActor(internalActor(), resource, supplierIds.owner)).not.toThrow();
    expect(() => assertReplyActor({ ...internalActor(), id: supplierIds.verifier }, resource, supplierIds.owner)).toThrow();
    expect(() => assertReplyActor(supplierActor(), resource)).toThrow();
  });

  it('lets the supplier reply to an external problem but rejects internal impersonation', () => {
    expect(() => assertReplyActor(supplierActor(), problemResource())).not.toThrow();
    expect(() => assertReplyActor(internalActor(), problemResource(), supplierIds.owner)).toThrow();
  });
});

describe('internal verification and closure separation', () => {
  const verification = { verifierId: supplierIds.verifier, problemId: supplierIds.problem, contentVersion: 2, accepted: true };

  it('allows another internal person to close a verified current revision', () => {
    expect(() => assertInternalClosure(internalActor(), problemResource(), verification, supplierIds.owner)).not.toThrow();
  });

  it.each([
    null,
    { ...verification, accepted: false },
    { ...verification, verifierId: supplierIds.engineer },
    { ...verification, verifierId: '' },
    { ...verification, contentVersion: 1 },
    { ...verification, problemId: supplierIds.otherOwner },
  ])('rejects absent, rejected, self, stale or unrelated verification: %j', (invalid) => {
    expect(() => assertInternalClosure(internalActor(), problemResource(), invalid, supplierIds.owner)).toThrow();
  });

  it('rejects supplier closure even after a successful verification', () => {
    expect(() => assertInternalClosure(supplierActor(), problemResource(), verification)).toThrow();
  });
});

describe('evidence references from the authorized platform file service', () => {
  it('accepts available evidence owned by the related supplier or internal owner', () => {
    for (const organizationId of [supplierIds.owner, supplierIds.supplier]) {
      expect(() => assertEvidenceReferences(problemResource(), [supplierIds.file], [{ ...availableEvidence(), organizationId }])).not.toThrow();
    }
  });

  it.each([
    { status: 'QUARANTINED' }, { status: 'DELETED' }, { resourceType: 'other-domain' },
    { resourceId: supplierIds.otherOwner }, { organizationId: supplierIds.otherSupplier },
  ])('rejects unsafe state or foreign resource %j', (changes) => {
    expect(() => assertEvidenceReferences(problemResource(), [supplierIds.file], [{ ...availableEvidence(), ...changes }])).toThrow();
  });

  it('rejects missing and duplicate file references', () => {
    expect(() => assertEvidenceReferences(problemResource(), [supplierIds.file], [])).toThrow();
    expect(() => assertEvidenceReferences(problemResource(), [supplierIds.file, supplierIds.file], [availableEvidence()])).toThrow();
    expect(() => assertEvidenceReferences(problemResource(), [supplierIds.file], [availableEvidence(), availableEvidence()])).toThrow();
  });

  it('does not invent a mandatory evidence count', () => {
    expect(() => assertEvidenceReferences(problemResource(), [], [])).not.toThrow();
  });
});

describe('brief content mapping for a platform-managed upgrade', () => {
  it('fills only absent common content and preserves explicit manual edits', () => {
    const brief = { rootCause: '原因', containmentAction: '隔离', correctiveAction: '替换' };
    const existing = { rootCause: '人工修改', containmentAction: '', preventiveAction: '防再发' };
    expect(mergeBriefContent(brief, existing)).toEqual({ ...existing, correctiveAction: '替换' });
    expect(brief.rootCause).toBe('原因');
    expect(existing).not.toHaveProperty('correctiveAction');
  });

  it('keeps optional professional fields already entered in the brief', () => {
    const brief = { problemDescription: '已补充描述', interimAction: '临时措施', preventiveAction: '防再发措施', verificationResult: '供应商自验' };
    expect(mergeBriefContent(brief, {})).toEqual(brief);
  });
});

describe('supplier response content', () => {
  const brief = { rootCause: '来料防护不足', correctiveAction: '更换包装', completionTime: '2026-09-19T08:00:00Z' };
  const eightD = { ...brief, problemDescription: '端子表面氧化', containmentAction: '隔离库存', interimAction: '全检', preventiveAction: '更新作业标准', verificationResult: '连续三批未发现复发' };

  it('allows incomplete drafts and returns normalized content without changing the form', () => {
    const draft = { rootCause: ' 初步原因 ' };
    expect(validateResponseContent('BRIEF', draft, 'DRAFT')).toEqual({ rootCause: '初步原因' });
    expect(draft.rootCause).toBe(' 初步原因 ');
    expect(validateResponseContent('EIGHT_D', {}, 'DRAFT')).toEqual({});
  });

  it('requires brief root cause, corrective action and an explicit completion timestamp', () => {
    expect(validateResponseContent('BRIEF', brief, 'SUBMIT')).toEqual(brief);
    for (const field of ['rootCause', 'correctiveAction', 'completionTime']) {
      expect(() => validateResponseContent('BRIEF', { ...brief, [field]: '' }, 'SUBMIT')).toThrow();
    }
  });

  it('requires the full professional content when submitting the final 8D response', () => {
    expect(validateResponseContent('EIGHT_D', eightD, 'SUBMIT')).toEqual(eightD);
    for (const field of ['problemDescription', 'containmentAction', 'interimAction', 'rootCause', 'correctiveAction', 'preventiveAction', 'verificationResult']) {
      expect(() => validateResponseContent('EIGHT_D', { ...eightD, [field]: '' }, 'SUBMIT')).toThrow();
    }
  });

  it.each(['2026-02-30T08:00:00Z', '2026-09-19', '2026-09-19T08:00:00', 'not-a-date'])('rejects invalid or timezone-free completion %s', (completionTime) => {
    expect(() => validateResponseContent('BRIEF', { ...brief, completionTime }, 'SUBMIT')).toThrow();
  });

  it('rejects a response that tries to supply internal verification, state or inline uploads', () => {
    for (const field of ['accepted', 'verifierId', 'status', 'evidenceFiles']) {
      expect(() => validateResponseContent('BRIEF', { ...brief, [field]: 'injected' }, 'SUBMIT')).toThrow();
    }
    expect(() => validateResponseContent('EIGHT_D', { rootCause: 'x'.repeat(10001) }, 'DRAFT')).toThrow();
    expect(() => validateResponseContent('BRIEF', { rootCause: 123 }, 'DRAFT')).toThrow();
  });

  it('rejects prototype-like and inherited fields instead of silently accepting them', () => {
    expect(() => validateProblemFacts(JSON.parse(JSON.stringify(problemFacts()).replace(/}$/, ',"__proto__":"invalid"}')))).toThrow();
    expect(() => validateResponseContent('BRIEF', JSON.parse('{"__proto__":"invalid"}'), 'DRAFT')).toThrow();
    expect(() => validateResponseContent('BRIEF', Object.create(brief), 'SUBMIT')).toThrow();
  });
});
