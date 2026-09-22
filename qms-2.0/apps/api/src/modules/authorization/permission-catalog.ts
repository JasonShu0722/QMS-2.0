export const ADMIN_PERMISSIONS = [
  'configuration:read', 'configuration:manage', 'audit:export',
  'outbox:read', 'outbox:retry',
  'organization:manage', 'organization:structure:read', 'organization:structure:manage', 'organization:positions:assign', 'audit:read',
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
    { key: 'tasks', name: '我的任务', status: 'active', operations: [operation('task:read', '查看授权任务'), operation('task:claim', '领取和释放任务')] },
    { key: 'notifications', name: '我的通知', status: 'active', operations: [operation('notification:read', '查看和标记通知')] },
    { key: 'workflow', name: '受控流程', status: 'active', operations: [operation('workflow:manage', '管理（创建、编辑、校验、发布、复制）'), operation('workflow:start', '启动流程'), operation('workflow:act', '执行被授权的流程节点')] },
  ] },
  { key: 'supplier', name: '供应商质量', status: 'active', modules: [
    { key: 'supplier-profiles', name: '供应商资料', status: 'active', operations: [operation('supplier-quality:profiles:read', '查看业务资料'), operation('supplier-quality:profiles:write', '维护业务资料')] },
    { key: 'supplier-problems', name: '供应商问题', status: 'active', operations: [operation('supplier-quality:problems:read', '查看问题'), operation('supplier-quality:problems:write', '维护问题草稿')] },
    { key: 'supplier-responses', name: '整改回复', status: 'active', operations: [operation('supplier-quality:responses:read', '查看本企业问题'), operation('supplier-quality:responses:write', '保存回复草稿')] },
    { key: 'supplier-2', name: '供应商绩效', status: 'planned', operations: [] },
    { key: 'supplier-3', name: '供应商审核', status: 'planned', operations: [] },
    { key: 'supplier-4', name: 'PPAP', status: 'planned', operations: [] },
  ] },
  planned('process', '制程质量', ['制程问题管理']),
  planned('customer', '客户质量', ['客户问题管理']),
  planned('new-product', '新品质量', ['新品质量管理']),
  planned('audit', '审核管理', ['审核管理']),
  { key: 'system', name: '系统管理', status: 'active', modules: [
    { key: 'organization', name: '组织目录', status: 'active', operations: [operation('organization:read', '查看组织'), operation('organization:manage', '维护组织树和启停'), operation('organization:structure:read', '查看部门岗位'), operation('organization:structure:manage', '维护部门岗位'), operation('organization:positions:assign', '分配用户任职')] },
    { key: 'management-audit', name: '管理审计', status: 'active', operations: [operation('audit:read', '查询管理审计'), operation('audit:export', '导出管理审计')] },
    { key: 'platform-configuration', name: '平台配置', status: 'active', operations: [operation('configuration:read', '查看配置字典和通知规则'), operation('configuration:manage', '维护配置字典和通知规则')] },
    { key: 'outbox-operations', name: '通知运行监控', status: 'active', operations: [operation('outbox:read', '查看失败事件'), operation('outbox:retry', '重试失败事件')] },
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
