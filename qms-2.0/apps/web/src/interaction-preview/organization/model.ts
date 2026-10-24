// 仅供本地交互原型：内存约束不代表服务端鉴权、审批或真实业务验收。
export type Kind = 'organization' | 'department' | 'section';
export type Node = {
  id: string;
  parentId?: string;
  kind: Kind;
  code: string;
  name: string;
  enabled: boolean;
  protected?: boolean;
  historical?: boolean;
  pending?: number;
};

export const permissions = [
  { key: 'register', zh: '登记问题', en: 'Register' },
  { key: 'issue', zh: '下发问题', en: 'Issue' },
  { key: 'approve', zh: '审批问题', en: 'Approve' },
];

export const people = [
  { id: 'lin', name: '林工' },
  { id: 'wang', name: '王部长' },
  { id: 'li', name: '李部长' },
  { id: 'admin', name: '管理员' },
];

export type Position = {
  id: string;
  nodeId: string;
  name: string;
  permissions: string[];
  duty: 'engineer' | 'manager' | 'minister' | 'admin';
};
export type Appointment = {
  id: string;
  positionId: string;
  personId: string;
  sectionIds: string[];
};
export type Model = { nodes: Node[]; positions: Position[]; appointments: Appointment[] };
export type Command =
  | { type: 'node'; value: Node }
  | { type: 'position'; value: Position }
  | { type: 'appointment'; value: Appointment }
  | { type: 'delete' | 'disable'; id: string };

export function createModel(): Model {
  return {
    nodes: [
      { id: 'hq', kind: 'organization', code: 'DEMO-HQ', name: '演示公司', enabled: true, protected: true },
      { id: 'quality', parentId: 'hq', kind: 'department', code: 'QUALITY', name: '质量部', enabled: true },
      { id: 'process', parentId: 'quality', kind: 'section', code: 'PROCESS', name: '过程质量科', enabled: true },
      { id: 'project', parentId: 'quality', kind: 'section', code: 'PROJECT', name: '项目质量科', enabled: true },
      { id: 'rnd', parentId: 'hq', kind: 'department', code: 'RND', name: '研发部', enabled: true },
      { id: 'hardware', parentId: 'rnd', kind: 'section', code: 'HARDWARE', name: '硬件科', enabled: true },
      { id: 'empty', parentId: 'hq', kind: 'department', code: 'EMPTY', name: '未使用部门', enabled: true },
      { id: 'retired', parentId: 'quality', kind: 'section', code: 'RETIRED', name: '历史科室', enabled: false, historical: true },
    ],
    positions: [
      { id: 'quality-minister-wang', nodeId: 'quality', name: '质量部长（一）', permissions: ['issue', 'approve'], duty: 'minister' },
      { id: 'quality-minister-li', nodeId: 'quality', name: '质量部长（二）', permissions: ['issue', 'approve'], duty: 'minister' },
      { id: 'process-engineer', nodeId: 'process', name: '过程质量工程师', permissions: ['register'], duty: 'engineer' },
      { id: 'hardware-manager', nodeId: 'hardware', name: '硬件经理', permissions: ['approve'], duty: 'manager' },
      { id: 'hq-admin', nodeId: 'hq', name: '组织管理员', permissions: permissions.map((item) => item.key), duty: 'admin' },
    ],
    appointments: [
      { id: 'wang-minister', positionId: 'quality-minister-wang', personId: 'wang', sectionIds: ['process'] },
      { id: 'li-minister', positionId: 'quality-minister-li', personId: 'li', sectionIds: ['project'] },
      { id: 'lin-engineer', positionId: 'process-engineer', personId: 'lin', sectionIds: [] },
      { id: 'wang-manager', positionId: 'hardware-manager', personId: 'wang', sectionIds: [] },
      { id: 'admin-appointment', positionId: 'hq-admin', personId: 'admin', sectionIds: [] },
    ],
  };
}

function ancestry(model: Model, id: string): Node[] {
  const result: Node[] = [];
  let node = model.nodes.find((item) => item.id === id);
  while (node) {
    const current = node;
    if (result.some((item) => item.id === current.id)) break;
    result.push(node);
    node = model.nodes.find((item) => item.id === current.parentId);
  }
  return result;
}

export function blockers(model: Model, id: string, action: 'delete' | 'disable'): string[] {
  const node = model.nodes.find((item) => item.id === id);
  if (!node) return ['节点不存在，请重新选择'];
  const descendants = model.nodes.filter((item) => item.id !== id && ancestry(model, item.id).some((parent) => parent.id === id));
  const nodeIds = new Set([id, ...descendants.map((item) => item.id)]);
  const posts = model.positions.filter((item) => nodeIds.has(item.nodeId));
  const reasons: string[] = [];
  if (node.protected) reasons.push('受保护节点不能删除或停用');
  if (action === 'delete' && descendants.length) reasons.push('存在下级节点，请先处理下级');
  if (action === 'disable' && descendants.some((item) => item.enabled)) reasons.push('存在启用的下级节点，请先处理');
  if (posts.length) reasons.push('存在岗位，请先处理岗位');
  if (model.appointments.some((item) => posts.some((post) => post.id === item.positionId))) {
    reasons.push('存在人员任职，请先处理任职');
  }
  if (model.appointments.some((item) => item.sectionIds.some((sectionId) => nodeIds.has(sectionId))
    && model.positions.some((post) => post.id === item.positionId && post.duty === 'minister'))) {
    reasons.push('存在部长分管关系，请先处理分管范围');
  }
  if (action === 'delete' && node.historical) reasons.push('存在历史引用，不能删除；可保留历史并停用');
  if ([node, ...descendants].some((item) => (item.pending ?? 0) > 0)) reasons.push('存在在途责任，请先处理在途事项');
  return reasons;
}

export function apply(model: Model, command: Command): { model: Model; error?: string } {
  const fail = (error: string) => ({ model, error });
  if (!('value' in command)) {
    const reasons = blockers(model, command.id, command.type);
    if (reasons.length) return fail(reasons.join('；'));
    const nodes = command.type === 'delete'
      ? model.nodes.filter((item) => item.id !== command.id)
      : model.nodes.map((item) => item.id === command.id ? { ...item, enabled: false } : item);
    return { model: { ...model, nodes } };
  }

  if (!command.value.id.trim()) return fail('对象标识不能为空');
  const id = command.value.id;
  if ((command.type !== 'node' && model.nodes.some((item) => item.id === id))
    || (command.type !== 'position' && model.positions.some((item) => item.id === id))
    || (command.type !== 'appointment' && model.appointments.some((item) => item.id === id))) {
    return fail('对象标识重复，不能覆盖其他身份');
  }

  if (command.type === 'node') {
    const value = { ...command.value, code: command.value.code.trim(), name: command.value.name.trim() };
    const existing = model.nodes.find((item) => item.id === id);
    if (!value.code) return fail('节点代码不能为空');
    if (!value.name) return fail('节点名称不能为空');
    if (!['organization', 'department', 'section'].includes(value.kind)) return fail('节点类型无效');
    if (existing && (existing.kind !== value.kind || existing.parentId !== value.parentId)) {
      return fail('不能改变已有节点的类型或上级身份');
    }
    if (existing && !existing.enabled && value.enabled) return fail('本样例不提供恢复启用，请重置示例');
    if (value.kind === 'organization') {
      if (value.parentId) {
        const parent = model.nodes.find((item) => item.id === value.parentId);
        if (parent?.kind !== 'organization') return fail('子组织的上级必须为组织');
        if (!existing && ancestry(model, parent.id).some((item) => !item.enabled)) return fail('停用组织下不能新增子组织');
      }
    } else {
      const parent = model.nodes.find((item) => item.id === value.parentId);
      if (!parent) return fail('上级节点不存在，请重新选择');
      const requiredKind = value.kind === 'department' ? 'organization' : 'department';
      if (parent.kind !== requiredKind) return fail('层级必须为组织 → 部门 → 科室');
      if (!existing && ancestry(model, parent.id).some((item) => !item.enabled)) {
        return fail('停用节点下不能新增下级');
      }
    }
    const organizationId = (node: Node) => ancestry(model, node.parentId ?? node.id).find((item) => item.kind === 'organization')?.id;
    if (model.nodes.some((item) => item.id !== id && item.code === value.code
      && (value.kind === 'organization' ? item.kind === 'organization'
        : item.kind !== 'organization' && organizationId(item) === organizationId(value)))) {
      return fail('节点代码重复：组织代码全局唯一，部门与科室代码在同组织内唯一');
    }
    if (existing?.enabled && !value.enabled) {
      const reasons = blockers(model, id, 'disable');
      if (reasons.length) return fail(reasons.join('；'));
    }
    const nodes = existing ? model.nodes.map((item) => item.id === id ? value : item) : [...model.nodes, value];
    return { model: { ...model, nodes } };
  }

  if (command.type === 'position') {
    const value = { ...command.value, name: command.value.name.trim(), permissions: [...command.value.permissions] };
    const existing = model.positions.find((item) => item.id === id);
    const node = model.nodes.find((item) => item.id === value.nodeId);
    if (!value.name) return fail('岗位名称不能为空');
    if (!node) return fail('所属节点不存在，请重新选择');
    if (existing && existing.nodeId !== value.nodeId) return fail('不能改变已有岗位的归属身份');
    if (ancestry(model, node.id).some((item) => !item.enabled)) return fail('停用节点下不能新增或配置岗位');
    if (!['engineer', 'manager', 'minister', 'admin'].includes(value.duty)) return fail('岗位职责无效');
    if (value.duty === 'minister' && node.kind !== 'department') return fail('部长岗位必须设置在所属部门');
    if (value.duty === 'admin' && node.kind === 'section') return fail('管理员岗位必须设置在部门或组织');
    if (value.permissions.some((key) => !permissions.some((item) => item.key === key))) return fail('包含未知的演示权限');
    if (new Set(value.permissions).size !== value.permissions.length) return fail('岗位权限不能重复');
    if (value.duty === 'admin' && value.permissions.length !== permissions.length) {
      return fail('管理员岗位必须包含演示目录的全量权限，不代表真实后台全量权限');
    }
    if (value.duty !== 'minister' && model.appointments.some((item) => item.positionId === id && item.sectionIds.length)) {
      return fail('已有部长分管关系，请先处理任职分管范围再修改职责');
    }
    const positions = existing ? model.positions.map((item) => item.id === id ? value : item) : [...model.positions, value];
    return { model: { ...model, positions } };
  }

  const value = { ...command.value, sectionIds: [...command.value.sectionIds] };
  const post = model.positions.find((item) => item.id === value.positionId);
  if (!people.some((item) => item.id === value.personId)) return fail('任职人员不存在，请重新选择');
  if (!post) return fail('任职岗位不存在，请重新选择');
  if (!model.nodes.some((item) => item.id === post.nodeId)) return fail('岗位所属节点不存在');
  if (post.duty === 'minister' && model.nodes.find((item) => item.id === post.nodeId)?.kind !== 'department') {
    return fail('部长岗位必须设置在所属部门');
  }
  if (ancestry(model, post.nodeId).some((item) => !item.enabled)) return fail('停用节点下不能分配任职或部长分管范围');
  if (model.appointments.some((item) => item.id !== id && item.personId === value.personId && item.positionId === value.positionId)) {
    return fail('同一人员与岗位不能重复任职');
  }
  if (post.duty !== 'minister' && value.sectionIds.length) return fail('非部长任职不能设置分管科室');
  if (new Set(value.sectionIds).size !== value.sectionIds.length) return fail('分管科室不能重复');
  for (const sectionId of value.sectionIds) {
    const section = model.nodes.find((item) => item.id === sectionId);
    if (!section) return fail('分管科室不存在，请重新选择');
    if (section.kind !== 'section') return fail('部长分管对象必须是科室');
    const parents = ancestry(model, sectionId);
    if (parents.some((item) => !item.enabled)) return fail('停用科室或停用上级不能成为部长分管范围');
    if (!parents.some((item) => item.id === post.nodeId)) return fail('分管科室超出岗位所属部门或组织的分管范围');
    if (model.appointments.some((item) => item.id !== id && item.sectionIds.includes(sectionId)
      && model.positions.some((other) => other.id === item.positionId && other.duty === 'minister'))) {
      return fail(`科室“${section.name}”已由其他部长任职分管，分管范围不能重叠`);
    }
  }
  const existing = model.appointments.some((item) => item.id === id);
  const appointments = existing ? model.appointments.map((item) => item.id === id ? value : item) : [...model.appointments, value];
  return { model: { ...model, appointments } };
}
