import {
  ClipboardCheck,
  FileText,
  Gauge,
  GitBranch,
  Inbox,
  ShieldAlert,
  Target,
  UserCircle,
  Users,
  Settings,
} from 'lucide-react';

export type NavigationItem = {
  label: string;
  path: string;
  icon: typeof Inbox;
  context?: string[];
};

export const internalNavigation: NavigationItem[] = [
  { label: '问题中心', path: '/app/problem-center', icon: ShieldAlert, context: ['问题台账', 'CAPA', '复盘'] },
  { label: '我的待办', path: '/app/my-tasks', icon: ClipboardCheck, context: ['待处理', '逾期', '失败重试'] },
  { label: '流程设计', path: '/app/workflow-designer', icon: GitBranch, context: ['流程草稿', '发布记录'] },
  { label: '供应商质量', path: '/app/supplier-quality', icon: Users, context: ['准入', '绩效', '整改'] },
  { label: '审计管理', path: '/app/audits', icon: ClipboardCheck, context: ['计划', '发现项', '报告'] },
  { label: '体系文件', path: '/app/documents', icon: FileText, context: ['文件库', '评审', '分发'] },
  { label: '风险看板', path: '/app/risk-dashboard', icon: Gauge, context: ['风险矩阵', '预警规则'] },
  { label: '个人账号', path: '/app/account', icon: UserCircle, context: ['基本信息', '修改密码', '登录会话'] },
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
  return internalNavigation.find((item) => pathname.startsWith(item.path));
}

