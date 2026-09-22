import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { App, Button, ConfigProvider, Drawer, Input, Modal, theme } from 'antd';
import { ArrowUpRight, Bell, BookOpen, Check, ChevronDown, ChevronRight, ClipboardCheck, FileCheck2, FlaskConical, LayoutDashboard, List, Menu, Monitor, Moon, Palette, PanelLeftClose, PanelLeftOpen, Search, ShieldCheck, Sun, TrendingUp, Users, X } from 'lucide-react';
import { homeTab, makeTab, pageTitles, pageUrl, readStorage, records, tabFromUrl, writeStorage, type Draft, type Page, type PageProps, type WorkTab } from './model';
import './shell.css';

type Mode = 'light' | 'dark' | 'system';
type Accent = 'blue' | 'teal' | 'purple';
type Preferences = { mode: Mode; accent: Accent };
const accents = { blue: { label: '晴空蓝', light: '#277cc4', dark: '#65b0f0' }, teal: { label: '湖水青', light: '#12847f', dark: '#4bc4b8' }, purple: { label: '鸢尾紫', light: '#7960c5', dark: '#b19af0' } };

function initialPreferences(): Preferences {
  const value = readStorage('localStorage', 'qms-ui-prototype-theme-v2') as Partial<Preferences> | null;
  return { mode: value && ['light', 'dark', 'system'].includes(value.mode ?? '') ? value.mode! : 'light', accent: value && Object.hasOwn(accents, value.accent ?? '') ? value.accent! : 'blue' };
}

function initialSession() {
  const saved = readStorage('sessionStorage', 'qms-ui-prototype-tabs-v2') as { tabs?: WorkTab[]; activeId?: string } | null;
  const restored = Array.isArray(saved?.tabs) ? saved.tabs.filter(item => item && ['ledger', 'analytics', 'workspace'].includes(item.page)).slice(0, 30).map(item => makeTab(item.page, item.recordId)) : [];
  const tabs = [...new Map(restored.map(item => [item.id, item])).values()];
  const requested = tabFromUrl();
  if (requested && requested.page !== 'workbench' && !tabs.some(item => item.id === requested.id)) tabs.unshift(requested);
  const activeId = requested?.id ?? (tabs.some(item => item.id === saved?.activeId) ? saved!.activeId! : 'workbench');
  return { tabs, activeId };
}

export function PrototypeShell({ PageComponent }: { PageComponent: ComponentType<PageProps> }) {
  const [preferences, setPreferences] = useState(initialPreferences);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const dark = preferences.mode === 'dark' || (preferences.mode === 'system' && systemDark);
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.appearance = dark ? 'dark' : 'light';
    document.documentElement.dataset.accent = preferences.accent;
    writeStorage('localStorage', 'qms-ui-prototype-theme-v2', preferences);
  }, [preferences, dark]);
  return <ConfigProvider theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm, token: { colorPrimary: accents[preferences.accent][dark ? 'dark' : 'light'], borderRadius: 7, fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif', controlHeight: 36 } }}><App><ShellBody PageComponent={PageComponent} preferences={preferences} setPreferences={setPreferences} /></App></ConfigProvider>;
}

function ShellBody({ PageComponent, preferences, setPreferences }: { PageComponent: ComponentType<PageProps>; preferences: Preferences; setPreferences: (preferences: Preferences) => void }) {
  const [session, setSession] = useState(initialSession);
  const [mobileNav, setMobileNav] = useState(false);
  const [menuCollapsed, setMenuCollapsed] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [settings, setSettings] = useState(false);
  const [allTabs, setAllTabs] = useState(false);
  const [tabQuery, setTabQuery] = useState('');
  const [info, setInfo] = useState<string | null>(null);
  const [capacity, setCapacity] = useState(4);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const strip = useRef<HTMLDivElement>(null);
  const [confirm, confirmHolder] = Modal.useModal();
  const active = session.tabs.find(tab => tab.id === session.activeId) ?? homeTab;
  const inDomain = active.page !== 'workbench';
  const problemDomain = active.page === 'workspace' || active.page === 'ledger';
  const visible = [...session.tabs].sort((left, right) => Number(right.id === active.id) - Number(left.id === active.id)).slice(0, capacity);
  const overflow = session.tabs.length - visible.length;

  useEffect(() => { writeStorage('sessionStorage', 'qms-ui-prototype-tabs-v2', session); }, [session]);
  useEffect(() => {
    if (!strip.current) return;
    const observer = new ResizeObserver(entries => setCapacity(Math.max(1, Math.floor((entries[0].contentRect.width - 135) / 190))));
    observer.observe(strip.current);
    return () => observer.disconnect();
  }, [session.tabs.length > 1]);
  useEffect(() => {
    const update = () => { const tab = tabFromUrl(); if (tab) activate(tab, false); };
    window.addEventListener('popstate', update);
    window.addEventListener('hashchange', update);
    return () => { window.removeEventListener('popstate', update); window.removeEventListener('hashchange', update); };
  }, []);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => { if (Object.values(drafts).some(draft => draft.dirty)) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [drafts]);

  function activate(tab: WorkTab, updateUrl = true) {
    setSession(current => ({ tabs: tab.page === 'workbench' ? current.tabs : [tab, ...current.tabs.filter(item => item.id !== tab.id)], activeId: tab.id }));
    setMobileNav(false);
    setAllTabs(false);
    setFocusMode(false);
    if (updateUrl) window.history.replaceState(null, '', pageUrl(tab));
    window.scrollTo({ top: 0 });
  }
  const navigate = (page: Page, recordId?: string) => activate(makeTab(page, recordId));
  const saveDraft = useCallback((draft: Draft) => {
    setDrafts(current => ({ ...current, [active.id]: draft }));
  }, [active.id]);

  function close(tab: WorkTab) {
    const remove = () => {
      const remaining = session.tabs.filter(item => item.id !== tab.id);
      const next = active.id === tab.id ? remaining[0] ?? homeTab : active;
      setSession({ tabs: remaining, activeId: next.id });
      setDrafts(current => { const nextDrafts = { ...current }; delete nextDrafts[tab.id]; return nextDrafts; });
      window.history.replaceState(null, '', pageUrl(next));
      setFocusMode(false);
    };
    if (drafts[tab.id]?.dirty) confirm.confirm({ title: '关闭未保存的工作页？', content: `「${tab.title}」有未保存的演示修改，关闭后这些修改会丢失。`, okText: '放弃修改并关闭', cancelText: '继续编辑', okButtonProps: { danger: true }, onOk: remove });
    else remove();
  }

  const domains = [
    { label: '综合工作台', icon: LayoutDashboard, page: 'workbench' as Page, selected: !inDomain },
    { label: '质量分析', icon: TrendingUp, page: 'analytics' as Page, selected: active.page === 'analytics' },
    { label: '问题与改进', icon: ClipboardCheck, page: 'ledger' as Page, selected: problemDomain },
    { label: '供应商质量', icon: Users }, { label: '检验管理', icon: FlaskConical }, { label: '审核管理', icon: FileCheck2 }, { label: '质量知识库', icon: BookOpen },
  ];

  return <div className={`qms-prototype v2-shell ${inDomain ? 'in-domain' : ''} ${menuCollapsed ? 'menu-collapsed' : ''} ${focusMode ? 'focus-mode' : ''}`}>
    {confirmHolder}
    {mobileNav && <button className="v2-backdrop" aria-label="关闭导航" onClick={() => setMobileNav(false)} />}
    <aside className={`v2-navigation ${mobileNav ? 'mobile-open' : ''}`}>
      <div className="domain-rail">
        <button className="v2-brand" onClick={() => navigate('workbench')} title="返回综合工作台" aria-label="返回综合工作台"><ShieldCheck size={28} /><span><b>QMS</b><small>质量管理平台</small></span></button>
        {!inDomain && <div className="v2-organization"><span>智</span><div>智造事业部<small>质量协同空间</small></div><ChevronDown size={15} /></div>}
        <div className="v2-nav-label">工作空间 / 质量应用</div>
        <nav aria-label={inDomain ? '领域图标导航' : '完整业务导航'}>{domains.map(item => <button key={item.label} title={item.label} aria-label={item.label} aria-current={item.selected ? 'page' : undefined} className={item.selected ? 'active' : ''} onClick={() => item.page ? navigate(item.page) : setInfo(item.label)}><item.icon size={20} /><span>{item.label}</span></button>)}</nav>
        <div className="rail-bottom"><button onClick={() => setInfo('设计样板说明')} title="设计样板说明" aria-label="设计样板说明"><BookOpen size={19} /><span>设计样板说明</span></button></div>
      </div>
      {inDomain && <div className="domain-menu"><div className="domain-menu-title"><div><small>QUALITY APPLICATION</small><h2>{problemDomain ? '问题与改进' : '质量分析'}</h2></div><button className="icon-button" aria-label="收起业务菜单" onClick={() => setMenuCollapsed(true)}><PanelLeftClose size={17} /></button></div><p>{problemDomain ? '从问题发现，到改进闭环' : '从数据洞察，到质量改进'}</p><div className="domain-menu-group">{problemDomain ? '业务管理' : '分析视图'}</div>{problemDomain ? <><button className={active.page === 'ledger' ? 'active' : ''} onClick={() => navigate('ledger')}><List size={17} />问题台账<span>6</span></button><button onClick={() => navigate('workbench')}><ClipboardCheck size={17} />我的待办<span>3</span></button><button onClick={() => setInfo('改进措施跟踪')}><Check size={17} />改进措施跟踪</button><div className="domain-menu-group">最近工作记录</div>{session.tabs.filter(tab => tab.page === 'workspace').slice(0, 4).map(tab => <button key={tab.id} className={`recent-record ${tab.id === active.id ? 'active' : ''}`} onClick={() => activate(tab)}><span>{tab.recordId}<small>{tab.title}</small></span></button>)}</> : <><button className="active" onClick={() => navigate('analytics')}><TrendingUp size={17} />综合质量分析</button><button onClick={() => setInfo('供应商质量专题')}><Users size={17} />供应商质量专题</button><button onClick={() => setInfo('过程能力分析')}><FlaskConical size={17} />过程能力分析</button><button onClick={() => setInfo('自定义分析报表')}><List size={17} />自定义报表</button></>}<div className="domain-menu-foot"><span className="live-dot" />演示业务空间<small>未接入真实业务数据</small></div></div>}
    </aside>
    <div className="v2-main">
      <header className="v2-topbar"><div className="v2-topbar-start"><button className="icon-button v2-mobile-menu" aria-label="打开导航" onClick={() => setMobileNav(true)}><Menu size={20} /></button>{inDomain && menuCollapsed && !focusMode && <button className="icon-button" aria-label="展开业务菜单" onClick={() => setMenuCollapsed(false)}><PanelLeftOpen size={19} /></button>}<button onClick={() => navigate('workbench')}>工作空间</button><ChevronRight size={13} /><span>{pageTitles[active.page]}</span></div><div className="v2-topbar-end"><span className="prototype-badge"><span />UI 样板 V2 · 演示数据</span><button className="appearance-trigger" onClick={() => setSettings(true)} aria-label="切换主题和颜色"><Palette size={17} /><span>外观</span></button><button className="icon-button" aria-label="查看演示通知" onClick={() => setInfo('通知中心')}><Bell size={18} /></button><span className="avatar">陈</span></div></header>
      {session.tabs.length > 1 && <div className="v2-tabs" ref={strip} role="navigation" aria-label="内部工作标签"><div className="v2-visible-tabs">{visible.map(tab => <div key={tab.id} className={`v2-work-tab ${tab.id === active.id ? 'active' : ''}`}><button className="tab-activate" title={`${tab.recordId ? `${tab.recordId} · ` : ''}${tab.title}`} aria-current={tab.id === active.id ? 'page' : undefined} onClick={() => activate(tab)}>{drafts[tab.id]?.dirty && <span className="dirty-dot" aria-label="未保存" />}<span>{tab.title}</span></button><button className="tab-close" aria-label={`关闭 ${tab.title}`} onClick={() => close(tab)}><X size={13} /></button></div>)}</div><button className="all-tabs-button" onClick={() => setAllTabs(true)} aria-label={`全部已打开 ${session.tabs.length} 个工作页`}><List size={15} /><span>全部已打开</span><b>{overflow > 0 ? `+${overflow}` : session.tabs.length}</b></button></div>}
      <div className="v2-page-toolbar"><span>{active.recordId ?? (active.page === 'workbench' ? '个人工作空间' : '智造事业部')}</span><div className="page-tools">{session.tabs.length > 0 && <button onClick={() => setAllTabs(true)} aria-label="管理已打开工作页"><List size={14} />工作页 {session.tabs.length}</button>}{active.page !== 'workbench' && <a href={pageUrl(active)} target="_blank" rel="noopener noreferrer" title="新页签只打开当前记录，未保存内容不会复制"><ArrowUpRight size={14} />另开浏览器页签</a>}</div></div>
      <div className="v2-content">{active.page === 'ledger' ? <Ledger navigate={navigate} /> : <PageComponent key={active.id} page={active.page} recordId={active.recordId} navigate={navigate} focusMode={focusMode} setFocusMode={setFocusMode} initialDraft={drafts[active.id]} onDraftChange={saveDraft} />}</div>
    </div>
    <Drawer title="外观设置" open={settings} onClose={() => setSettings(false)} size={340}><div className="appearance-panel"><h3>显示模式</h3><p>选择适合当前环境的界面亮度</p><div className="mode-options">{([{ value: 'light', label: '浅色', icon: Sun }, { value: 'dark', label: '深色', icon: Moon }, { value: 'system', label: '跟随系统', icon: Monitor }] as const).map(item => <button key={item.value} aria-pressed={preferences.mode === item.value} onClick={() => setPreferences({ ...preferences, mode: item.value })}><item.icon size={22} /><span>{item.label}</span>{preferences.mode === item.value && <Check size={13} />}</button>)}</div><h3>品牌主色</h3><p>改变导航、按钮与选中状态的强调色</p><div className="accent-options">{(Object.keys(accents) as Accent[]).map(accent => <button key={accent} aria-pressed={preferences.accent === accent} onClick={() => setPreferences({ ...preferences, accent })}><span style={{ background: accents[accent].light }}>{preferences.accent === accent && <Check size={15} />}</span>{accents[accent].label}</button>)}</div><div className="appearance-note">风险、预警和完成状态保持固定语义。图表分类色保持稳定，背景与文字适配深浅模式。</div><small>偏好保存在当前浏览器。离线文件的保存能力取决于浏览器设置。</small></div></Drawer>
    <Drawer title={`全部已打开 · ${session.tabs.length}`} open={allTabs} onClose={() => setAllTabs(false)} size={390}><Input aria-label="查找已打开工作页" prefix={<Search size={16} />} placeholder="搜索标题或问题编号" value={tabQuery} onChange={event => setTabQuery(event.target.value)} allowClear /><div className="opened-list">{session.tabs.filter(tab => `${tab.title}${tab.recordId ?? ''}`.includes(tabQuery)).map(tab => <div key={tab.id} className={tab.id === active.id ? 'active' : ''}><button onClick={() => activate(tab)}><strong>{tab.title}{drafts[tab.id]?.dirty ? ' · 未保存' : ''}</strong><small>{tab.recordId ?? pageTitles[tab.page]}</small></button><a href={pageUrl(tab)} target="_blank" rel="noopener noreferrer" aria-label={`另开 ${tab.title}`}><ArrowUpRight size={17} /></a><button className="icon-button" aria-label={`关闭 ${tab.title}`} onClick={() => close(tab)}><X size={16} /></button></div>)}</div><p className="drawer-note">仅活动页渲染；刷新可恢复标签位置，演示表单正文不会保存到浏览器。</p></Drawer>
    <Modal open={info !== null} title={info} onCancel={() => setInfo(null)} footer={<Button type="primary" onClick={() => setInfo(null)}>知道了</Button>}><div className="modal-copy">{info === '设计样板说明' ? <><p>第二版体现完整导航、业务图标轨、上下文菜单和内部工作标签。可以从问题台账打开多条记录，体验切换、去重、收纳与专注处理。</p><p>外观支持三种模式与三种主色。标签保存于当前浏览器会话，演示草稿仅驻留内存。</p></> : <p>「{info}」为后续业务入口。本轮展示问题台账、多个问题工作页和质量分析；这里尚未展开真实业务功能。</p>}</div></Modal>
  </div>;
}

function Ledger({ navigate }: { navigate: (page: Page, recordId?: string) => void }) {
  const [query, setQuery] = useState('');
  const filtered = records.filter(record => `${record.id}${record.title}${record.owner}`.includes(query));
  return <><div className="page-heading"><div><div className="eyebrow">ISSUES & CONTINUOUS IMPROVEMENT</div><h1>问题台账</h1><p>查看业务全貌，进入完整处理空间。</p></div><span className="tag blue">6 条演示记录</span></div><section className="panel ledger-panel"><div className="ledger-tools"><Input aria-label="搜索问题台账" prefix={<Search size={16} />} value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索编号、标题或负责人" allowClear /><span>点击记录打开工作页；再次打开会定位已有标签</span></div><div className="table-scroll"><table><thead><tr><th>问题编号 / 标题</th><th>来源</th><th>优先级</th><th>负责人</th><th>截止时间</th><th>状态</th></tr></thead><tbody>{filtered.map(record => <tr key={record.id}><td><button className="ledger-record" onClick={() => navigate('workspace', record.id)}><small>{record.id}</small><strong>{record.title}</strong></button></td><td>{record.source}</td><td><span className={`tag ${record.urgent ? 'orange' : 'neutral'}`}>{record.urgent ? '高' : '普通'}</span></td><td><span className="tiny-avatar">{record.owner[0]}</span>{record.owner}</td><td>{record.due}</td><td><span className="tag purple">{record.status}</span></td></tr>)}</tbody></table>{filtered.length === 0 && <div className="empty-state">没有找到匹配的问题。</div>}</div></section><div className="ledger-hint"><List size={17} /><span>试着打开两条不同问题，再切换到质量分析。工作标签会自动出现，超出宽度的记录收纳到“全部已打开”。</span></div></>;
}
