import { Button, Drawer, Empty, Input } from 'antd';
import { ArrowUpRight, List, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useWorkTabsStore, type WorkTab } from './workTabsStore';
import { useLanguage } from '../i18n/Language';
import { useNavigationGuard } from '../layouts/UnsavedChanges';
import './work-tabs.css';

export function WorkTabs({ mode = 'auto', homePath = '/app/workbench' }: { mode?: 'auto' | 'strip' | 'manager'; homePath?: string }) {
  const { t } = useLanguage();
  const { tabs, activeTabId, closeTab, openTab, overflowTabs, shouldShowStrip, visibleTabs, setStripWidth } = useWorkTabsStore();
  const navigate = useNavigate();
  const requestLeave = useNavigationGuard();
  const strip = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const visible = tabs.length > 0 && !(mode === 'strip' && !shouldShowStrip) && !(mode === 'manager' && shouldShowStrip);
  useEffect(() => {
    const element = strip.current;
    if (!element || !shouldShowStrip || mode === 'manager') return;
    const measure = () => { const width = element.getBoundingClientRect().width; if (width > 0) setStripWidth(width); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [shouldShowStrip, mode, setStripWidth]);
  function activateAndNavigate(tab: WorkTab) {
    const activate = () => { openTab(tab); navigate(tab.path); setOpen(false); };
    if (tab.id === activeTabId) activate(); else requestLeave(activate);
  }
  function closeAndNavigate(tabId: string) {
    const wasActive = useWorkTabsStore.getState().activeTabId === tabId;
    const close = () => {
      closeTab(tabId);
      if (!wasActive) return;
      const state = useWorkTabsStore.getState();
      const restored = state.tabs.find((tab) => tab.id === state.activeTabId);
      navigate(restored?.path ?? homePath, { replace: true });
    };
    if (wasActive) requestLeave(close, true); else close();
  }
  if (!visible) return null;
  const results = tabs.filter((tab) => `${t(tab.title)} ${tab.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <>
    <nav ref={strip} className={shouldShowStrip ? 'qms-work-tabs' : 'qms-work-tab-manager'} aria-label={t(shouldShowStrip ? '工作标签' : '工作页')}>
      {shouldShowStrip && <div className="qms-visible-tabs">{visibleTabs.map((tab) => <div className={`qms-work-tab${tab.id === activeTabId ? ' active' : ''}`} key={tab.id}>
        <Link to={tab.path} title={t(tab.title)} aria-current={tab.id === activeTabId ? 'page' : undefined} onClick={(event) => {
          if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
          event.preventDefault(); activateAndNavigate(tab);
        }}>{t(tab.title)}</Link>
        <Button aria-label={`${t('关闭')} ${t(tab.title)}`} icon={<X size={13} />} size="small" type="text" onClick={() => closeAndNavigate(tab.id)} />
      </div>)}</div>}
      <Button className="qms-all-tabs" aria-label={t('全部标签')} icon={<List size={15} />} type="text" onClick={() => setOpen(true)}>
        <span>{t('全部已打开')}</span><span>{overflowTabs.length && shouldShowStrip ? `+${overflowTabs.length}` : tabs.length}</span>
      </Button>
    </nav>
    <Drawer title={`${t('全部已打开')} · ${tabs.length}`} open={open} onClose={() => setOpen(false)} size={390}>
      <Input aria-label={t('查找已打开工作页')} prefix={<Search size={16} />} value={query} onChange={(event) => setQuery(event.target.value)} allowClear />
      <div className="qms-opened-list">{results.map((tab) => <div className={tab.id === activeTabId ? 'active' : ''} key={tab.id}>
        <button className="qms-opened-activate" onClick={() => activateAndNavigate(tab)} aria-current={tab.id === activeTabId ? 'page' : undefined}>{t(tab.title)}</button>
        <a href={tab.path} target="_blank" rel="noopener noreferrer" aria-label={`${t('另开')} ${t(tab.title)}`} title={`${t('另开')} ${t(tab.title)}`}><ArrowUpRight size={18} /></a>
        <Button aria-label={`${t('关闭')} ${t(tab.title)}`} icon={<X size={16} />} type="text" onClick={() => closeAndNavigate(tab.id)} />
      </div>)}</div>
      {!results.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('没有匹配的工作页')} />}
    </Drawer>
  </>;
}
