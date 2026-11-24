import type { components } from '@qms/contracts';
import { Activity, ArrowLeftRight, Bot, Building2, ClipboardList, ContactRound, Database, Factory, GitBranch, History, KeyRound, LayoutDashboard, Link2, ListRestart, MessageSquareText, Package, Plug, Server, Settings, ShieldCheck, SlidersHorizontal, Users, type LucideIcon } from 'lucide-react';

export type ConsoleContext = components['schemas']['ConsoleContextDto'];
export type ConsoleModule = components['schemas']['ConsoleModuleDto'];
export const consoleGroups = [
  { key: 'administration', label: '组织与授权', english: 'Organizations & access', icon: Building2 },
  { key: 'api-access', label: 'API 接入', english: 'API access', icon: Plug },
  { key: 'master-data', label: '主数据', english: 'Master data', icon: Database },
  { key: 'configuration', label: '平台与流程配置', english: 'Platform & workflow configuration', icon: SlidersHorizontal },
  { key: 'ai', label: 'AI 管理', english: 'AI management', icon: Bot },
  { key: 'security', label: '安全与运行', english: 'Security & operations', icon: ShieldCheck },
] as const;
export type ConsoleNavigationItem = { path: string; label: string; english: string; group: 'workspace' | typeof consoleGroups[number]['key']; icon: LucideIcon; module?: ConsoleModule['key'] };
const home: ConsoleNavigationItem = { path: '/console', label: '管理首页', english: 'Management home', group: 'workspace', icon: LayoutDashboard };
const items: (ConsoleNavigationItem & { permissions?: string[] })[] = [
  { path: '/console/api-ingestion', label: 'API入库衔接', english: 'API data ingestion', group: 'api-access', icon: ArrowLeftRight, module: 'api-ingestion', permissions: ['ingestion:read', 'ingestion:manage', 'ingestion:run'] },
  { path: '/console/api-integrations', label: 'API接口管理', english: 'API integrations', group: 'api-access', icon: Plug, module: 'api-integrations', permissions: ['integration:read', 'integration:receipts:read'] },
  { path: '/console/users', label: '用户与任职', english: 'Users & appointments', group: 'administration', icon: Users, module: 'users' },
  { path: '/console/organizations', label: '组织与岗位', english: 'Organizations & positions', group: 'administration', icon: Building2, module: 'organizations' },
  { path: '/console/supplier-accounts', label: '供应商账号', english: 'Supplier accounts', group: 'administration', icon: KeyRound, module: 'supplier-accounts' },
  { path: '/console/reconfiguration', label: '待配置管理', english: 'Pending configuration', group: 'administration', icon: ClipboardList, module: 'reconfiguration' },
  { path: '/console/problem-reconfiguration', label: '问题责任恢复', english: 'Problem responsibility recovery', group: 'administration', icon: History, module: 'problem-reconfiguration' },
  { path: '/console/master-data/suppliers', label: '供应商档案', english: 'Supplier profiles', group: 'master-data', icon: Factory, module: 'master-data', permissions: ['supplier-quality:profiles:read', 'supplier-quality:profiles:write'] },
  { path: '/console/master-data/customers', label: '客户档案', english: 'Customer profiles', group: 'master-data', icon: ContactRound, module: 'master-data', permissions: ['customer-quality:complaints:read', 'customer-quality:complaints:write'] },
  { path: '/console/master-data/materials', label: '物料主数据', english: 'Material master', group: 'master-data', icon: Package, module: 'master-data', permissions: ['material-master:read', 'material-master:write', 'material-master:import'] },
  { path: '/console/master-data/component-projects', label: '组件项目映射', english: 'Component project mapping', group: 'master-data', icon: Link2, module: 'master-data', permissions: ['component-project:read', 'component-project:manage'] },
  { path: '/console/master-data/projects', label: '项目清单', english: 'Projects', group: 'master-data', icon: ClipboardList, module: 'master-data', permissions: ['component-project:read'] },
  { path: '/console/master-data/operations', label: '工序主数据', english: 'Operation master', group: 'master-data', icon: Factory, module: 'master-data', permissions: ['process-quality:configuration:read'] },
  { path: '/console/configuration', label: '平台配置', english: 'Platform configuration', group: 'configuration', icon: Settings, module: 'configuration' },
  { path: '/console/ai-connections', label: '模型渠道', english: 'Model channels', group: 'ai', icon: Bot, module: 'ai-connections', permissions: ['ai:connections:read'] },
  { path: '/console/ai-applications', label: '提示词应用', english: 'Prompt applications', group: 'ai', icon: MessageSquareText, module: 'ai-applications', permissions: ['ai:applications:read'] },
  { path: '/console/workflows', label: '流程管理', english: 'Workflow management', group: 'configuration', icon: GitBranch, module: 'workflows', permissions: ['workflow:manage'] },
  { path: '/console/eight-d-bindings', label: '8D 流程绑定', english: '8D workflow bindings', group: 'configuration', icon: Link2, module: 'workflows', permissions: ['workflow:manage'] },
  { path: '/console/audit-log', label: '管理审计', english: 'Management audit', group: 'security', icon: ClipboardList, module: 'audit' },
  { path: '/console/outbox', label: '失败队列', english: 'Failed events', group: 'security', icon: ListRestart, module: 'outbox' },
  { path: '/console/api-monitoring', label: 'API 技术观测', english: 'API observations', group: 'security', icon: Activity, module: 'api-monitoring', permissions: ['console:api:read'] },
  { path: '/console/data-exchanges', label: '数据交换观测', english: 'Data exchange observations', group: 'security', icon: ArrowLeftRight, module: 'data-exchanges', permissions: ['console:exchanges:read'] },
  { path: '/console/services', label: '运行服务事实', english: 'Service operation facts', group: 'security', icon: Server, module: 'services', permissions: ['console:services:read'] },
];
function permitted(item: typeof items[number], context: ConsoleContext) {
  return context.modules.find(module => module.key === item.module && (!item.permissions || item.permissions.some(permission => module.permissions.includes(permission))));
}
export function consoleNavigation(context: ConsoleContext): ConsoleNavigationItem[] {
  const allowed = items.filter(item => permitted(item, context));
  return allowed.length ? [home, ...allowed] : [];
}
export function consoleRoute(path: string, context: ConsoleContext): { status: 'allowed' | 'forbidden' | 'not-found'; item?: ConsoleNavigationItem; module?: ConsoleModule } {
  if (path === '/console' || path === '/console/') return { status: consoleNavigation(context).length ? 'allowed' : 'forbidden', item: home };
  const item = items.find(candidate => candidate.path === path);
  if (!item) return { status: 'not-found' };
  const module = permitted(item, context);
  return { status: module ? 'allowed' : 'forbidden', item, module };
}
