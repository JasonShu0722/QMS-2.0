import { Button } from 'antd';
import { ChevronDown, House, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useId } from 'react';
import { Link } from 'react-router-dom';
import { internalDomains } from '../features/navigation/navigation';
import { useLanguage } from '../i18n/Language';

type InternalNavigationProps = {
  activePath?: string;
  isWorkbench: boolean;
  collapsed?: boolean;
  expandedDomains: string[];
  onToggleDomain: (path: string) => void;
  onToggleCollapsed?: () => void;
};

export function InternalNavigation({ activePath, isWorkbench, collapsed = false, expandedDomains, onToggleDomain, onToggleCollapsed }: InternalNavigationProps) {
  const { t } = useLanguage();
  const id = useId();
  return <>
    <div className="qms-navigation-heading">
      <Link className="qms-brand" to="/app/workbench" aria-label="QMS 2.0"><span className="qms-brand-symbol">Q</span><span className={collapsed ? 'sr-only' : ''}>QMS <small>2.0</small></span></Link>
      {onToggleCollapsed && <Button type="text" icon={collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />} aria-label={t(collapsed ? '展开业务菜单' : '收起业务菜单')} title={t(collapsed ? '展开业务菜单' : '收起业务菜单')} onClick={onToggleCollapsed} />}
    </div>
    <nav className="qms-domain-nav" aria-label={t(collapsed ? '内部领域图标导航' : '内部领域导航')}>
      <Link className={`qms-nav-item${isWorkbench ? ' active' : ''}`} to="/app/workbench" title={t('综合工作台')} aria-current={isWorkbench ? 'page' : undefined}><House size={19} aria-hidden="true" /><span className={collapsed ? 'sr-only' : ''}>{t('综合工作台')}</span></Link>
      {internalDomains.map((domain, index) => {
        const selected = domain.children.some(entry => entry.path === activePath);
        const expanded = !collapsed && expandedDomains.includes(domain.path);
        const entriesId = `${id}-domain-${index}`;
        return <div className="qms-navigation-domain" key={domain.path}>
          <button type="button" className={`qms-nav-item qms-domain-toggle${selected ? ' active' : ''}`} title={t(domain.label)} aria-expanded={expanded} aria-controls={entriesId} onClick={() => onToggleDomain(domain.path)}>
            <domain.icon size={19} aria-hidden="true" /><span className={collapsed ? 'sr-only' : ''}>{t(domain.label)}</span>{!collapsed && <ChevronDown className="qms-domain-chevron" size={16} aria-hidden="true" />}
          </button>
          <nav id={entriesId} className="qms-domain-entries" aria-label={`${t(domain.label)} ${t('上下文菜单')}`} hidden={!expanded}>
            {domain.children.map(entry => <Link className="qms-context-link" key={entry.path} to={entry.path} aria-current={entry.path === activePath ? 'page' : undefined}>{t(entry.label)}</Link>)}
          </nav>
        </div>;
      })}
    </nav>
  </>;
}
