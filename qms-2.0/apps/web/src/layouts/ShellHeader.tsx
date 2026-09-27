import { Button } from 'antd';
import { ChevronRight, Menu } from 'lucide-react';
import { Link } from 'react-router-dom';
import { LanguageSwitcher, useLanguage } from '../i18n/Language';
import { AppearanceButton } from '../theme/AppearanceButton';
import { WorkTabs } from '../work-tabs/WorkTabs';
import { AnnouncementReminder } from './AnnouncementReminder';

export function ShellHeader({ title, onOpenNavigation, supplier = false }: { title: string; onOpenNavigation: () => void; supplier?: boolean }) {
  const { t } = useLanguage();
  return <header className="qms-topbar">
    <div className="qms-topbar-location">
      <Button className="qms-mobile-menu" type="text" icon={<Menu size={20} />} aria-label={t('打开导航')} onClick={onOpenNavigation} />
      <Link className="qms-home-label" to={supplier ? '/supplier/inbox' : '/app/workbench'}>{t(supplier ? '供应商门户' : '综合工作台')}</Link>
      <ChevronRight size={14} /><span>{t(title)}</span>
    </div>
    <div className="qms-topbar-actions">{!supplier && <AnnouncementReminder />}<WorkTabs mode="manager" homePath={supplier ? '/supplier/inbox' : undefined} /><LanguageSwitcher /><AppearanceButton /></div>
  </header>;
}
