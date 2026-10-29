import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../src/modules/organization/organization-force-delete.service.ts', import.meta.url), 'utf8');

describe('organization lifecycle uses the identity-owned transaction read model', () => {
  it('does not query identity-owned user rows directly', () => {
    expect(source).not.toMatch(/\b(?:tx|transaction)\.user\b/);
  });

  it('does not acquire user row locks through private identity SQL', () => {
    expect(source).not.toMatch(/\bFROM\s+users\b/i);
  });

  it('delegates the snapshot and ordered locks through the same caller transaction', () => {
    expect(source).toContain("from '../identity/administrative-identity-read-model.js'");
    expect(source).toMatch(/this\.identity\.lifecycleUsers\(tx,/);
    expect(source).toMatch(/this\.identity\.lockLifecycleUsers\(tx,/);
  });
});
