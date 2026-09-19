export const ADMIN_PERMISSIONS = [
  'account:users:read', 'account:users:create', 'account:users:update', 'account:users:status', 'account:users:transfer', 'account:users:reset',
  'account:roles:read', 'account:roles:create', 'account:roles:update', 'account:roles:delete', 'account:roles:assign',
];

type Operation = { code: string; name: string; enforcement: 'guarded' | 'reserved' };
type Module = { key: string; name: string; status: 'active' | 'planned'; operations: Operation[] };
type Group = { key: string; name: string; status: 'active' | 'planned'; modules: Module[] };
const operation = (code: string, name: string, enforcement: Operation['enforcement'] = 'guarded'): Operation => ({ code, name, enforcement });
const planned = (key: string, name: string, names: string[]): Group => ({ key, name, status: 'planned', modules: names.map((moduleName, index) => ({ key: `${key}-${index + 1}`, name: moduleName, status: 'planned', operations: [] })) });

export const PERMISSION_CATALOG: Group[] = [
  { key: 'platform', name: '平台功能', status: 'active', modules: [
    { key: 'workbench', name: '工作台', status: 'active', operations: [operation('workbench:read', '查看工作台（预留标识）', 'reserved')] },
    { key: 'problem-index', name: '问题查询', status: 'active', operations: [operation('problem-index:read', '查看问题索引')] },
    { key: 'workflow', name: '受控流程', status: 'active', operations: [operation('workflow:manage', '管理（创建、编辑、校验、发布、复制）')] },
  ] },
  planned('supplier', '供应商质量', ['供应商管理', '供应商绩效', '供应商审核', 'PPAP', '供应商整改']),
  planned('process', '制程质量', ['制程问题管理']),
  planned('customer', '客户质量', ['客户问题管理']),
  planned('new-product', '新品质量', ['新品质量管理']),
  planned('audit', '审核管理', ['审核管理']),
  { key: 'system', name: '系统管理', status: 'active', modules: [
    { key: 'organization', name: '组织目录', status: 'active', operations: [operation('organization:read', '查看组织')] },
    { key: 'permission-context', name: '当前权限上下文', status: 'active', operations: [operation('system:permissions:read', '查看当前权限')] },
    { key: 'users', name: '用户管理', status: 'active', operations: [
      operation('account:users:read', '查看用户'), operation('account:users:create', '创建用户'), operation('account:users:update', '编辑邮箱'),
      operation('account:users:status', '启用 / 停用'), operation('account:users:transfer', '变更组织 / 账号类型'), operation('account:users:reset', '重置凭证'),
    ] },
    { key: 'roles', name: '角色管理', status: 'active', operations: [
      operation('account:roles:read', '查看角色'), operation('account:roles:create', '创建 / 复制'), operation('account:roles:update', '编辑角色 / 权限'),
      operation('account:roles:delete', '删除角色'), operation('account:roles:assign', '分配角色'),
    ] },
  ] },
];

export const ACTIVE_PERMISSION_CODES = PERMISSION_CATALOG.flatMap((group) => group.modules.flatMap((module) => module.operations.map((entry) => entry.code)));

export function userUpdatePermissions(fields: object): string[] {
  const submitted = fields as Record<string, unknown>;
  const permissions: string[] = [];
  if (submitted.email !== undefined) permissions.push('account:users:update');
  if (submitted.status !== undefined) permissions.push('account:users:status');
  if (submitted.organizationId !== undefined || submitted.accountType !== undefined) permissions.push('account:users:transfer');
  return permissions.length ? permissions : ['account:users:update'];
}
