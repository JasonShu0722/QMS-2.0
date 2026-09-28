import { BarChart3, ClipboardCheck, FileText, Gauge, GitBranch, Inbox, ShieldAlert, Target, UserCircle, Users, Settings, MessageSquareWarning, ScanLine, Ruler, BadgeCheck, Megaphone, Repeat2, Scan } from 'lucide-react';
export type NavigationItem = { label: string; path: string; icon: typeof Inbox; context?: { label: string; path: string }[] };
export const internalNavigation: NavigationItem[] = [
  { label: '问题中心', path: '/app/problem-center', icon: ShieldAlert, context: [{ label: '问题台账', path: '/app/problem-center' }] },
  { label: '我的待办', path: '/app/my-tasks', icon: ClipboardCheck, context: [{ label: '待处理', path: '/app/my-tasks' }] },
  { label: '流程设计', path: '/app/workflow-designer', icon: GitBranch, context: [{ label: '流程草稿', path: '/app/workflow-designer' }] },
  { label: '供应商质量', path: '/app/supplier-quality', icon: Users },
  { label: '来料检验', path: '/app/supplier-incoming', icon: ScanLine, context: [{ label: '来料检验台账', path: '/app/supplier-incoming' }] },
  { label: '特采管理', path: '/app/supplier-concession', icon: BadgeCheck, context: [{ label: '特采申请', path: '/app/supplier-concession' }] },
  { label: '供应商质量资料', path: '/app/supplier-admission', icon: FileText, context: [{ label: '资料提交与审核', path: '/app/supplier-admission' }] },
  { label: 'PCN 变更', path: '/app/supplier-pcn', icon: Repeat2, context: [{ label: '供应商变更申报与审批', path: '/app/supplier-pcn' }] },
  { label: '供应商绩效', path: '/app/supplier-performance', icon: BarChart3, context: [{ label: '月度绩效卡', path: '/app/supplier-performance' }] },
  { label: '供应商审核', path: '/app/supplier-audit', icon: ClipboardCheck, context: [{ label: '审核记录', path: '/app/supplier-audit' }] },
  { label: '供应商质量目标', path: '/app/supplier-quality-targets', icon: Target, context: [{ label: '目标与实际', path: '/app/supplier-quality-targets' }] },
  { label: '供应商 PPAP', path: '/app/supplier-ppap', icon: FileText, context: [{ label: '资料包审核', path: '/app/supplier-ppap' }] },
  { label: '供应商 ASN', path: '/app/supplier-asn', icon: Inbox, context: [{ label: '发运通知', path: '/app/supplier-asn' }] },
  { label: '制程质量', path: '/app/process-quality', icon: Target, context: [{ label: '不良品台账', path: '/app/process-quality' }] },
  { label: '客户质量', path: '/app/customer-quality', icon: MessageSquareWarning, context: [{ label: '客诉台账', path: '/app/customer-quality' }] },
  { label: '审计管理', path: '/app/audits', icon: ClipboardCheck, context: [{ label: '审核计划', path: '/app/audits' }] },
  { label: '审核标准库', path: '/app/audit-standards', icon: ClipboardCheck, context: [{ label: '标准目录', path: '/app/audit-standards' }] },
  { label: '新品质量', path: '/app/new-product-quality', icon: Target, context: [{ label: '项目质量台账', path: '/app/new-product-quality' }] },
  { label: '质量数据', path: '/app/quality-data', icon: Gauge, context: [{ label: '指标趋势', path: '/app/quality-data' }] },
  { label: '任务统计', path: '/app/task-statistics', icon: BarChart3, context: [{ label: '任务统计', path: '/app/task-statistics' }] },
  { label: '公告', path: '/app/announcements', icon: Megaphone, context: [{ label: '公告与阅读记录', path: '/app/announcements' }] },
  { label: '三坐标检测', path: '/app/coordinate-inspection', icon: Ruler, context: [{ label: '检测申请', path: '/app/coordinate-inspection' }] },
  { label: '现场扫码', path: '/app/site-scanning', icon: Scan, context: [{ label: '关键件条码校验', path: '/app/site-scanning' }] },
  { label: '体系文件', path: '/app/documents', icon: FileText },
  { label: '风险看板', path: '/app/risk-dashboard', icon: Gauge },
  { label: '个人账号', path: '/app/account', icon: UserCircle, context: [{ label: '基本信息', path: '/app/account' }] },
  { label: '系统管理', path: '/app/admin', icon: Settings },
];
export const internalDomains = [
  { label: '问题与改进', path: '/app/problem-center', icon: ShieldAlert, paths: ['/app/problem-center', '/app/my-tasks', '/app/workflow-designer'] },
  { label: '供应商质量', path: '/app/supplier-quality', icon: Users, paths: ['/app/supplier-quality', '/app/supplier-incoming', '/app/supplier-concession', '/app/supplier-admission', '/app/supplier-pcn', '/app/supplier-performance', '/app/supplier-audit', '/app/supplier-quality-targets', '/app/supplier-ppap', '/app/supplier-asn'] },
  { label: '制程质量', path: '/app/process-quality', icon: Target, paths: ['/app/process-quality', '/app/site-scanning'] },
  { label: '客户质量', path: '/app/customer-quality', icon: MessageSquareWarning, paths: ['/app/customer-quality'] },
  { label: '新品质量', path: '/app/new-product-quality', icon: Target, paths: ['/app/new-product-quality'] },
  { label: '审核管理', path: '/app/audits', icon: ClipboardCheck, paths: ['/app/audits', '/app/audit-standards'] },
  { label: '质量分析', path: '/app/quality-data', icon: Gauge, paths: ['/app/quality-data', '/app/task-statistics', '/app/risk-dashboard'] },
  { label: '检测管理', path: '/app/coordinate-inspection', icon: Ruler, paths: ['/app/coordinate-inspection'] },
  { label: '知识与公告', path: '/app/documents', icon: FileText, paths: ['/app/documents', '/app/announcements'] },
  { label: '个人账号', path: '/app/account', icon: UserCircle, paths: ['/app/account'] },
  { label: '系统管理', path: '/app/admin', icon: Settings, paths: ['/app/admin'] },
].map(({ paths, ...domain }) => ({ ...domain, children: internalNavigation.filter((entry) => paths.includes(entry.path)) }));
export const supplierNavigation: NavigationItem[] = [
  { label: '待办', path: '/supplier/inbox', icon: Inbox },
  { label: '整改', path: '/supplier/corrections', icon: Target },
  { label: '资料', path: '/supplier/documents', icon: FileText },
  { label: 'PCN 变更', path: '/supplier/pcns', icon: Repeat2 },
  { label: '绩效', path: '/supplier/performance', icon: Gauge },
  { label: '账号', path: '/supplier/account', icon: UserCircle },
];
export function activeInternalDomain(pathname: string) {
  if (pathname.startsWith('/app/problem-workspace')) return internalNavigation[0];
  return internalNavigation.find((item) => pathname === item.path || pathname.startsWith(`${item.path}/`));
}
