import { Alert, Button, ConfigProvider, Drawer, Dropdown, Empty, Input, Modal, Skeleton, Table, theme } from 'antd';
import { ArrowRight, Building2, Check, ChevronDown, GitBranch, LayoutDashboard, Menu, Monitor, PanelLeftClose, PanelLeftOpen, Search, ShieldCheck, Unplug, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { components } from '@qms/contracts';
import { WorkflowCanvas } from '../../features/workflows/WorkflowCanvas';
import { useLanguage } from '../../i18n/Language';
import './console.css';

type Page = 'home' | 'users' | 'workflows';
type View = 'normal' | 'readonly' | 'loading' | 'empty' | 'error' | 'denied';
type Mode = 'light' | 'dark' | 'system';
type Person = { id: string; name: string; account: string; direct: boolean; position: string; legacy: boolean };
const appearanceKey = 'qms:console-preview:appearance:v1';
const initialPeople: Person[] = [
  { id: 'lin', name: '林晓', account: 'demo.lin', direct: true, position: '演示平台管理员', legacy: true },
  { id: 'chen', name: '陈宁', account: 'demo.chen', direct: false, position: '供应商质量工程师', legacy: false },
  { id: 'zhou', name: '周珊', account: 'demo.zhou', direct: false, position: '供应商质量科经理', legacy: false },
];

export function ConsolePreview() {
  const { locale, setLocale } = useLanguage();
  const text = (zh: string, en: string) => locale === 'en-US' ? en : zh;
  const root = useRef<HTMLDivElement>(null);
  const appearanceTrigger = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [page, setPage] = useState<Page>('home');
  const [view, setView] = useState<View>('normal');
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [mode, setMode] = useState<Mode>(() => {
    try { const value = localStorage.getItem(appearanceKey); return value === 'dark' || value === 'light' ? value : 'system'; } catch { return 'system'; }
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [people, setPeople] = useState(initialPeople);
  const [search, setSearch] = useState('');
  const [affiliation, setAffiliation] = useState('all');
  const [selected, setSelected] = useState<Person | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [discard, setDiscard] = useState(false);
  const [validation, setValidation] = useState(false);
  const [notice, setNotice] = useState('');
  const [workflow, setWorkflow] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState('demo-action');
  const dark = mode === 'dark' || (mode === 'system' && systemDark);
  const dirty = editing && selected !== null && draft !== selected.name;
  const title = { home: text('管理首页', 'Management home'), users: text('组织与用户', 'Organizations & users'), workflows: text('流程设计', 'Workflow design') };
  const readOnly = view !== 'normal';
  const visiblePeople = people.filter(person => (affiliation === 'all' || person.direct === (affiliation === 'direct')) && `${person.name} ${person.account} ${person.position}`.toLowerCase().includes(search.trim().toLowerCase()));
  const demoGraph: components['schemas']['WorkflowGraphResponseDto'] = {
    nodes: [
      { id: 'demo-action', name: text('处理', 'Action'), type: 'ACTION', config: { isStart: true, editorPosition: { x: 40, y: 80 } } },
      { id: 'demo-close', name: text('关闭', 'Close'), type: 'CLOSE', config: { isEnd: true, editorPosition: { x: 350, y: 80 } } },
    ],
    transitions: [{ id: 'demo-transition', from: 'demo-action', to: 'demo-close', action: 'SUBMIT' }],
  };

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(media.matches);
    media.addEventListener('change', update);
    update();
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => { try { localStorage.setItem(appearanceKey, mode); } catch { /* The active theme still works when storage is unavailable. */ } }, [mode]);
  useEffect(() => {
    if (!dirty) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [dirty]);

  function navigate(next: Page) {
    setPage(next); setView('normal'); setMobileOpen(false); setNotice('');
    requestAnimationFrame(() => heading.current?.focus());
  }
  function closeDetail() { if (dirty) setDiscard(true); else { setSelected(null); setEditing(false); } }
  function save() {
    if (!selected || readOnly) return;
    if (!draft.trim()) { setValidation(true); return; }
    setPeople(current => current.map(person => person.id === selected.id ? { ...person, name: draft.trim() } : person));
    setSelected(null); setEditing(false); setValidation(false);
    setNotice(text('仅本页内存已更新；刷新后恢复，未写入业务系统。', 'Updated in this page memory only; reload resets it. No business write.'));
  }
  function appearanceChange(open: boolean) {
    setAppearanceOpen(open);
    if (!open) queueMicrotask(() => appearanceTrigger.current?.focus());
  }
  const navigation = <>
    <div className="qmc-brand"><span className="qmc-logomark"><ShieldCheck size={22} aria-hidden="true" /></span><span className="qmc-sidebar-label"><strong>QMS Console</strong><small>{text('管理工作空间', 'Management workspace')}</small></span></div>
    <nav aria-label={text('管理导航', 'Management navigation')}>
      <p className="qmc-nav-caption qmc-sidebar-label">{text('工作空间', 'Workspace')}</p>
      <button type="button" onClick={() => navigate('home')} aria-current={page === 'home' ? 'page' : undefined} aria-label={title.home} title={collapsed ? title.home : undefined}><LayoutDashboard size={18} aria-hidden="true" /><span className="qmc-sidebar-label">{title.home}</span></button>
      <p className="qmc-nav-caption qmc-sidebar-label">{text('管理与配置', 'Administration')}</p>
      <button type="button" onClick={() => navigate('users')} aria-current={page === 'users' ? 'page' : undefined} aria-label={title.users} title={collapsed ? title.users : undefined}><Users size={18} aria-hidden="true" /><span className="qmc-sidebar-label">{title.users}</span></button>
      <button type="button" onClick={() => navigate('workflows')} aria-current={page === 'workflows' ? 'page' : undefined} aria-label={title.workflows} title={collapsed ? title.workflows : undefined}><GitBranch size={18} aria-hidden="true" /><span className="qmc-sidebar-label">{title.workflows}</span></button>
    </nav>
    <div className="qmc-sidebar-bottom"><span className="qmc-avatar">DE</span><span className="qmc-sidebar-label"><strong>{text('演示管理身份', 'Demo administrator')}</strong><small>{text('非真实登录会话', 'Not a signed-in session')}</small></span></div>
  </>;

  return <ConfigProvider getPopupContainer={() => root.current ?? document.body} theme={{
    algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: dark ? '#e2e8f0' : '#172033', colorInfo: dark ? '#cbd5e1' : '#334155', colorBgBase: dark ? '#111318' : '#ffffff',
      colorText: dark ? '#f1f2f4' : '#181b22', colorTextSecondary: dark ? '#a8adb8' : '#616773', colorBorder: dark ? '#353943' : '#dfe2e7',
      borderRadius: 6, controlHeight: 36, fontSize: 14, fontFamily: '"Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif',
    },
    components: { Button: { primaryColor: dark ? '#111318' : '#ffffff', primaryShadow: 'none' }, Table: { headerBg: dark ? '#1c1f26' : '#f8f9fb', cellPaddingBlock: 16 }, Modal: { titleFontSize: 18 } },
  }}>
    <div ref={root} className={`qmc-preview${collapsed ? ' qmc-collapsed' : ''}`} data-console-theme={dark ? 'dark' : 'light'} style={{ colorScheme: dark ? 'dark' : 'light' }}>
      <a className="qmc-skip" href="#qmc-content">{text('跳到管理内容', 'Skip to management content')}</a>
      <aside className="qmc-sidebar">{navigation}</aside>
      <div className="qmc-body">
        <header className="qmc-topbar">
          <div className="qmc-topbar-leading">
            <Button className="qmc-desktop-toggle" type="text" aria-label={text(collapsed ? '展开导航' : '折叠导航', collapsed ? 'Expand navigation' : 'Collapse navigation')} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)} icon={collapsed ? <PanelLeftOpen size={19} aria-hidden="true" /> : <PanelLeftClose size={19} aria-hidden="true" />} />
            <Button className="qmc-mobile-toggle" type="text" aria-label={text('打开管理导航', 'Open management navigation')} aria-expanded={mobileOpen} aria-controls="qmc-mobile-navigation" onClick={() => setMobileOpen(true)} icon={<Menu size={20} aria-hidden="true" />} />
            <span className="qmc-breadcrumb"><span>{text('管理控制台', 'Console')}</span><span aria-hidden="true">/</span><strong>{title[page]}</strong></span>
          </div>
          <div className="qmc-topbar-actions">
            <Button type="text" aria-label={locale === 'zh-CN' ? 'Switch to English' : '切换为中文'} onClick={() => setLocale(locale === 'zh-CN' ? 'en-US' : 'zh-CN')}>{locale === 'zh-CN' ? 'EN' : '中文'}</Button>
            <Dropdown open={appearanceOpen} onOpenChange={appearanceChange} trigger={['click']} placement="bottomRight" autoFocus menu={{
              selectable: true, selectedKeys: [mode], items: ([['light', text('浅色', 'Light')], ['dark', text('深色', 'Dark')], ['system', text('跟随系统', 'System')]] as const).map(([key, label]) => ({ key, label, role: 'menuitemradio', 'aria-checked': mode === key, icon: <Check size={14} aria-hidden="true" style={{ visibility: mode === key ? 'visible' : 'hidden' }} /> })),
              onClick: ({ key }) => { setMode(key as Mode); appearanceChange(false); },
            }}><Button ref={appearanceTrigger} type="text" aria-label={text('管理外观', 'Console appearance')} aria-haspopup="menu" aria-expanded={appearanceOpen} icon={<Monitor size={18} aria-hidden="true" />}><ChevronDown size={12} aria-hidden="true" /></Button></Dropdown>
            <span className="qmc-top-avatar" aria-label={text('演示身份', 'Demo identity')}>DE</span>
          </div>
        </header>

        <main id="qmc-content" className="qmc-content" tabIndex={-1}>
          <div className="qmc-demo-banner"><ShieldCheck size={16} aria-hidden="true" /><strong>{text('本地演示 · 不连接真实 API', 'Local demo · No real API connection')}</strong><span>{text('记录与权限均为样例，不代表真实管理能力。', 'Records and permissions are samples, not verified capabilities.')}</span></div>
          <div className="qmc-page-heading"><div><p className="qmc-eyebrow">QMS / MANAGEMENT</p><h1 ref={heading} tabIndex={-1}>{title[page]}</h1><p>{page === 'home' ? text('先看管理范围，再处理配置。业务办理留在业务工作空间。', 'Review scope before configuration. Business actions stay in the business workspace.') : page === 'users' ? text('以岗位承接授权，让每一份权限都有可追溯的来源。', 'Position-based access, with a traceable source for every permission.') : text('维护流程定义、版本与业务绑定，不改变业务办理边界。', 'Manage definitions, versions and bindings without changing business execution boundaries.')}</p></div>
            <div className="qmc-state-control"><label htmlFor="qmc-state">{text('样例状态', 'Preview state')}</label><select id="qmc-state" value={view} disabled={selected !== null || workflow !== null} onChange={event => { setView(event.target.value as View); setNotice(''); }}>
              <option value="normal">{text('正常', 'Normal')}</option><option value="readonly">{text('只读', 'Read only')}</option><option value="loading">{text('加载', 'Loading')}</option><option value="empty">{text('空数据', 'Empty')}</option><option value="error">{text('错误', 'Error')}</option><option value="denied">{text('无权', 'No access')}</option>
            </select></div>
          </div>
          {notice && <p role="status" className="qmc-notice">{notice}</p>}
          {view === 'loading' ? <section className="qmc-panel qmc-state-panel" aria-busy="true"><p role="status">{text('正在展示加载样例', 'Showing a loading example')}</p><Skeleton active paragraph={{ rows: 6 }} /></section>
            : view === 'denied' ? <Alert type="warning" showIcon title={text('无权查看当前管理范围', 'No access to this management scope')} description={text('仅为拒绝状态演示；不展示用户、授权来源或对象清单，不代表服务端鉴权已验证。', 'Denial simulation only. User and source details are hidden; server authorization is not verified.')} />
              : view === 'error' ? <Alert type="error" showIcon title={text('模拟加载失败', 'Simulated load failure')} description={text('无法确认数据，不显示为零或健康。原有本地样例保留。', 'Data is unknown, not zero or healthy. Local samples are retained.')} action={<Button onClick={() => setView('normal')}>{text('恢复本地样例', 'Restore local sample')}</Button>} />
                : view === 'empty' ? <section className="qmc-panel qmc-state-panel"><Empty description={text('当前范围暂无记录', 'No records in this scope')}><Button onClick={() => setView('normal')}>{text('恢复本地样例', 'Restore local sample')}</Button></Empty></section>
                  : <>
                    {view === 'readonly' && <Alert className="qmc-readonly" type="info" showIcon title={text('只读状态演示：保留查看入口，禁止本地修改。', 'Read-only simulation: details remain available; local edits are disabled.')} />}
                    {page === 'home' && <>
                      <div className="qmc-summary-grid">
                        <section className="qmc-panel qmc-summary"><div><span>{text('当前管理范围', 'Management scope')}</span><Building2 size={18} aria-hidden="true" /></div><h2>{text('演示公司', 'Demo organization')}</h2><p>{text('仅当前组织 · 不推断子组织权限', 'Current organization only; no inferred child access')}</p></section>
                        <section className="qmc-panel qmc-summary"><div><span>{text('身份与授权', 'Identity & access')}</span><ShieldCheck size={18} aria-hidden="true" /></div><h2>{text('样例管理身份', 'Sample identity')}</h2><p>{text('岗位来源与历史直接来源分开查看', 'Position and historical sources remain distinct')}</p></section>
                        <section className="qmc-panel qmc-summary"><div><span>{text('监控与外部交换', 'Monitoring & exchange')}</span><Unplug size={18} aria-hidden="true" /></div><h2>{text('未接入', 'Not connected')}</h2><p>{text('无采集时间 · 不展示在线率或成功率', 'No collection timestamp, uptime or success rate')}</p></section>
                      </div>
                      <div className="qmc-home-grid"><section className="qmc-panel"><div className="qmc-panel-heading"><h2>{text('常用管理入口', 'Management shortcuts')}</h2><span className="qmc-chip">{text('本地交互', 'Local interactions')}</span></div>
                        <button className="qmc-shortcut" type="button" onClick={() => navigate('users')}><span className="qmc-shortcut-icon"><Users size={21} aria-hidden="true" /></span><span><strong>{text('查看组织、岗位与用户', 'Organizations, positions & users')}</strong><small>{text('区分直属岗位、业务任职与授权来源', 'Direct positions, departmental appointments and access sources')}</small></span><ArrowRight size={18} aria-hidden="true" /></button>
                        <button className="qmc-shortcut" type="button" onClick={() => navigate('workflows')}><span className="qmc-shortcut-icon"><GitBranch size={21} aria-hidden="true" /></span><span><strong>{text('查看流程配置空间', 'Workflow configuration workspace')}</strong><small>{text('定义、草稿与版本，不代替待办审批', 'Definitions, drafts and versions, not business approvals')}</small></span><ArrowRight size={18} aria-hidden="true" /></button>
                        <div className="qmc-unconnected"><Unplug size={19} aria-hidden="true" /><div><strong>{text('真实管理事项与最近审计尚未接入', 'Management tasks and audit feed are not connected')}</strong><p>{text('本样例不伪造待办数量、实时事件或生产健康结论。', 'This preview does not invent task counts, live events or production health.')}</p></div></div>
                      </section><section className="qmc-panel"><div className="qmc-panel-heading"><h2>{text('工作空间边界', 'Workspace boundaries')}</h2></div><dl className="qmc-boundaries"><div><dt>{text('管理控制台', 'Management console')}</dt><dd>{text('身份、授权、受控定义与配置', 'Identity, access, controlled definitions and configuration')}</dd></div><div><dt>{text('业务工作空间', 'Business workspace')}</dt><dd>{text('待办、审批、单据进度与签章', 'Tasks, approvals, document progress and signatures')}</dd></div><div><dt>{text('演示数据', 'Demo data')}</dt><dd>{text('仅保留本页内存；刷新即重置', 'Page memory only; reload resets changes')}</dd></div></dl></section></div>
                    </>}
                    {page === 'users' && <>
                      <section className="qmc-scope-strip"><Building2 size={21} aria-hidden="true" /><div><strong>{text('演示公司 / 组织任职', 'Demo organization / appointments')}</strong><p>{text('组织直属岗位不需要挂靠业务部门；业务部门岗位保留其职责范围。', 'Direct organization positions do not require a department; department positions retain their own responsibility scope.')}</p></div><span className="qmc-chip">DEMO-ORG</span></section>
                      <section className="qmc-panel qmc-table-panel"><div className="qmc-panel-heading"><div><h2>{text('用户与岗位', 'Users & positions')}</h2><p>{text('全部记录为虚构样例；点击来源可查看细节。', 'All records are fictional. Open sources to inspect the distinction.')}</p></div><span className="qmc-chip">{text('本地清单', 'Local list')}</span></div>
                        <div className="qmc-table-toolbar"><Input aria-label={text('搜索本地用户', 'Search local users')} placeholder={text('搜索姓名、账号或岗位…', 'Search names, accounts or positions…')} prefix={<Search size={16} aria-hidden="true" />} value={search} onChange={event => setSearch(event.target.value)} allowClear /><label className="qmc-select-label">{text('任职归属', 'Affiliation')}<select value={affiliation} onChange={event => setAffiliation(event.target.value)}><option value="all">{text('全部任职', 'All appointments')}</option><option value="direct">{text('组织直属', 'Direct positions')}</option><option value="department">{text('业务部门', 'Department positions')}</option></select></label></div>
                        <Table<Person> rowKey="id" dataSource={visiblePeople} pagination={false} scroll={{ x: 860 }} locale={{ emptyText: text('没有匹配的本地用户', 'No matching local users') }} columns={[
                          { title: text('用户', 'User'), key: 'user', width: 150, render: (_, person) => <div className="qmc-user-cell"><strong>{person.name}</strong><small>{person.account}</small></div> },
                          { title: text('任职归属', 'Affiliation'), key: 'scope', width: 220, render: (_, person) => person.direct ? <span className="qmc-chip">{text('组织直属岗位', 'Direct organization position')}</span> : text('质量保证室 / 供应商质量科', 'Quality assurance / Supplier quality') },
                          { title: text('岗位', 'Position'), dataIndex: 'position', width: 185 },
                          { title: text('状态', 'Status'), key: 'status', width: 90, render: () => <span className="qmc-status"><span aria-hidden="true" />{text('样例启用', 'Demo active')}</span> },
                          { title: text('授权来源', 'Access sources'), key: 'sources', width: 150, render: (_, person) => <span>{person.legacy ? text('岗位 + 历史来源', 'Position + historical') : text('岗位任职', 'Position appointment')}</span> },
                          { title: text('操作', 'Action'), key: 'action', width: 130, render: (_, person) => <Button size="small" aria-label={text(`查看${person.name}的授权来源`, `View access sources for ${person.name}`)} onClick={() => { setSelected(person); setDraft(person.name); setEditing(false); setValidation(false); }}>{text('查看来源', 'View sources')}</Button> },
                        ]} />
                        <p className="qmc-table-note">{text('岗位是业务授权对象。历史来源仅供核对，本样例不迁移、不清理，也不改变任何平台管理标记。', 'Positions are business authorization objects. Historical sources are for inspection only; this preview does not migrate grants or change platform markers.')}</p>
                      </section>
                    </>}
                    {page === 'workflows' && <>
                      <section className="qmc-scope-strip"><GitBranch size={21} aria-hidden="true" /><div><strong>{text('定义与配置，不办理业务审批', 'Definitions and configuration, not business approvals')}</strong><p>{text('保留现有受控流程的定义、版本、校验发布与绑定边界；此处只预览视觉和查看交互。', 'Keep the existing controlled definition, version, validation, publication and binding boundaries. Visual and read-only interaction preview only.')}</p></div></section>
                      <section className="qmc-panel qmc-table-panel"><div className="qmc-panel-heading"><div><h2>{text('流程定义', 'Workflow definitions')}</h2><p>{text('样例版本，不反映线上配置状态。', 'Sample versions, not production configuration.')}</p></div><span className="qmc-chip">{text('仅查看', 'View only')}</span></div>
                        <Table rowKey="code" pagination={false} scroll={{ x: 720 }} dataSource={[
                          { code: 'DEMO-SUPPLIER', name: text('供应商问题处理', 'Supplier issue handling'), version: 'v3', status: text('已发布样例', 'Published sample'), binding: text('供应商质量 · 示例绑定', 'Supplier quality · sample binding') },
                          { code: 'DEMO-PROCESS', name: text('过程质量改进配置草稿', 'Process quality improvement draft'), version: 'v1', status: text('草稿样例', 'Draft sample'), binding: text('未绑定', 'Not bound') },
                        ]} columns={[
                          { title: text('定义名称 / 编码', 'Definition / code'), key: 'name', width: 260, render: (_, item) => <div className="qmc-user-cell"><strong>{item.name}</strong><small>{item.code}</small></div> },
                          { title: text('版本', 'Version'), dataIndex: 'version', width: 80 }, { title: text('状态', 'Status'), dataIndex: 'status', width: 130 }, { title: text('业务绑定', 'Binding'), dataIndex: 'binding', width: 200 },
                          { title: text('操作', 'Action'), key: 'action', width: 130, render: (_, item) => <Button size="small" aria-label={text(`查看${item.name}的配置`, `View configuration for ${item.name}`)} onClick={() => { setSelectedNode('demo-action'); setWorkflow(item.name); }}>{text('查看配置', 'View configuration')}</Button> },
                        ]} />
                      </section>
                      <div className="qmc-definition-note"><ShieldCheck size={19} aria-hidden="true" /><p>{text('配置权限不隐含业务审批资格。正式迁入继续使用已有流程服务、角色代码、版本保护和草稿恢复，不另造流程引擎。', 'Configuration access does not grant approval eligibility. Formal migration must reuse existing services, role codes, version protection and draft recovery, not create another workflow engine.')}</p></div>
                    </>}
                  </>}
          <footer className="qmc-footer"><span>QMS CONSOLE / INTERACTION PREVIEW</span><span>{text('独立外观 · 隔离样例 · 非生产入口', 'Independent appearance · Isolated demo · Not a production entry')}</span></footer>
        </main>
      </div>

      <Drawer title={text('管理导航', 'Management navigation')} open={mobileOpen} onClose={() => setMobileOpen(false)} placement="left" size={280} getContainer={false} rootClassName="qmc-mobile-drawer" styles={{ body: { padding: 16, display: 'flex', flexDirection: 'column' } }}><div id="qmc-mobile-navigation" className="qmc-mobile-navigation">{navigation}</div></Drawer>
      <Modal open={selected !== null} title={text('用户与授权来源', 'User & access sources')} onCancel={closeDetail} getContainer={false} destroyOnHidden width={660} footer={<><Button onClick={closeDetail}>{text('返回列表', 'Back to list')}</Button>{editing ? <Button type="primary" onClick={save}>{text('保存本地样例', 'Save local sample')}</Button> : <Button type="primary" disabled={readOnly} onClick={() => setEditing(true)}>{text('编辑本地显示名', 'Edit local display name')}</Button>}</>}>
        {selected && <div className="qmc-detail"><p className="qmc-detail-kicker">{text('虚构账号', 'Fictional account')} / {selected.account}</p>{editing ? <div className="qmc-editor"><label htmlFor="qmc-display-name">{text('显示名', 'Display name')}</label><Input id="qmc-display-name" autoFocus maxLength={80} value={draft} status={validation ? 'error' : undefined} aria-invalid={validation} aria-describedby="qmc-name-help" onChange={event => { setDraft(event.target.value); setValidation(false); }} onPressEnter={save} /><p id="qmc-name-help">{text('仅修改样例显示名，不改变岗位、授权或登录账号。', 'Only the demo display name changes; positions, grants and login remain unchanged.')}</p>{validation && <p role="alert">{text('显示名不能为空。', 'Display name is required.')}</p>}</div> : <h3>{selected.name}</h3>}
          <dl className="qmc-source-list"><div><dt>{text('任职来源', 'Appointment source')}</dt><dd>{selected.direct ? text('演示公司 → 组织直属岗位', 'Demo organization → direct position') : text('演示公司 → 质量保证室 → 供应商质量科', 'Demo organization → Quality assurance → Supplier quality')}<strong>{selected.position}</strong></dd></div><div><dt>{text('岗位权限', 'Position permissions')}</dt><dd>{selected.direct ? text('演示组织与账号管理；非真实权限证明', 'Demo organization and account management; not permission evidence') : text('演示职责范围内业务处理；不含平台管理', 'Demo business responsibility scope; no platform management')}</dd></div>{selected.legacy && <div><dt>{text('历史直接授权（只读）', 'Historical direct grants (read only)')}</dt><dd><code>QMS_ADMIN</code><p>{text('初始化兼容来源单独展示；未执行迁移或清理。', 'Bootstrap compatibility source is shown separately; no migration or cleanup performed.')}</p></dd></div>}</dl>
          <Alert type="info" showIcon title={text('平台管理标记不等于业务审批资格', 'A platform management marker is not business approval eligibility')} description={text('来源详情只演示信息层级。真实权限、MFA、最后管理来源保护与迁移影响由正式服务检查。', 'This shows information hierarchy only. Real grants, MFA, last-source protection and migration impact remain server responsibilities.')} />
        </div>}
      </Modal>
      <Modal title={text('放弃未保存的修改？', 'Discard unsaved changes?')} open={discard} onCancel={() => setDiscard(false)} getContainer={false} width={420} footer={<><Button onClick={() => setDiscard(false)}>{text('继续编辑', 'Keep editing')}</Button><Button danger type="primary" onClick={() => { setDiscard(false); setSelected(null); setEditing(false); }}>{text('放弃修改', 'Discard changes')}</Button></>}><p>{text('关闭将丢弃本次显示名输入，原样例保持不变。', 'Closing discards the display-name input. The original sample stays unchanged.')}</p></Modal>
      <Modal open={workflow !== null} title={text('流程定义预览', 'Workflow definition preview')} onCancel={() => setWorkflow(null)} getContainer={false} destroyOnHidden width={720} footer={<Button type="primary" onClick={() => setWorkflow(null)}>{text('返回定义列表', 'Back to definitions')}</Button>}>
        <div className="qmc-detail"><p className="qmc-detail-kicker">{text('配置空间 / 虚构定义', 'Configuration / fictional definition')}</p><h3>{workflow}</h3>
          <section className="qmc-definition-preview" aria-label={text('只读定义画布', 'Read-only definition canvas')}>
            <p>{text('复用现有画布 · 虚构最小定义 · 只读查看，不执行流程', 'Existing canvas · Fictional minimal definition · Read only, no execution')}</p>
            {workflow !== null && <WorkflowCanvas graph={demoGraph} readOnly selected={selectedNode} onSelect={setSelectedNode} onChange={() => {}} />}
          </section>
          <div className="qmc-node-inspector"><div className="qmc-node-actions" aria-label={text('节点检查', 'Node inspection')}>{demoGraph.nodes.map(node => <Button key={node.id} size="small" aria-pressed={selectedNode === node.id} onClick={() => setSelectedNode(node.id)}>{text(`检查${node.name}节点`, `Inspect ${node.name} node`)}</Button>)}</div><p>{text('节点类型：', 'Node type: ')}{demoGraph.nodes.find(node => node.id === selectedNode)?.type}</p><small>{text('节点选择仅用于查看配置，不代表审批动作或变更。', 'Node selection only inspects configuration, not an approval or mutation.')}</small></div>
          <dl className="qmc-source-list"><div><dt>{text('版本与发布', 'Version & publication')}</dt><dd>{text('角色代码、版本校验与发布仍由现有受控流程管理', 'Role codes, version checks and publication remain with existing controlled workflows')}</dd></div><div><dt>{text('业务绑定与职责', 'Bindings & responsibilities')}</dt><dd>{text('正式配置保留内部 / 供应商绑定及职责预览；本样例不保存任何变更。', 'Keep internal/supplier bindings and responsibility previews in formal configuration. This sample saves no definition changes.')}</dd></div></dl><Alert type="info" showIcon title={text('业务审批、待办与签章仍在业务工作空间', 'Approvals, tasks and signatures remain in the business workspace')} /></div>
      </Modal>
    </div>
  </ConfigProvider>;
}
