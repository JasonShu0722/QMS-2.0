import { structureReferenceLiveCondition } from '../../src/modules/organization/organization-lifecycle.read-model.js';

describe('administrative history does not become live business use', () => {
  it.each(['user_organization_history', 'administrative_deletions', 'administrative_configuration_links'])('retains %s references without treating them as live', table => {
    expect(structureReferenceLiveCondition(table).sql).toBe('false');
  });
  it('keeps the existing published-workflow live predicate', () => {
    expect(structureReferenceLiveCondition('workflow_versions').sql).toContain("'PUBLISHED'");
  });
});
