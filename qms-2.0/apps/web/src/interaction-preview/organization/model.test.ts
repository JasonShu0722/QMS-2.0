import { describe, expect, it } from 'vitest';
import {
  apply, blockers, createModel, people, permissions,
  type Appointment, type Command, type Model, type Node, type Position,
} from './model';

const section = (overrides: Partial<Node> = {}): Node => ({
  id: 'new-section', parentId: 'quality', kind: 'section', code: 'NEW', name: '新科室', enabled: true,
  ...overrides,
});
const position = (overrides: Partial<Position> = {}): Position => ({
  id: 'new-position', nodeId: 'process', name: '新工程师', permissions: ['register'], duty: 'engineer',
  ...overrides,
});
const personId = (name: string) => people.find((person) => person.name === name)!.id;
const appointment = (overrides: Partial<Appointment> = {}): Appointment => ({
  id: 'new-appointment', positionId: 'new-position', personId: personId('林工'), sectionIds: [],
  ...overrides,
});
const savedNode = (model: Model, id: string) => model.nodes.find((node) => node.id === id)!;
const minister = (model: Model) => model.positions.find((item) => item.duty === 'minister')!;

function reject(model: Model, command: Command, reason: RegExp) {
  const before = structuredClone(model);
  const result = apply(model, command);
  expect(result.error).toMatch(reason);
  expect(result.model).toBe(model);
  expect(model).toEqual(before);
}

describe('organization preview fixtures', () => {
  it('rejects an organization-level minister instead of allowing cross-department coverage', () => {
    const model = createModel();
    reject(model, { type: 'position', value: position({ nodeId: 'hq', duty: 'minister' }) }, /部长.*部门/);
  });
  it('provides the requested hierarchy, people, and only the three demo permissions', () => {
    const model = createModel();
    expect(savedNode(model, 'hq')).toMatchObject({ kind: 'organization', code: 'DEMO-HQ', protected: true });
    for (const id of ['quality', 'rnd', 'empty']) {
      expect(savedNode(model, id)).toMatchObject({ kind: 'department', parentId: 'hq' });
    }
    for (const id of ['process', 'project', 'retired']) {
      expect(savedNode(model, id)).toMatchObject({ kind: 'section', parentId: 'quality' });
    }
    expect(savedNode(model, 'hardware')).toMatchObject({ kind: 'section', parentId: 'rnd' });
    expect(savedNode(model, 'retired')).toMatchObject({ historical: true, enabled: false });
    expect(people.map((person) => person.name)).toEqual(['林工', '王部长', '李部长', '管理员']);
    expect(permissions.map((permission) => permission.key)).toEqual(['register', 'issue', 'approve']);
    expect(permissions.every((permission) => permission.zh && permission.en)).toBe(true);
  });

  it('seeds two ministers with distinct scopes and Wang holding a hardware manager appointment', () => {
    const model = createModel();
    const ministers = model.positions.filter((item) => item.duty === 'minister');
    expect(ministers).toHaveLength(2);
    expect(ministers.every((item) => item.nodeId === 'quality')).toBe(true);
    const scopes = model.appointments.filter((item) => ministers.some((post) => post.id === item.positionId));
    expect(scopes.map((item) => item.sectionIds).sort()).toEqual([['process'], ['project']]);
    const wangPosts = model.appointments.filter((item) => item.personId === personId('王部长'))
      .map((item) => model.positions.find((post) => post.id === item.positionId)!);
    expect(wangPosts.map((post) => post.duty).sort()).toEqual(['manager', 'minister']);
    expect(wangPosts.find((post) => post.duty === 'manager')?.nodeId).toBe('hardware');
    const engineer = model.positions.find((item) => item.nodeId === 'process' && item.duty === 'engineer')!;
    expect(model.appointments).toContainEqual(expect.objectContaining({
      positionId: engineer.id, personId: personId('林工'),
    }));
  });

  it('returns independent fixture arrays on every reset', () => {
    const first = createModel();
    const second = createModel();
    first.nodes[0].name = 'changed';
    first.positions[0].permissions.push('changed');
    first.appointments[0].sectionIds.push('changed');
    expect(second).toEqual(createModel());
  });
});

describe('node commands', () => {
  it('creates a child organization without inheriting appointments or positions', () => {
    const model = createModel();
    const result = apply(model, { type: 'node', value: { id: 'child-org', kind: 'organization', parentId: 'hq', code: 'CHILD', name: '子组织', enabled: true } });
    expect(result.error).toBeUndefined();
    expect(savedNode(result.model, 'child-org').kind).toBe('organization');
    expect(result.model.positions).toEqual(model.positions);
    expect(result.model.appointments).toEqual(model.appointments);
    const department = apply(result.model, { type: 'node', value: { id: 'child-dept', kind: 'department', parentId: 'child-org', code: 'QUALITY', name: '子组织部门', enabled: true } });
    expect(department.error).toBeUndefined();
  });
  it('edits trimmed code and name in place while preserving IDs and all references', () => {
    const model = createModel();
    const before = structuredClone(model);
    const result = apply(model, { type: 'node', value: { ...savedNode(model, 'quality'), code: ' QA ', name: ' 质量部 ' } });
    expect(result.error).toBeUndefined();
    expect(savedNode(result.model, 'quality')).toMatchObject({ id: 'quality', code: 'QA', name: '质量部' });
    expect(result.model.positions).toEqual(model.positions);
    expect(result.model.appointments).toEqual(model.appointments);
    expect(savedNode(result.model, 'process').parentId).toBe('quality');
    expect(model).toEqual(before);
  });

  it('rejects a duplicate code across department and section within the same organization', () => {
    const model = createModel();
    reject(model, { type: 'node', value: { ...savedNode(model, 'quality'), code: ` ${savedNode(model, 'process').code} ` } }, /代码.*重复/);
  });

  it('allows the same department/section code in another organization, but not duplicate organization codes', () => {
    let model = createModel();
    model = apply(model, { type: 'node', value: { id: 'other', kind: 'organization', code: 'OTHER', name: '另一组织', enabled: true } }).model;
    const result = apply(model, { type: 'node', value: { id: 'other-quality', parentId: 'other', kind: 'department', code: savedNode(model, 'quality').code, name: '质量部', enabled: true } });
    expect(result.error).toBeUndefined();
    reject(model, { type: 'node', value: { id: 'duplicate-org', kind: 'organization', code: ' DEMO-HQ ', name: '重复组织', enabled: true } }, /代码.*重复/);
  });

  it('creates a valid child without mutating the supplied object or model', () => {
    const model = createModel();
    const value = section({ code: ' NEW ', name: ' 新科室 ' });
    const result = apply(model, { type: 'node', value });
    expect(result.error).toBeUndefined();
    expect(savedNode(result.model, value.id)).toMatchObject({ code: 'NEW', name: '新科室' });
    expect(value.code).toBe(' NEW ');
    expect(model.nodes.some((node) => node.id === value.id)).toBe(false);
  });

  it.each([
    [section({ id: '' }), /标识/],
    [section({ code: '  ' }), /代码/],
    [section({ name: '  ' }), /名称/],
    [section({ parentId: 'missing' }), /上级.*不存在/],
    [section({ parentId: 'hq' }), /层级|部门/],
    [section({ parentId: 'process' }), /层级|部门/],
    [section({ parentId: undefined }), /上级/],
    [section({ kind: 'department' }), /层级|组织/],
    [section({ kind: 'organization' }), /上级|层级/],
  ])('rejects malformed or invalid hierarchy input %#', (value, error) => {
    reject(createModel(), { type: 'node', value: value as Node }, error as RegExp);
  });

  it.each([
    { kind: 'section' as const },
    { parentId: 'rnd' },
  ])('does not overwrite a node identity with changed kind or parent: %j', (change) => {
    const model = createModel();
    reject(model, { type: 'node', value: { ...savedNode(model, 'quality'), ...change } }, /类型|上级|身份/);
  });

  it('does not create children or positions below disabled nodes or ancestors', () => {
    const model = createModel();
    savedNode(model, 'quality').enabled = false;
    reject(model, { type: 'node', value: section() }, /停用/);
    reject(model, { type: 'position', value: position() }, /停用/);
    reject(model, { type: 'position', value: position({ nodeId: 'retired' }) }, /停用/);
  });

  it('rejects cross-entity ID collisions without overwriting data', () => {
    const model = createModel();
    reject(model, { type: 'node', value: section({ id: model.positions[0].id }) }, /标识.*重复|身份/);
    reject(model, { type: 'position', value: position({ id: 'hq' }) }, /标识.*重复|身份/);
    reject(model, { type: 'appointment', value: appointment({ id: 'hq' }) }, /标识.*重复|身份/);
  });

  it('does not silently restore disabled objects', () => {
    const model = createModel();
    reject(model, { type: 'node', value: { ...savedNode(model, 'retired'), enabled: true } }, /恢复|启用/);
  });
});

describe('delete and disable dependencies', () => {
  it('deletes an unused empty department and preserves the original', () => {
    const model = createModel();
    expect(blockers(model, 'empty', 'delete')).toEqual([]);
    const result = apply(model, { type: 'delete', id: 'empty' });
    expect(result.error).toBeUndefined();
    expect(result.model.nodes.some((node) => node.id === 'empty')).toBe(false);
    expect(savedNode(model, 'empty')).toBeDefined();
  });

  it('rejects historical deletion but allows historical-only disabling', () => {
    const model = createModel();
    reject(model, { type: 'delete', id: 'retired' }, /历史/);
    expect(blockers(model, 'retired', 'disable')).toEqual([]);
    expect(apply(model, { type: 'disable', id: 'retired' }).error).toBeUndefined();
    model.nodes.push(section({ id: 'history', historical: true }));
    const result = apply(model, { type: 'disable', id: 'history' });
    expect(result.error).toBeUndefined();
    expect(savedNode(result.model, 'history').enabled).toBe(false);
  });

  it.each(['delete', 'disable'] as const)('protects the main organization from %s', (type) => {
    reject(createModel(), { type, id: 'hq' }, /保护/);
  });

  it('lists descendants, positions, and appointments as delete blockers', () => {
    const reasons = blockers(createModel(), 'quality', 'delete').join('；');
    expect(reasons).toMatch(/下级/);
    expect(reasons).toMatch(/岗位/);
    expect(reasons).toMatch(/任职/);
  });

  it('blocks enabled children, positions, appointments, and minister coverage when disabling', () => {
    const model = createModel();
    expect(blockers(model, 'quality', 'disable').join('；')).toMatch(/启用.*下级|下级.*启用/);
    expect(blockers(model, 'process', 'disable').join('；')).toMatch(/岗位/);
    expect(blockers(model, 'process', 'disable').join('；')).toMatch(/任职/);
    const result = blockers(model, 'project', 'disable').join('；');
    expect(result).toMatch(/部长.*分管/);
    reject(model, { type: 'disable', id: 'project' }, /部长.*分管/);
  });

  it('blocks unassigned positions too, but allows disabled children alone', () => {
    const model = createModel();
    model.positions.push(position({ nodeId: 'empty' }));
    reject(model, { type: 'disable', id: 'empty' }, /岗位/);
    const onlyHistory: Model = {
      nodes: [savedNode(model, 'hq'), savedNode(model, 'quality'), savedNode(model, 'retired')],
      positions: [], appointments: [],
    };
    expect(apply(onlyHistory, { type: 'disable', id: 'quality' }).error).toBeUndefined();
    reject(onlyHistory, { type: 'delete', id: 'quality' }, /下级/);
  });

  it.each(['delete', 'disable'] as const)('blocks pending work for %s', (type) => {
    const model = createModel();
    savedNode(model, 'empty').pending = 1;
    reject(model, { type, id: 'empty' }, /在途/);
  });

  it('does not bypass disable guards by editing enabled in a node command', () => {
    const model = createModel();
    reject(model, { type: 'node', value: { ...savedNode(model, 'process'), enabled: false } }, /岗位|任职|分管/);
  });

  it.each(['delete', 'disable'] as const)('rejects missing targets for %s', (type) => {
    const model = createModel();
    expect(blockers(model, 'missing', type).join('；')).toMatch(/不存在/);
    reject(model, { type, id: 'missing' }, /不存在/);
  });
});

describe('position commands', () => {
  it('trims a position name and accepts known permissions on an enabled node', () => {
    const model = createModel();
    const result = apply(model, { type: 'position', value: position({ name: ' 工程师 ' }) });
    expect(result.error).toBeUndefined();
    expect(result.model.positions.at(-1)).toEqual(position({ name: '工程师' }));
    expect(model.positions.some((item) => item.id === 'new-position')).toBe(false);
  });

  it.each([
    [position({ id: '' }), /标识/],
    [position({ name: ' ' }), /名称/],
    [position({ nodeId: 'missing' }), /节点.*不存在/],
    [position({ permissions: ['unknown'] }), /权限/],
    [position({ duty: 'minister' }), /部长.*部门|部长.*组织/],
    [position({ duty: 'admin', permissions: permissions.map((item) => item.key) }), /管理员.*部门|管理员.*组织/],
  ])('rejects invalid position input %#', (value, error) => {
    reject(createModel(), { type: 'position', value: value as Position }, error as RegExp);
  });

  it('requires admin positions to contain exactly the full demo catalog', () => {
    const model = createModel();
    const admin = model.positions.find((item) => item.duty === 'admin')!;
    expect(admin.permissions.slice().sort()).toEqual(['approve', 'issue', 'register']);
    expect(model.appointments).toContainEqual(expect.objectContaining({ positionId: admin.id, personId: personId('管理员') }));
    reject(model, { type: 'position', value: { ...admin, permissions: ['register'] } }, /管理员.*全量|完整/);
    reject(model, { type: 'position', value: { ...admin, permissions: [...admin.permissions, 'approve'] } }, /重复|全量/);
    expect(apply(model, { type: 'position', value: { ...admin, permissions: [...admin.permissions].reverse() } }).error).toBeUndefined();
  });

  it('does not move a position to a different node under the same ID', () => {
    const model = createModel();
    reject(model, { type: 'position', value: { ...minister(model), nodeId: 'rnd' } }, /归属|身份/);
  });

  it('does not change a minister duty while existing appointments still hold scopes', () => {
    const model = createModel();
    reject(model, { type: 'position', value: { ...minister(model), duty: 'manager' } }, /分管|部长/);
  });
});

describe('appointment commands', () => {
  it('allows distinct people on the same minister position with disjoint scopes', () => {
    const model = createModel();
    const post = minister(model);
    model.appointments = model.appointments.filter((item) => !model.positions.some((p) => p.duty === 'minister' && p.id === item.positionId));
    const first = apply(model, { type: 'appointment', value: appointment({ positionId: post.id, personId: personId('王部长'), sectionIds: ['process'] }) });
    expect(first.error).toBeUndefined();
    const second = apply(first.model, { type: 'appointment', value: appointment({ id: 'second', positionId: post.id, personId: personId('李部长'), sectionIds: ['project'] }) });
    expect(second.error).toBeUndefined();
    expect(second.model.appointments.filter((item) => item.positionId === post.id)).toHaveLength(2);
    reject(second.model, { type: 'appointment', value: appointment({ id: 'overlap', positionId: post.id, personId: personId('管理员'), sectionIds: ['process', 'project'] }) }, /分管.*重叠|已.*分管/);
  });

  it('allows replacing the same appointment without conflicting with itself', () => {
    const model = createModel();
    const existing = model.appointments.find((item) => item.sectionIds.includes('process'))!;
    const result = apply(model, { type: 'appointment', value: { ...existing } });
    expect(result.error).toBeUndefined();
    expect(result.model.appointments).toHaveLength(model.appointments.length);
  });

  it('allows one minister to cover multiple distinct sections within its department', () => {
    const model = createModel();
    const existing = model.appointments.find((item) => item.sectionIds.includes('process'))!;
    model.appointments = model.appointments.filter((item) => !item.sectionIds.includes('project'));
    const result = apply(model, { type: 'appointment', value: { ...existing, sectionIds: ['process', 'project'] } });
    expect(result.error).toBeUndefined();
    expect(result.model.appointments.find((item) => item.id === existing.id)?.sectionIds).toEqual(['process', 'project']);
  });

  it.each([
    [['hardware'], /分管.*范围|所属.*部门/],
    [['retired'], /停用/],
    [['quality'], /科室/],
    [['missing'], /科室.*不存在/],
    [['process', 'process'], /重复/],
  ])('rejects invalid minister coverage %j atomically', (sectionIds, error) => {
    const model = createModel();
    const existing = model.appointments.find((item) => item.sectionIds.includes('process'))!;
    reject(model, { type: 'appointment', value: { ...existing, sectionIds: sectionIds as string[] } }, error as RegExp);
  });

  it('rejects overlap with another appointment even if the position IDs differ', () => {
    const model = createModel();
    const existing = model.appointments.find((item) => item.sectionIds.includes('process'))!;
    reject(model, { type: 'appointment', value: { ...existing, sectionIds: ['project'] } }, /分管.*重叠|已.*分管/);
  });

  it('rejects duplicate person-position appointments rather than duplicate people globally', () => {
    const model = createModel();
    const existing = model.appointments.find((item) => item.sectionIds.includes('process'))!;
    reject(model, { type: 'appointment', value: { ...existing, id: 'duplicate', sectionIds: [] } }, /重复.*任职|已.*任职/);
    const manager = model.positions.find((item) => item.duty === 'manager')!;
    const result = apply(model, { type: 'appointment', value: appointment({ positionId: manager.id, personId: personId('李部长') }) });
    expect(result.error).toBeUndefined();
  });

  it.each([
    [{ id: '' }, /标识/],
    [{ personId: 'missing' }, /人员.*不存在/],
    [{ positionId: 'missing' }, /岗位.*不存在/],
    [{ sectionIds: ['project'] }, /非部长|仅.*部长/],
  ])('rejects invalid appointment input %j', (change, error) => {
    const model = createModel();
    model.positions.push(position());
    reject(model, { type: 'appointment', value: appointment(change) }, error as RegExp);
  });

  it('does not appoint people to positions below disabled nodes', () => {
    const model = createModel();
    model.positions.push(position());
    savedNode(model, 'quality').enabled = false;
    reject(model, { type: 'appointment', value: appointment() }, /停用/);
    const existing = model.appointments.find((item) => item.sectionIds.includes('process'))!;
    reject(model, { type: 'appointment', value: existing }, /停用/);
  });

  it('copies permission and coverage input arrays instead of retaining caller-owned arrays', () => {
    const model = createModel();
    const post = position();
    const first = apply(model, { type: 'position', value: post });
    post.permissions.push('approve');
    expect(first.model.positions.at(-1)?.permissions).toEqual(['register']);
    const existing = model.appointments.find((item) => item.sectionIds.includes('process'))!;
    const value = { ...existing, sectionIds: [...existing.sectionIds] };
    const second = apply(model, { type: 'appointment', value });
    value.sectionIds.push('hardware');
    expect(second.model.appointments.find((item) => item.id === value.id)?.sectionIds).toEqual(['process']);
  });
});
