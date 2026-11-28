import { useLanguage } from '../../i18n/Language';
import { QmsLoading } from '../../components/QmsLoading';
import './eight-d-loading.module.css';

export function EightDWorkspaceLoading() {
  const { locale } = useLanguage();
  const label = locale.startsWith('en') ? 'Loading workspace' : '正在加载工作区';
  return <div data-eight-d-loading><QmsLoading size="page" label={label} /></div>;
}
