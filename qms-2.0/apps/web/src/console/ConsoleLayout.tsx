import { Alert, Button, Drawer, Dropdown, Skeleton } from 'antd';
import { ChevronDown, Menu, PanelLeftClose, PanelLeftOpen, ShieldCheck } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useLanguage } from '../i18n/Language';
import { TopbarLanguageSwitcher } from '../i18n/TopbarLanguageSwitcher';
import { UnsavedChangesProvider, useNavigationGuard } from '../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';
import { getConsoleContext } from './console-api';
import { consoleNavigation, consoleRoute, type ConsoleContext as Context, type ConsoleNavigationItem } from './console-navigation';
import { ConsoleTheme, useConsoleAppearance } from './ConsoleTheme';
import { SessionVerificationGate } from '../features/auth/SessionVerificationGate';
import { subscribeSessionSignals } from '../features/auth/session-invalidation';

const Context = createContext<{ context: Context; refresh: () => void; invalidate: () => void } | null>(null);
export function useConsoleContext() {
  const value = useContext(Context);
  if (!value) throw new Error('Console context is not verified');
  return value;
}

export function ConsoleLayout({ children }: { children?: ReactNode }) {
  return <ConsoleTheme><UnsavedChangesProvider><ConsoleShell>{children}</ConsoleShell></UnsavedChangesProvider></ConsoleTheme>;
}

function ConsoleShell({ children }: { children?: ReactNode }) {
  const { locale } = useLanguage();
  const text = (zh: string, en: string) => locale === 'en-US' ? en : zh;
  const location = useLocation();
  const navigate = useNavigate();
  const requestLeave = useNavigationGuard();
  const sessionScope = useWorkTabsStore(state => state.sessionScope);
  const query = new URLSearchParams(location.search);
  const organizationId = query.get('organizationId')?.toLowerCase() ?? undefined;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: symbol; context?: Context; error?: 'denied' | 'network' }>();
  const [preserved, setPreserved] = useState<{ scope: symbol; context: Context }>();
  const verified = useRef<{ scope: symbol; context: Context }>(undefined);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const activeRequest = useRef<{ key: symbol; controller: AbortController } | null>(null);
  const { mode, setMode } = useConsoleAppearance();
  // Returning to the same URL is a new verification, never a reusable authorization cache key.
  const scope = useMemo(() => Symbol('console-scope'), [sessionScope, organizationId, location.pathname]);
  const key = useMemo(() => Symbol('console-verification'), [scope, revision]);
  const restart = useCallback((keepDraft = false) => {
    activeRequest.current?.controller.abort(); activeRequest.current = null;
    setPreserved(keepDraft ? verified.current : undefined);
    if (!keepDraft) verified.current = undefined;
    setResult(undefined); setRevision(value => value + 1);
  }, []);
  const refresh = useCallback(() => { if (activeRequest.current?.key === key) restart(!!preserved); }, [key, preserved, restart]);
  const discardPreserved = useCallback(() => { verified.current = undefined; setPreserved(undefined); }, []);
  const invalidate = useCallback(() => {
    if (activeRequest.current?.key !== key) return;
    activeRequest.current.controller.abort(); discardPreserved(); setResult({ key, error: 'denied' });
  }, [key, discardPreserved]);

  useEffect(() => subscribeSessionSignals(signal => restart(signal === 'revalidate')), [restart]);
  useEffect(() => useWorkTabsStore.subscribe((next, previous) => {
    // Abort synchronously, including a batched A -> B -> A identity transition.
    if (next.sessionScope !== previous.sessionScope) restart();
  }), [restart]);
  useEffect(() => {
    if (!sessionScope) return;
    const controller = new AbortController();
    activeRequest.current = { key, controller };
    void getConsoleContext(organizationId, controller.signal).then(context => {
      if (controller.signal.aborted || activeRequest.current?.key !== key || useWorkTabsStore.getState().sessionScope !== sessionScope) return;
      const matchesSession = sessionScope === `INTERNAL:${context.actor.homeOrganization.id}:${context.actor.id}`;
      if (matchesSession && (organizationId === undefined || context.targetOrganization.id === organizationId)) {
        verified.current = { scope, context }; setPreserved(undefined); setResult({ key, context });
      } else { discardPreserved(); setResult({ key, error: 'denied' }); }
    }).catch(error => {
      if (!controller.signal.aborted && activeRequest.current?.key === key && useWorkTabsStore.getState().sessionScope === sessionScope) {
        const denied = error instanceof ApiError && (error.status === 401 || error.status === 403);
        if (denied) discardPreserved();
        setResult({ key, error: denied ? 'denied' : 'network' });
      }
    });
    return () => controller.abort();
  }, [sessionScope, organizationId, key, scope, discardPreserved]);
  useEffect(() => { setMobileOpen(false); }, [location.pathname, location.search]);

  const value = result?.key === key ? result : undefined;
  const context = value?.context ?? (preserved?.scope === scope ? preserved.context : undefined);
  const blocked = !!context && !value?.context;
  const capabilityKey = context ? JSON.stringify([context.actor.id, context.actor.homeOrganization.id, context.targetOrganization.id, context.modules]) : undefined;
  useEffect(() => { if (capabilityKey) heading.current?.focus(); }, [scope, capabilityKey, location.search]);
  const route = context ? consoleRoute(location.pathname, context) : undefined;
  const module = route?.module;
  const fixedHome = module?.scope === 'SESSION_HOME';
  const resourceOrganization = fixedHome ? context?.actor.homeOrganization : context?.targetOrganization;
  const entries = context ? consoleNavigation(context) : [];
  const label = (item: ConsoleNavigationItem) => text(item.label, item.english);
  const groups = [['workspace', '工作空间', 'Workspace'], ['administration', '组织与授权', 'Organizations & access'], ['configuration', '基础数据与配置', 'Data & configuration'], ['security', '安全与运行', 'Security & operations']];
  const href = (path: string) => organizationId === undefined ? path : `${path}?${new URLSearchParams({ organizationId })}`;
  const navigation = <>
    <div className="qms-console-brand"><ShieldCheck size={24} aria-hidden="true" /><span className="qms-console-nav-label"><strong>QMS Console</strong><small>{text('管理工作空间', 'Management workspace')}</small></span></div>
    <nav aria-label={text('管理导航', 'Management navigation')}>
      {groups.map(([group, zh, en]) => {
        const items = entries.filter(item => item.group === group);
        return items.length ? <section key={group}><p className="qms-console-nav-label">{text(zh!, en!)}</p>{items.map(item => {
          const Icon = item.icon;
          return <Link key={item.path} to={href(item.path)} aria-label={label(item)} title={label(item)} aria-current={route?.item?.path === item.path ? 'page' : undefined}><Icon size={18} aria-hidden="true" /><span className="qms-console-nav-label">{label(item)}</span></Link>;
        })}</section> : null;
      })}
    </nav>
    <div className="qms-console-sidebar-note qms-console-nav-label">{text('管理操作以实时服务端授权为准', 'Actions require current server authorization')}</div>
  </>;

  const verification = value?.error ? <div className="qms-console-state"><Alert type="error" showIcon title={value.error === 'denied' ? text('管理访问已失效或无权限', 'Management access expired or denied') : text('无法验证管理权限，请重试', 'Unable to verify management access. Retry.')} /><Button aria-label={text('重试', 'Retry')} onClick={refresh}>{text('重试', 'Retry')}</Button></div>
    : <div className="qms-console-state" role="status" aria-label={text('验证管理权限中', 'Verifying management access')}><Skeleton active /></div>;
  return <>
    <SessionVerificationGate open={blocked} onUnavailable={discardPreserved}>{verification}</SessionVerificationGate>
    <div className={`qms-console-layout${collapsed ? ' qms-console-collapsed' : ''}`}>
    <a className="qms-console-skip" href="#qms-console-content">{text('跳到管理内容', 'Skip to management content')}</a>
    <aside className="qms-console-sidebar">{navigation}</aside>
    <div className="qms-console-body">
      <header className="qms-console-topbar">
        <div className="qms-console-topbar-leading">
          <Button className="qms-console-desktop-toggle" type="text" aria-label={text(collapsed ? '展开导航' : '折叠导航', collapsed ? 'Expand navigation' : 'Collapse navigation')} aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)} icon={collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />} />
          <Button className="qms-console-mobile-toggle" type="text" aria-label={text('打开管理导航', 'Open management navigation')} aria-expanded={mobileOpen} aria-controls="qms-console-mobile-navigation" onClick={() => setMobileOpen(true)} icon={<Menu size={20} />} />
          {location.pathname !== '/console' && location.pathname !== '/console/' && <nav className="qms-console-breadcrumb" aria-label={text('面包屑', 'Breadcrumb')}><Link to={href('/console')}>{text('管理控制台', 'Console')}</Link><span aria-hidden="true">/</span><strong>{route?.item ? label(route.item) : text('访问验证', 'Access verification')}</strong></nav>}
        </div>
        <div className="qms-console-topbar-actions"><TopbarLanguageSwitcher /><Dropdown trigger={['click']} menu={{ selectable: true, selectedKeys: [mode], items: [{ key: 'light', label: text('浅色', 'Light') }, { key: 'dark', label: text('深色', 'Dark') }, { key: 'system', label: text('跟随系统', 'System') }], onClick: ({ key: next }) => { if (next === 'light' || next === 'dark' || next === 'system') setMode(next); } }}>
          <Button aria-label={text('管理外观', 'Console appearance')}>{text('外观', 'Appearance')}<ChevronDown size={14} aria-hidden="true" /></Button>
        </Dropdown></div>
      </header>
      <main id="qms-console-content" className="qms-console-content" tabIndex={-1}>
        {!sessionScope || value?.error && !context ? <div className="qms-console-state"><Alert type="error" showIcon title={!sessionScope || value?.error === 'denied' ? text('管理访问已失效或无权限', 'Management access expired or denied') : text('无法验证管理权限，请重试', 'Unable to verify management access. Retry.')} /><Button aria-label={text('重试', 'Retry')} onClick={refresh}>{text('重试', 'Retry')}</Button></div>
          : !context ? <div className="qms-console-state" role="status" aria-label={text('验证管理权限中', 'Verifying management access')}><Skeleton active /></div>
            : <>
              <div className="qms-console-page-heading"><h1 ref={heading} tabIndex={-1}>{route?.item ? label(route.item) : text('管理页面', 'Management page')}</h1>
                {fixedHome ? <div className="qms-console-fixed-scope"><strong>{text('固定会话所属组织', 'Fixed to session home')}</strong><span>{resourceOrganization?.name} ({resourceOrganization?.code})</span></div>
                  : <label className="qms-console-target">{text('管理目标组织', 'Management target organization')}<select aria-label={text('管理目标组织', 'Management target organization')} value={context.targetOrganization.id} onChange={event => {
                    const next = event.target.value;
                    requestLeave(() => { const search = new URLSearchParams(location.search); search.set('organizationId', next); navigate({ pathname: location.pathname, search: search.toString(), hash: location.hash }); });
                  }}>{context.organizations.map(organization => <option key={organization.id} value={organization.id}>{organization.name} ({organization.code})</option>)}</select></label>}
              </div>
              <details className="qms-console-scope-details"><summary>{text('身份与资源范围', 'Identity & resource scope')} · {resourceOrganization?.name} · {module?.coverage === 'PLATFORM' ? text('平台级目录', 'Platform directory') : text('组织范围', 'Organization scope')}</summary><dl className="qms-console-scope">
                <div><dt>{text('当前身份', 'Current actor')}</dt><dd aria-label={text('当前身份', 'Current actor')}>{context.actor.id}</dd></div>
                <div><dt>{text('会话所属组织', 'Session home organization')}</dt><dd aria-label={text('会话所属组织', 'Session home organization')}>{context.actor.homeOrganization.name} ({context.actor.homeOrganization.code})</dd></div>
                <div><dt>{text('模块资源范围', 'Module resource scope')}</dt><dd aria-label={text('模块资源范围', 'Module resource scope')}>{resourceOrganization?.name} · {module?.coverage === 'PLATFORM' ? text('平台级目录，以上组织为授权来源', 'Platform directory; organization is the authorization source') : text('组织范围', 'Organization scope')} · {fixedHome ? 'SESSION_HOME' : 'TARGET'}</dd></div>
              </dl></details>
              {route?.status === 'allowed' ? <Context.Provider key={capabilityKey} value={{ context, refresh, invalidate }}>{children ?? <Outlet />}</Context.Provider>
                : <Alert type="warning" showIcon title={route?.status === 'not-found' ? text('管理页面不存在', 'Management page not found') : text('无权访问此管理模块', 'You cannot access this management module')} />}
            </>}
      </main>
    </div>
    <Drawer title={text('管理导航', 'Management navigation')} open={mobileOpen} onClose={() => setMobileOpen(false)} placement="left" size={288} className="qms-console-mobile-drawer"><div id="qms-console-mobile-navigation">{navigation}</div></Drawer>
  </div></>;
}
