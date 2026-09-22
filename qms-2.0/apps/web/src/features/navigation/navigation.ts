import { ClipboardCheck, FileText, Gauge, GitBranch, Inbox, ShieldAlert, Target, UserCircle, Users, Settings } from 'lucide-react';
export type NavigationItem = { label: string; path: string; icon: typeof Inbox; context?: { label: string; path: string }[] };
export const internalNavigation: NavigationItem[] = [
  { label: '问题中心', path: '/app/problem-center', icon: ShieldAlert, context: [{ label: '问题台账', path: '/app/problem-center' }] },
  { label: '我的待办', path: '/app/my-tasks', icon: ClipboardCheck, context: [{ label: '待处理', path: '/app/my-tasks' }] },
  { label: '流程设计', path: '/app/workflow-designer', icon: GitBranch, context: [{ label: '流程草稿', path: '/app/workflow-designer' }] },
  { label: '供应商质量', path: '/app/supplier-quality', icon: Users },
  { label: '审计管理', path: '/app/audits', icon: ClipboardCheck },
  { label: '体系文件', path: '/app/documents', icon: FileText },
  { label: '风险看板', path: '/app/risk-dashboard', icon: Gauge },
  { label: '个人账号', path: '/app/account', icon: UserCircle, context: [{ label: '基本信息', path: '/app/account' }] },
  { label: '系统管理', path: '/app/admin', icon: Settings },
];
export const supplierNavigation: NavigationItem[] = [
  { label: '待办', path: '/supplier/inbox', icon: Inbox },
  { label: '整改', path: '/supplier/corrections', icon: Target },
  { label: '资料', path: '/supplier/documents', icon: FileText },
  { label: '绩效', path: '/supplier/performance', icon: Gauge },
  { label: '账号', path: '/supplier/account', icon: UserCircle },
];
export function activeInternalDomain(pathname: string) {
  if (pathname.startsWith('/app/problem-workspace')) return internalNavigation[0];
  return internalNavigation.find((item) => pathname === item.path || pathname.startsWith(`${item.path}/`));
}
