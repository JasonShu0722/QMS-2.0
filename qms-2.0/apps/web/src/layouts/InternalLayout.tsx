import { Drawer, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { activeInternalDomain, internalDomains } from '../features/navigation/navigation';
import { FeedbackButton } from '../features/feedback/FeedbackButton';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';
import { Workbench } from '../workbench/Workbench';
import { ProblemCenterPage } from '../features/problem-center/ProblemCenterPage';
import { MyTasksPage } from '../features/tasks/MyTasksPage';
import { ProblemWorkspacePage } from '../features/problem-workspace/ProblemWorkspacePage';
import { AccountCenterPage } from '../features/account/AccountCenterPage';
import { SupplierQualityPage } from '../features/supplier-quality/SupplierQualityPage';
import { CustomerQualityPage } from '../features/customer-quality/CustomerQualityPage';
import { AuditManagementPage } from '../features/audit-management/AuditManagementPage';
import { NewProductQualityPage } from '../features/new-product-quality/NewProductQualityPage';
import { ProcessDefectLedgerPage } from '../features/process-quality/ProcessDefectLedgerPage';
import { ProcessShipmentReportPage } from '../features/process-quality/ProcessShipmentReportPage';
import { QualityDataPage } from '../features/quality-data/QualityDataPage';
import { SupplierIncomingPage } from '../features/supplier-incoming/SupplierIncomingPage';
import { TaskStatisticsPage } from '../features/tasks/TaskStatisticsPage';
import { CoordinateInspectionPage } from '../features/coordinate-inspection/CoordinateInspectionPage';
import { SupplierPerformancePage } from '../features/supplier-performance/SupplierPerformancePage';
import { SupplierConcessionPage } from '../features/supplier-concession/SupplierConcessionPage';
import { AnnouncementsPage } from '../features/announcements/AnnouncementsPage';
import { AuditStandardsPage } from '../features/audit-standards/AuditStandardsPage';
import { SupplierAdmissionPage } from '../features/supplier-admission/SupplierAdmissionPage';
import { SupplierPcnPage } from '../features/supplier-pcn/SupplierPcnPage';
import { SiteScanningPage } from '../features/site-scanning/SiteScanningPage';
import { SupplierAuditPage } from '../features/supplier-audit/SupplierAuditPage';
import { SupplierQualityTargetsPage } from '../features/supplier-quality-targets/SupplierQualityTargetsPage';
import { SupplierPpapPage } from '../features/supplier-ppap/SupplierPpapPage';
import { SupplierAsnPage } from '../features/supplier-asn/SupplierAsnPage';
import { useLanguage } from '../i18n/Language';
import { ShellHeader } from './ShellHeader';
import { UnsavedChangesProvider } from './UnsavedChanges';
import { InternalNavigation } from './InternalNavigation';
import './shell.css';

function EmptyDomain({ title }: { title: string }) {
  const { t } = useLanguage();
  return <section className="empty-domain"><h1 className="sr-only">{title}</h1><Typography.Paragraph type="secondary">{t('待接入')}</Typography.Paragraph></section>;
}
export function InternalLayout() {
  const sessionScope = useWorkTabsStore((state) => state.sessionScope);
  return <UnsavedChangesProvider><InternalShell key={sessionScope} /></UnsavedChangesProvider>;
}
function InternalShell() {
  const { t } = useLanguage();
  const location = useLocation();
  const openTab = useWorkTabsStore((state) => state.openTab);
  const isWorkbench = location.pathname === '/app/workbench' || location.pathname === '/app';
  const active = activeInternalDomain(location.pathname);
  const [menuCollapsed, setMenuCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeDomain = internalDomains.find((domain) => domain.children.some((entry) => entry.path === active?.path));
  const [expandedDomains, setExpandedDomains] = useState<string[]>(() => activeDomain ? [activeDomain.path] : []);
  const problemRoute = /^\/app\/problem-workspace\/([0-9a-f-]{36})$/i.exec(location.pathname);
  const processPath = location.pathname.replace(/\/$/, '');
  const implemented = ['/app/problem-center', '/app/my-tasks', '/app/problem-workspace', '/app/account', '/app/supplier-quality', '/app/supplier-incoming', '/app/supplier-concession', '/app/supplier-admission', '/app/supplier-pcn', '/app/supplier-performance', '/app/supplier-audit', '/app/supplier-quality-targets', '/app/supplier-ppap', '/app/supplier-asn', '/app/process-quality', '/app/customer-quality', '/app/audits', '/app/audit-standards', '/app/new-product-quality', '/app/quality-data', '/app/task-statistics', '/app/announcements', '/app/coordinate-inspection', '/app/site-scanning'].some((path) => location.pathname.startsWith(path));
  useEffect(() => {
    if (activeDomain) setExpandedDomains(current => current.includes(activeDomain.path) ? current : [...current, activeDomain.path]);
  }, [location, activeDomain]);
  useEffect(() => {
    setMobileOpen(false);
    const store = useWorkTabsStore.getState();
    if (isWorkbench) { store.deactivate(); return; }
    if (!active) return;
    const path = `${location.pathname}${location.search}`;
    const id = problemRoute ? `problem:${problemRoute[1]}` : location.pathname;
    const existing = store.tabs.find((tab) => tab.id === id);
    const title = problemRoute ? existing?.title ?? `${t('问题处理')} · ${problemRoute[1]!.slice(0, 8)}` : active.label;
    openTab({ id, path, title });
  }, [location.pathname, location.search, isWorkbench, active, openTab, t]);
  const navigation = (mobile = false) => <InternalNavigation activePath={active?.path} isWorkbench={isWorkbench} collapsed={!mobile && menuCollapsed} expandedDomains={expandedDomains} onToggleCollapsed={mobile ? undefined : () => setMenuCollapsed(current => !current)} onToggleDomain={path => {
    setExpandedDomains(current => {
      if (!current.includes(path)) return [...current, path];
      if (!mobile && menuCollapsed) return current;
      return current.filter(entry => entry !== path);
    });
    if (!mobile) setMenuCollapsed(false);
  }} />;
  return <div className={`qms-shell internal-shell${menuCollapsed ? ' menu-collapsed' : ''}`}>
    <a className="skip-link" href="#main-content">{t('跳到正文')}</a>
    <aside className="qms-navigation">
      <div className="qms-primary-navigation">{navigation()}</div>
    </aside>
    <div className="qms-main">
      <ShellHeader onOpenNavigation={() => setMobileOpen(true)} />
      <main className="qms-content" id="main-content" tabIndex={-1}>
        {isWorkbench ? <Workbench /> : null}
        {!isWorkbench && active && !implemented ? <EmptyDomain title={t(active.label)} /> : null}
        {location.pathname.startsWith('/app/problem-center') ? <ProblemCenterPage /> : null}
        {location.pathname.startsWith('/app/my-tasks') ? <MyTasksPage /> : null}
        {location.pathname.startsWith('/app/problem-workspace') ? <ProblemWorkspacePage key={problemRoute?.[1]} problemId={problemRoute?.[1]} /> : null}
        {location.pathname.startsWith('/app/account') ? <AccountCenterPage /> : null}
        {location.pathname === '/app/supplier-quality' || location.pathname.startsWith('/app/supplier-quality/') ? <SupplierQualityPage /> : null}
        {location.pathname.startsWith('/app/supplier-incoming') ? <SupplierIncomingPage /> : null}
        {location.pathname.startsWith('/app/supplier-concession') ? <SupplierConcessionPage /> : null}
        {location.pathname.startsWith('/app/supplier-admission') ? <SupplierAdmissionPage /> : null}
        {location.pathname.startsWith('/app/supplier-pcn') ? <SupplierPcnPage /> : null}
        {location.pathname.startsWith('/app/supplier-performance') ? <SupplierPerformancePage /> : null}
        {location.pathname.startsWith('/app/supplier-audit') ? <SupplierAuditPage /> : null}
        {location.pathname.startsWith('/app/supplier-quality-targets') ? <SupplierQualityTargetsPage /> : null}
        {location.pathname.startsWith('/app/supplier-ppap') ? <SupplierPpapPage /> : null}
        {location.pathname.startsWith('/app/supplier-asn') ? <SupplierAsnPage /> : null}
        {processPath === '/app/process-quality' ? <ProcessDefectLedgerPage /> : null}
        {processPath === '/app/process-quality/problems' ? <ProblemCenterPage processQuality /> : null}
        {processPath === '/app/process-quality/shipment-reports' ? <ProcessShipmentReportPage /> : null}
        {processPath === '/app/customer-quality' ? <CustomerQualityPage /> : null}
        {processPath === '/app/customer-quality/problems' ? <ProblemCenterPage eightDDomain="customer-quality" /> : null}
        {location.pathname.startsWith('/app/audits') ? <AuditManagementPage /> : null}
        {location.pathname.startsWith('/app/audit-standards') ? <AuditStandardsPage /> : null}
        {processPath === '/app/new-product-quality' ? <NewProductQualityPage /> : null}
        {processPath === '/app/new-product-quality/problems' ? <ProblemCenterPage eightDDomain="new-product-quality" /> : null}
        {location.pathname.startsWith('/app/quality-data') ? <QualityDataPage /> : null}
        {location.pathname.startsWith('/app/task-statistics') ? <TaskStatisticsPage /> : null}
        {location.pathname.startsWith('/app/announcements') ? <AnnouncementsPage /> : null}
        {location.pathname.startsWith('/app/coordinate-inspection') ? <CoordinateInspectionPage /> : null}
        {location.pathname.startsWith('/app/site-scanning') ? <SiteScanningPage /> : null}
      </main>
    </div>
    <Drawer title={t('业务导航')} open={mobileOpen} placement="left" size={280} onClose={() => setMobileOpen(false)}><div className="qms-mobile-navigation">{navigation(true)}</div></Drawer>
    <FeedbackButton />
  </div>;
}
