import { validateEightDContent } from '../../src/modules/customer-quality/customer-complaint-8d.rules.js';

const complete = { what: '什么', why: '原因', where: '产线', when: '2026-09-01', who: '班组', how: '方法', howMuch: '100件', containment: '隔离', rootCause: '根因', verification: '验证', preventiveAction: '预防', horizontalDeployment: '水平展开', lessonsLearned: '经验', verificationEvidenceFileIds: ['11111111-1111-4111-8111-111111111111'], archiveChecklist: ['SOURCE_CONFIRMED', 'CONTAINMENT_VERIFIED', 'ROOT_CAUSE_VERIFIED', 'PREVENTION_DEPLOYED', 'HORIZONTAL_DEPLOYMENT_RECORDED', 'EVIDENCE_COMPLETE'] };

it('allows partial drafts and requires evidence and archive checks on submit', () => {
  expect(validateEightDContent({ ...complete, rootCause: '' }, 'DRAFT').rootCause).toBe('');
  expect(() => validateEightDContent({ ...complete, verificationEvidenceFileIds: [] }, 'SUBMIT')).toThrow('CUSTOMER_8D_SUBMISSION_INCOMPLETE');
  expect(() => validateEightDContent({ ...complete, rootCause: '' }, 'SUBMIT')).toThrow('CUSTOMER_8D_SUBMISSION_INCOMPLETE');
  expect(validateEightDContent(complete, 'SUBMIT').horizontalDeployment).toBe('水平展开');
});
