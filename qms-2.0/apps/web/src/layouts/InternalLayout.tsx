import { Alert, Button, Drawer, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { House, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { activeInternalDomain, internalNavigation } from '../features/navigation/navigation';
import { WorkTabs } from '../work-tabs/WorkTabs';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';
import { Workbench } from '../workbench/Workbench';
import { ProblemCenterPage } from '../features/problem-center/ProblemCenterPage';
import { MyTasksPage } from '../features/tasks/MyTasksPage';
import { WorkflowDesignerPage } from '../features/workflows/WorkflowDesignerPage';
import { WorkflowListPage } from '../features/workflows/WorkflowListPage';
import { ProblemWorkspacePage } from '../features/problem-workspace/ProblemWorkspacePage';
import { AccountCenterPage } from '../features/account/AccountCenterPage';
import { AdminPage } from '../features/admin/AdminPage';
import { SupplierQualityPage } from '../features/supplier-quality/SupplierQualityPage';
import { getAdminOrganizations, type AdminOrganization } from '../features/admin/admin';
import { ApiError, safeAccountError } from '../api/client';
import { useLanguage } from '../i18n/Language';
import { ShellHeader } from './ShellHeader';
import { UnsavedChangesProvider } from './UnsavedChanges';
import './shell.css';

function EmptyDomain({ title }: { title: string }) {
  const { t } = useLanguage();
  return <section className="empty-domain"><Typography.Title level={2}>{title}</Typography.Title><Typography.Paragraph type="secondary">{t('基础入口已就绪，业务功能将在后续阶段接入。')}</Typography.Paragraph></section>;
}
export function InternalLayout() { return <UnsavedChangesProvider><InternalShell /></UnsavedChangesProvider>; }
function InternalShell() {
  const { t } = useLanguage();
  const location = useLocation();
  const openTab = useWorkTabsStore((state) => state.openTab);
  const isWorkbench = location.pathname === '/app/workbench' || location.pathname === '/app';
  const active = activeInternalDomain(location.pathname);
  const [menuCollapsed, setMenuCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [organizations, setOrganizations] = useState<AdminOrganization[] | null>(null);
  const [adminError, setAdminError] = useState<string>();
  const [adminTraceId, setAdminTraceId] = useState<string>();
  const [directoryRevision, setDirectoryRevision] = useState(0);
  const isAdmin = location.pathname.startsWith('/app/admin');
  const workflowRoute = /^\/app\/workflow-designer\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/i.exec(location.pathname);
  const problemRoute = /^\/app\/problem-workspace\/([0-9a-f-]{36})$/i.exec(location.pathname);
  const implemented = ['/app/problem-center', '/app/my-tasks', '/app/workflow-designer', '/app/problem-workspace', '/app/account', '/app/admin', '/app/supplier-quality'].some((path) => location.pathname.startsWith(path));
  useEffect(() => {
    let current = true;
    void getAdminOrganizations().then((result) => { if (current) { setOrganizations(result); setAdminError(undefined); setAdminTraceId(undefined); } }).catch((cause) => { if (current) { setAdminError(safeAccountError(cause)); setAdminTraceId(cause instanceof ApiError ? cause.traceId : undefined); } });
    return () => { current = false; };
  }, [directoryRevision]);
  useEffect(() => {
    setMobileOpen(false);
    const store = useWorkTabsStore.getState();
    if (isWorkbench) { setMenuCollapsed(false); store.deactivate(); return; }
    if (!active || isAdmin && !organizations?.length) return;
    const path = `${location.pathname}${location.search}`;
    const id = problemRoute ? `problem:${problemRoute[1]}` : location.pathname;
    const existing = store.tabs.find((tab) => tab.id === id);
    const title = problemRoute ? `${t('问题处理')} · ${problemRoute[1]!.slice(0, 8)}` : workflowRoute ? `${t('流程编辑')} · ${workflowRoute[2]!.slice(0, 8)}` : active.label;
    openTab({ id, path, title: existing?.title ?? title });
  }, [location.pathname, location.search, isWorkbench, active, isAdmin, organizations, openTab]);
  const navigation = (mobile = false) => <>
    <Link className="qms-brand" to="/app/workbench" aria-label="QMS 2.0"><span className="qms-brand-symbol">Q</span>{(isWorkbench || mobile) && <span>QMS <small>2.0</small></span>}</Link>
    <nav className="qms-domain-nav" aria-label={t(isWorkbench || mobile ? '内部领域导航' : '内部领域图标导航')}>
      <Link className={`qms-nav-item${isWorkbench ? ' active' : ''}`} to="/app/workbench" title={t('综合工作台')} aria-current={isWorkbench ? 'page' : undefined}><House size={19} /><span className={!isWorkbench && !mobile ? 'sr-only' : ''}>{t('综合工作台')}</span></Link>
      {internalNavigation.filter((item) => item.path !== '/app/admin' || !!organizations?.length).map((item) => {
        const Icon = item.icon;
        return <Link className={`qms-nav-item${item.path === active?.path ? ' active' : ''}`} key={item.path} to={item.path} title={t(item.label)} aria-current={item.path === active?.path ? 'page' : undefined}><Icon size={19} /><span className={!isWorkbench && !mobile ? 'sr-only' : ''}>{t(item.label)}</span></Link>;
      })}
    </nav>
  </>;
  return <div className={`qms-shell${!isWorkbench ? ' in-domain' : ''}${menuCollapsed ? ' menu-collapsed' : ''}`}>
    <a className="skip-link" href="#main-content">{t('跳到正文')}</a>
    <aside className="qms-navigation">
      <div className="qms-primary-navigation">{navigation()}{!isWorkbench && menuCollapsed && <Button className="qms-expand-menu" type="text" icon={<PanelLeftOpen size={19} />} aria-label={t('展开业务菜单')} title={t('展开业务菜单')} onClick={() => setMenuCollapsed(false)} />}</div>
      {!isWorkbench && !menuCollapsed && active && <aside className="qms-domain-context">
        <div className="qms-context-heading"><strong>{t(active.label)}</strong><Button type="text" icon={<PanelLeftClose size={17} />} aria-label={t('收起业务菜单')} onClick={() => setMenuCollapsed(true)} /></div>
        <nav aria-label={`${t(active.label)} ${t('上下文菜单')}`}>
          {(active.context ?? (isAdmin ? [] : [{ label: active.label, path: active.path }])).map((entry) => <Link className="qms-context-link" key={entry.path} to={entry.path} aria-current={location.pathname === entry.path ? 'page' : undefined}>{t(entry.label)}</Link>)}
          {problemRoute && <span className="qms-context-current">{t('问题处理')}</span>}
          {workflowRoute && <span className="qms-context-current">{t('流程编辑')}</span>}
        </nav>
      </aside>}
    </aside>
    <div className="qms-main">
      <ShellHeader title={isWorkbench ? '质量管理平台' : active?.label ?? '工作页'} onOpenNavigation={() => setMobileOpen(true)} />
      <WorkTabs mode="strip" />
      <main className="qms-content" id="main-content" tabIndex={-1}>
        {adminError && !isAdmin ? <Alert type="error" role="alert" title={`${t('管理权限加载失败')}: ${t(adminError)}`} description={adminTraceId ? <code>{adminTraceId}</code> : undefined} /> : null}
        {isWorkbench ? <Workbench /> : null}
        {!isWorkbench && active && !implemented ? <EmptyDomain title={t(active.label)} /> : null}
        {location.pathname.startsWith('/app/problem-center') ? <ProblemCenterPage /> : null}
        {location.pathname.startsWith('/app/my-tasks') ? <MyTasksPage /> : null}
        {location.pathname.startsWith('/app/workflow-designer') ? workflowRoute ? <WorkflowDesignerPage definitionId={workflowRoute[1]!} versionId={workflowRoute[2]!} /> : <WorkflowListPage /> : null}
        {location.pathname.startsWith('/app/problem-workspace') ? <ProblemWorkspacePage key={problemRoute?.[1]} problemId={problemRoute?.[1]} /> : null}
        {location.pathname.startsWith('/app/account') ? <AccountCenterPage /> : null}
        {location.pathname.startsWith('/app/supplier-quality') ? <SupplierQualityPage /> : null}
        {isAdmin ? <AdminPage organizations={organizations} error={adminError} traceId={adminTraceId} onDirectoryChange={() => setDirectoryRevision((value) => value + 1)} /> : null}
      </main>
    </div>
    <Drawer title={t('业务导航')} open={mobileOpen} placement="left" size={280} onClose={() => setMobileOpen(false)}><div className="qms-mobile-navigation">{navigation(true)}</div></Drawer>
  </div>;
}
