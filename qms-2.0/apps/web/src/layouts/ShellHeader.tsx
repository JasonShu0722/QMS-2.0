import { Button } from 'antd';
import { Menu } from 'lucide-react';
import { Link } from 'react-router-dom';
import { LanguageSwitcher, useLanguage } from '../i18n/Language';
import { AppearanceButton } from '../theme/AppearanceButton';
import { WorkTabs } from '../work-tabs/WorkTabs';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';
import { AnnouncementReminder } from './AnnouncementReminder';
import { AccountMenu } from '../features/account/AccountMenu';

export function ShellHeader({ onOpenNavigation, supplier = false }: { onOpenNavigation: () => void; supplier?: boolean }) {
  const { t } = useLanguage();
  const hasTabs = useWorkTabsStore((state) => state.tabs.length > 0);
  return <header className="qms-topbar">
    <Button className="qms-mobile-menu" type="text" icon={<Menu size={20} />} aria-label={t('打开导航')} onClick={onOpenNavigation} />
    <div className="qms-topbar-work">
      {!hasTabs && <Link className="qms-home-label" to={supplier ? '/supplier/inbox' : '/app/workbench'}>{t(supplier ? '供应商门户' : '综合工作台')}</Link>}
      <WorkTabs mode="auto" homePath={supplier ? '/supplier/inbox' : undefined} />
    </div>
    <div className="qms-topbar-actions">{!supplier && <AnnouncementReminder />}<LanguageSwitcher /><AccountMenu supplier={supplier} /><AppearanceButton /></div>
  </header>;
}
