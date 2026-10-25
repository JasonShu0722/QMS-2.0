import { describe, expect, it } from '@jest/globals';
import { isClosureReviewNode } from '../../src/modules/workflow/workflow-runtime-policy.js';

describe('legacy runtime closure gate boundary', () => {
  it.each([undefined, null, {}, { assignment: { permission: 'workflow:act' } }])('keeps old node configuration unchanged: %p', (config: unknown) => {
    expect(isClosureReviewNode({ config })).toBe(false);
  });
  it.each([null, false, {}, { schemaVersion: 1, policy: 'INTERNAL', domainCode: 'process' }, { schemaVersion: 999 }])('fails closed for every declared closure gate, including corrupted config: %p', (closureReview: unknown) => {
    expect(isClosureReviewNode({ config: { closureReview } })).toBe(true);
  });
});
