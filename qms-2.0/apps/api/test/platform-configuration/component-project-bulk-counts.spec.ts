import { buildComponentProjectBulkPreview } from '../../src/modules/platform-configuration/component-project-bulk.service.js';

describe('component bulk preview actual impact', () => {
  const project = (id: string) => ({ id, organizationId: 'organization', code: id, name: id,
    stage: 'NEW_PRODUCT' as const, status: 'ACTIVE' as const, version: 1,
    customerEngineerAssignmentId: null, projectEngineerAssignmentId: null });
  const mapping = (id: string, category: string, projectRecordId = 'project') => ({ id,
    organizationId: 'organization', componentCode: id, componentName: id, projectRecordId,
    productCategory: category, productSubcategory: null, status: 'ACTIVE' as const, version: 1 });

  it('distinguishes selected rows from rows actually changed by component fields', () => {
    const a = mapping('a', 'Body');
    const b = mapping('b', 'Drive');
    const selected = [a, b];
    const selection = selected.map(({ id, version }) => ({ id, expectedVersion: version }));
    expect(buildComponentProjectBulkPreview('organization', { selection, changes: { productCategory: 'Body' } }, selected, [project('project')], selected))
      .toMatchObject({ selectedCount: 2, affectedMappingsCount: 1 });
    const identical = [a, mapping('b', 'Body')];
    expect(buildComponentProjectBulkPreview('organization', { selection, changes: { productCategory: 'Body' } }, identical, [project('project')], identical))
      .toMatchObject({ selectedCount: 2, affectedMappingsCount: 0 });
  });

  it('unions component changes with shared project changes without double counting siblings', () => {
    const selected = [mapping('a', 'Body'), mapping('b', 'Drive')];
    const selection = selected.map(({ id, version }) => ({ id, expectedVersion: version }));
    const sibling = mapping('sibling', 'Body');
    const members = [...selected, sibling, mapping('unrelated', 'Body', 'other')];
    expect(buildComponentProjectBulkPreview('organization', { selection, changes: { stage: 'MASS_PRODUCTION', productCategory: 'Body' } }, selected, [project('project'), project('other')], members))
      .toMatchObject({ selectedCount: 2, affectedMappingsCount: 3 });
  });

  it('counts reassigned selections and target siblings, not untouched members of the former project', () => {
    const selected = [mapping('a', 'Body'), mapping('b', 'Drive')];
    const selection = selected.map(({ id, version }) => ({ id, expectedVersion: version }));
    const members = [...selected, mapping('former-sibling', 'Body'), mapping('target-sibling', 'Body', 'target')];
    expect(buildComponentProjectBulkPreview('organization', { selection, changes: { projectRecordId: 'target', stage: 'MASS_PRODUCTION' } }, selected, [project('project'), project('target')], members))
      .toMatchObject({ selectedCount: 2, affectedMappingsCount: 3 });
  });
});
