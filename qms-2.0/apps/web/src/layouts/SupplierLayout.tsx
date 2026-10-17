import { Drawer, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { supplierNavigation } from '../features/navigation/navigation';
import { FeedbackButton } from '../features/feedback/FeedbackButton';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';
import { AccountCenterPage } from '../features/account/AccountCenterPage';
import { SupplierQualityPage } from '../features/supplier-quality/SupplierQualityPage';
import { SupplierNotificationsPage } from '../features/supplier-notifications/SupplierNotificationsPage';
import { SupplierPcnPage } from '../features/supplier-pcn/SupplierPcnPage';
import { SupplierPerformancePortalPage } from '../features/supplier-performance/SupplierPerformancePortalPage';
import { useLanguage } from '../i18n/Language';
import { ShellHeader } from './ShellHeader';
import { UnsavedChangesProvider } from './UnsavedChanges';
import './shell.css';

export function SupplierLayout() { return <UnsavedChangesProvider><SupplierShell /></UnsavedChangesProvider>; }
function SupplierShell() {
  const { t } = useLanguage();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const active = supplierNavigation.find(item => location.pathname.startsWith(item.path)) ?? supplierNavigation[0]!;
  useEffect(() => {
    setMobileOpen(false);
    useWorkTabsStore.getState().openTab({ id: active.path, title: active.label, path: active.path });
  }, [active]);
  const navigation = <><Link className="qms-brand" to="/supplier/inbox">QMS <small>{t('供应商门户')}</small></Link><nav className="qms-domain-nav" aria-label={t('供应商导航')}>
    {supplierNavigation.map(item => <Link key={item.path} className={'qms-nav-item' + (item.path === active.path ? ' active' : '')} to={item.path} aria-current={item.path === active.path ? 'page' : undefined}><item.icon size={19} /><span>{t(item.label)}</span></Link>)}
  </nav></>;
  return <div className="qms-shell supplier-shell">
    <a className="skip-link" href="#main-content">{t('跳到正文')}</a>
    <aside className="qms-navigation"><div className="qms-primary-navigation">{navigation}</div></aside>
    <div className="qms-main"><ShellHeader onOpenNavigation={() => setMobileOpen(true)} supplier />
      <main className="qms-content" id="main-content" tabIndex={-1}>{location.pathname.startsWith('/supplier/account') ? <AccountCenterPage /> : location.pathname.startsWith('/supplier/corrections') ? <SupplierQualityPage portal /> : location.pathname.startsWith('/supplier/pcns') ? <SupplierPcnPage portal /> : location.pathname.startsWith('/supplier/performance') ? <SupplierPerformancePortalPage /> : location.pathname === '/supplier/inbox' ? <SupplierNotificationsPage /> : <section className="empty-domain"><Typography.Title level={2}>{t(active.label)}</Typography.Title><Typography.Paragraph type="secondary">{t('供应商协作基础入口已就绪，暂无业务数据。')}</Typography.Paragraph></section>}</main>
    </div>
    <Drawer title={t('供应商导航')} open={mobileOpen} placement="left" size={280} onClose={() => setMobileOpen(false)}><div className="qms-mobile-navigation">{navigation}</div></Drawer>
    <FeedbackButton />
  </div>;
}
