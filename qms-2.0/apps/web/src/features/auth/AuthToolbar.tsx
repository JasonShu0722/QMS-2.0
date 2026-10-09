import { useLocation } from 'react-router-dom';
import { LanguageSwitcher, useLanguage } from '../../i18n/Language';
import { AppearanceButton } from '../../theme/AppearanceButton';
import './AuthToolbar.css';

export function AuthToolbar() {
  const { pathname } = useLocation();
  const { t } = useLanguage();
  if (pathname.startsWith('/app') || pathname.startsWith('/supplier')) return null;
  return <div className="qms-auth-toolbar" role="group" aria-label={`Language / 语言 · ${t('外观设置')}`}>
    <LanguageSwitcher /><AppearanceButton compact />
  </div>;
}
