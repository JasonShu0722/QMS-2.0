import { Button } from 'antd';
import { Menu } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useLanguage } from '../i18n/Language';
import { TopbarLanguageSwitcher } from '../i18n/TopbarLanguageSwitcher';
import { AppearanceButton } from '../theme/AppearanceButton';
import { WorkTabs } from '../work-tabs/WorkTabs';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';
import { AnnouncementReminder } from './AnnouncementReminder';
import { AccountMenu } from '../features/account/AccountMenu';

export function ShellHeader({ onOpenNavigation, supplier = false }: { onOpenNavigation: () => void; supplier?: boolean }) {
  const { t } = useLanguage();
  const location = useLocation();
  const isWorkbench = location.pathname === '/app' || location.pathname === '/app/workbench';
  const hasTabs = useWorkTabsStore((state) => state.tabs.length > 0);
  const activeTab = useWorkTabsStore((state) => state.tabs.find((tab) => tab.id === state.activeTabId));
  const shouldShowStrip = useWorkTabsStore((state) => state.shouldShowStrip);
  return <header className="qms-topbar">
    <Button className="qms-mobile-menu" type="text" icon={<Menu size={20} />} aria-label={t('打开导航')} onClick={onOpenNavigation} />
    <div className="qms-topbar-work">
      {!hasTabs && <Link className="qms-home-label" to={supplier ? '/supplier/inbox' : '/app/workbench'}>{t(supplier ? '供应商门户' : '综合工作台')}</Link>}
      {!supplier && hasTabs && !activeTab && isWorkbench && <span className="qms-home-label" style={{ flex: 1 }}>{t('综合工作台')}</span>}
      {!supplier && activeTab && !shouldShowStrip && <span className="qms-home-label" style={{ flex: 1 }} title={t(activeTab.title)}>{t(activeTab.title)}</span>}
      <WorkTabs mode="auto" homePath={supplier ? '/supplier/inbox' : undefined} />
    </div>
    <div className="qms-topbar-actions">{!supplier && <AnnouncementReminder />}<TopbarLanguageSwitcher /><AppearanceButton /><AccountMenu supplier={supplier} /></div>
  </header>;
}
