import type { components } from '@qms/contracts';

export type ConsoleContext = components['schemas']['ConsoleContextDto'];
export type ConsoleModule = components['schemas']['ConsoleModuleDto'];
export type ConsoleNavigationItem = { path: string; label: string; english: string; group: string; module?: ConsoleModule['key'] };
const home: ConsoleNavigationItem = { path: '/console', label: '管理首页', english: 'Management home', group: 'workspace' };
const items: (ConsoleNavigationItem & { permissions?: string[] })[] = [
  { path: '/console/users', label: '用户与任职', english: 'Users & appointments', group: 'administration', module: 'users' },
  { path: '/console/organizations', label: '组织与岗位', english: 'Organizations & positions', group: 'administration', module: 'organizations' },
  { path: '/console/supplier-accounts', label: '供应商账号', english: 'Supplier accounts', group: 'administration', module: 'supplier-accounts' },
  { path: '/console/reconfiguration', label: '待配置管理', english: 'Pending configuration', group: 'administration', module: 'reconfiguration' },
  { path: '/console/problem-reconfiguration', label: '问题责任恢复', english: 'Problem responsibility recovery', group: 'administration', module: 'problem-reconfiguration' },
  { path: '/console/master-data/suppliers', label: '供应商档案', english: 'Supplier profiles', group: 'configuration', module: 'master-data', permissions: ['supplier-quality:profiles:read', 'supplier-quality:profiles:write'] },
  { path: '/console/master-data/customers', label: '客户档案', english: 'Customer profiles', group: 'configuration', module: 'master-data', permissions: ['customer-quality:complaints:read', 'customer-quality:complaints:write'] },
  { path: '/console/master-data/materials', label: '物料主数据', english: 'Material master', group: 'configuration', module: 'master-data', permissions: ['material-master:read', 'material-master:write', 'material-master:import'] },
  { path: '/console/master-data/component-projects', label: '组件项目映射', english: 'Component project mapping', group: 'configuration', module: 'master-data', permissions: ['component-project:read', 'component-project:manage'] },
  { path: '/console/configuration', label: '平台配置', english: 'Platform configuration', group: 'configuration', module: 'configuration' },
  { path: '/console/workflows', label: '流程管理', english: 'Workflow management', group: 'configuration', module: 'workflows' },
  { path: '/console/audit-log', label: '管理审计', english: 'Management audit', group: 'security', module: 'audit' },
  { path: '/console/outbox', label: '失败队列', english: 'Failed events', group: 'security', module: 'outbox' },
  { path: '/console/api-monitoring', label: 'API 技术观测', english: 'API observations', group: 'security', module: 'api-monitoring', permissions: ['console:api:read'] },
  { path: '/console/data-exchanges', label: '数据交换观测', english: 'Data exchange observations', group: 'security', module: 'data-exchanges', permissions: ['console:exchanges:read'] },
  { path: '/console/services', label: '运行服务事实', english: 'Service operation facts', group: 'security', module: 'services', permissions: ['console:services:read'] },
];
function permitted(item: typeof items[number], context: ConsoleContext) {
  return context.modules.find(module => module.key === item.module && (!item.permissions || item.permissions.some(permission => module.permissions.includes(permission))));
}
export function consoleNavigation(context: ConsoleContext): ConsoleNavigationItem[] {
  const allowed = items.filter(item => permitted(item, context));
  return allowed.length ? [home, ...allowed] : [];
}
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const workflowDetail = new RegExp(`^/console/workflows/${uuid}/${uuid}$`, 'i');
export function consoleRoute(path: string, context: ConsoleContext): { status: 'allowed' | 'forbidden' | 'not-found'; item?: ConsoleNavigationItem; module?: ConsoleModule } {
  if (path === '/console' || path === '/console/') return { status: consoleNavigation(context).length ? 'allowed' : 'forbidden', item: home };
  const item = items.find(candidate => candidate.path === path || candidate.module === 'workflows' && workflowDetail.test(path));
  if (!item) return { status: 'not-found' };
  const module = permitted(item, context);
  return { status: module ? 'allowed' : 'forbidden', item, module };
}
