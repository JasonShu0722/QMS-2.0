import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { buildComponentProjectBulkPreview } from '../../src/modules/platform-configuration/component-project-bulk.service.js';
import type { ComponentProjectRecordDto, ComponentProjectMappingDto } from '../../src/modules/platform-configuration/component-project.dto.js';
import type { ComponentProjectBulkChangesDto } from '../../src/modules/platform-configuration/component-project-bulk.dto.js';

const org = randomUUID();
const audit = { organizationId: org, status: 'ACTIVE' as const, version: 1, createdByUserId: randomUUID(), updatedByUserId: randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
const project = (id = randomUUID()): ComponentProjectRecordDto => ({ ...audit, id, code: id, name: 'Project', stage: 'NEW_PRODUCT', customerEngineerAssignmentId: null, projectEngineerAssignmentId: null });
const mapping = (projectRecordId: string | null): ComponentProjectMappingDto => ({ ...audit, id: randomUUID(), componentCode: randomUUID(), componentName: 'Component', projectRecordId, productCategory: 'Drive', productSubcategory: 'Shaft' });

describe('bulk shared-project preview policy (no PostgreSQL claim)', () => {
  it('exposes unselected shared components, edits the project once, and never copies stage onto mappings', () => {
    const p = project();
    const maps = [mapping(p.id), mapping(p.id), mapping(p.id)];
    const selection = maps.slice(0, 2).map(({ id, version }) => ({ id, expectedVersion: version }));
    const result = buildComponentProjectBulkPreview(org, { selection, changes: { stage: 'MASS_PRODUCTION' } }, maps.slice(0, 2), [p], maps);
    expect(result).toMatchObject({ selectedCount: 2, affectedMappingsCount: 3, affectedProjects: [{ id: p.id, version: 1, stage: 'NEW_PRODUCT', selectedComponentCount: 2, totalComponentCount: 3, otherComponentCount: 1 }] });
    expect(result.previewToken).toMatch(/^[a-f0-9]{64}$/);
    expect(maps.every((m) => !('stage' in m))).toBe(true);
  });

  it('previews the final target including incoming selections, without modifying the source project', () => {
    const source = project();
    const target = project();
    const selected = mapping(source.id);
    const sourceOther = mapping(source.id);
    const targetOther = mapping(target.id);
    const result = buildComponentProjectBulkPreview(org, { selection: [{ id: selected.id, expectedVersion: 1 }], changes: { projectRecordId: target.id, stage: 'MASS_PRODUCTION' } }, [selected], [source, target], [selected, sourceOther, targetOther]);
    expect(result).toMatchObject({ affectedMappingsCount: 2, affectedProjects: [{ id: target.id, selectedComponentCount: 1, totalComponentCount: 2, otherComponentCount: 1 }] });
    expect(result.affectedProjects).toHaveLength(1);
    expect(source.stage).toBe('NEW_PRODUCT');
  });

  it('requires an explicit project for unmapped shared edits, but allows classification and target assignment', () => {
    const m = mapping(null);
    const p = project();
    const selection = [{ id: m.id, expectedVersion: 1 }];
    for (const changes of [{ stage: 'MASS_PRODUCTION' as const }, { customerEngineerAssignmentId: null }]) {
      expect(() => buildComponentProjectBulkPreview(org, { selection, changes }, [m], [], [])).toThrow(expect.objectContaining({ status: 409 }));
    }
    expect(buildComponentProjectBulkPreview(org, { selection, changes: { productCategory: 'Body' } }, [m], [], []).affectedProjects).toEqual([]);
    expect(buildComponentProjectBulkPreview(org, { selection, changes: { projectRecordId: p.id, stage: 'MASS_PRODUCTION' } }, [m], [p], []).affectedProjects[0]!.id).toBe(p.id);
  });

  it('canonicalizes selection/field/member order but fingerprints scope, null, versions, and shared membership', () => {
    const p = project();
    const maps = [mapping(p.id), mapping(p.id)];
    const selection = maps.map(({ id }) => ({ id, expectedVersion: 1 }));
    const changes: ComponentProjectBulkChangesDto = { stage: 'MASS_PRODUCTION', customerEngineerAssignmentId: null };
    const run = (scope = org, selected = maps, projects = [p], members = maps, patch = changes) => buildComponentProjectBulkPreview(scope, { selection, changes: patch }, selected, projects, members).previewToken;
    const token = run();
    expect(buildComponentProjectBulkPreview(org, { selection: [...selection].reverse(), changes: { customerEngineerAssignmentId: null, stage: 'MASS_PRODUCTION' } }, [...maps].reverse(), [p], [...maps].reverse()).previewToken).toBe(token);
    expect(run(randomUUID())).not.toBe(token);
    expect(run(org, maps, [{ ...p, version: 2 }])).not.toBe(token);
    expect(run(org, maps, [p], [...maps, mapping(p.id)])).not.toBe(token);
    expect(run(org, maps, [p], [maps[0]!, { ...maps[1]!, version: 2 }])).not.toBe(token);
    expect(run(org, maps, [p], maps, { stage: 'MASS_PRODUCTION' })).not.toBe(token);
    expect(() => buildComponentProjectBulkPreview(org, { selection, changes }, [{ ...maps[0]!, version: 2 }, maps[1]!], [p], maps)).toThrow(expect.objectContaining({ status: 409 }));
    expect(() => buildComponentProjectBulkPreview(org, { selection, changes }, [maps[0]!], [p], maps)).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => buildComponentProjectBulkPreview(org, { selection, changes: { projectRecordId: randomUUID() } }, maps, [p], maps)).toThrow(expect.objectContaining({ status: 404 }));
  });
});
