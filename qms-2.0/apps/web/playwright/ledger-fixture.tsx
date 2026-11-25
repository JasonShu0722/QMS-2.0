import { Button, Input, Pagination, Space } from 'antd';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider, LanguageSwitcher, useLanguage } from '../src/i18n/Language';
import { ConsoleTheme, useConsoleAppearance } from '../src/console/ConsoleTheme';
import { AppearanceButton } from '../src/theme/AppearanceButton';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { LedgerScopeProvider, LedgerTable, useLedgerPageSize } from '../src/ui/ledger';
import { useWorkTabsStore } from '../src/work-tabs/workTabsStore';
import '../src/styles/global.css';
import { ListToolbar } from '../src/ui/list/ListToolbar';

const rows = Array.from({ length: 12 }, (_, index) => ({
  id: String(index + 1), number: `SAMPLE-${String(index + 1).padStart(3, '0')}`,
  title: `模拟问题 ${index + 1}：核对列宽、排列及本地配置`, status: '处理中',
}));
useWorkTabsStore.getState().bindSession('INTERNAL:fixture-home:fixture-user');

function FixtureTable() {
  const [pageSize, setPageSize] = useLedgerPageSize('browser-verification');
  const [draft, setDraft] = useState('未保存的模拟草稿');
  const [listPage, setListPage] = useState(1);
  const [listPageSize, setListPageSize] = useState(20);
  return <Space orientation="vertical" style={{ width: '100%' }}>
    <Input aria-label="模拟草稿" value={draft} onChange={event => setDraft(event.target.value)} />
    <LedgerTable ledgerId="browser-verification" rowKey="id" requiredColumnKeys={['number']} dataSource={rows}
      pagination={{ pageSize, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], onChange: (_page, size) => setPageSize(size) }}
      columns={[
        { title: '编号', key: 'number', dataIndex: 'number', width: 180, minWidth: 120 },
        { title: '问题说明', key: 'title', dataIndex: 'title', width: 320, minWidth: 160 },
        { title: '状态', key: 'status', dataIndex: 'status', width: 140, minWidth: 100 },
      ]} />
    <section aria-label="独立列表分页模拟">
      <strong>独立列表分页 · 120条模拟数据</strong>
      <Pagination total={120} current={listPage} pageSize={listPageSize} showSizeChanger pageSizeOptions={[10, 20, 50, 100]}
        onChange={(page, size) => { setListPage(size === listPageSize ? page : 1); setListPageSize(size); }} />
    </section>
  </Space>;
}
function BoundaryFixture() {
  const [mode, setMode] = useState('none');
  const [draft, setDraft] = useState('保留草稿');
  const data = mode === 'empty' ? [] : rows.slice(0, 2).map((row, index) => ({ ...row, detail: mode === 'mixed' && index === 0 }));
  return <Space orientation="vertical" style={{ width: '100%' }}>
    <Input aria-label="边界模拟草稿" value={draft} onChange={event => setDraft(event.target.value)} />
    <Space><Button onClick={() => setMode('none')}>无可展开记录</Button><Button onClick={() => setMode('mixed')}>混合明细记录</Button><Button onClick={() => setMode('empty')}>空数据记录</Button></Space>
    <LedgerTable ledgerId="browser-boundaries-fix4" rowKey="id" requiredColumnKeys={['number']} dataSource={data} pagination={false}
      scroll={{ x: 1200 }} rowSelection={{}}
      expandable={{ rowExpandable: row => row.detail, expandedRowRender: row => <span>明细内容 {row.number}</span> }}
      columns={[
        { title: '编号', key: 'number', dataIndex: 'number', width: 180, fixed: 'left', sorter: (left, right) => left.number.localeCompare(right.number) },
        { title: '问题说明', key: 'title', dataIndex: 'title', width: 460, ellipsis: true },
        { title: '状态', key: 'status', dataIndex: 'status', width: 220, filters: [{ text: '处理中', value: '处理中' }], onFilter: (value, row) => row.status === value },
        { title: '操作', key: 'actions', width: 150, fixed: 'right', render: () => <Button>查看</Button> },
      ]} />
  </Space>;
}
function ToolbarFixture() {
  const [mode, setMode] = useState('many');
  const [loading, setLoading] = useState(false);
  const data = mode === 'empty' ? [] : mode === 'single' ? rows.slice(0, 2) : rows;
  return <section aria-label="共享工具栏组件验证">
    <Space wrap style={{ marginBottom: 8 }}>
      <Button onClick={() => setMode('many')}>多页数据</Button><Button onClick={() => setMode('single')}>单页数据</Button><Button onClick={() => setMode('empty')}>空数据</Button>
      <Button onClick={() => setLoading(value => !value)}>{loading ? '结束加载' : '开始加载'}</Button>
    </Space>
    <LedgerTable ledgerId="browser-toolbar-compact" rowKey="id" requiredColumnKeys={['number']} dataSource={data} loading={loading} scroll={{ x: 900 }}
      pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20], hideOnSinglePage: mode !== 'empty', showTotal: total => `总数：${total}` }}
      columns={[
        { title: '编号', key: 'number', dataIndex: 'number', width: 180 },
        { title: '问题说明', key: 'title', dataIndex: 'title', width: 460 },
        { title: '状态', key: 'status', dataIndex: 'status', width: 220 },
      ]} />
  </section>;
}
const stickyRows = Array.from({ length: 100 }, (_, index) => ({
  id: index + 1, title: `模拟问题 ${index + 1}`, status: '处理中', notes: '模拟核对记录',
}));
function StickyFixture({ short = false, pinned = false }: { short?: boolean; pinned?: boolean }) {
  return <section aria-label="共享台账吸顶验证">
    <LedgerTable ledgerId="browser-sticky" rowKey="id" requiredColumnKeys={['number']} dataSource={stickyRows}
      actionBar={<label>查询说明 <input aria-label="查询说明" /></label>}
      pinnedHorizontalScroll={pinned} rowSelection={short ? { fixed: true } : undefined}
      onRow={short ? () => ({ style: { height: 60 } }) : undefined}
      scroll={{ x: 1660 }} pagination={{ pageSize: short ? 10 : 50, showSizeChanger: false, showQuickJumper: false }}
      columns={[
        { title: '编号', key: 'number', dataIndex: 'id', width: 120, fixed: 'left', sorter: (left, right) => left.id - right.id, render: id => <button type="button">查看 {id}</button> },
        { title: '问题说明', key: 'title', dataIndex: 'title', width: 500 },
        { title: '状态', key: 'status', dataIndex: 'status', width: 300 },
        { title: '备注', key: 'notes', dataIndex: 'notes', width: 740 },
      ]} />
  </section>;
}
function CardListFixture() {
  return <section aria-label="卡片清单吸顶验证">
    <ListToolbar><button type="button">刷新卡片</button><Pagination total={120} /></ListToolbar>
    <ul>{stickyRows.slice(0, 20).map(row => <li key={row.id} style={{ minHeight: 100 }}><button type="button">查看版本 {row.id}</button></li>)}</ul>
  </section>;
}
function Fixture() {
  const [organization, setOrganization] = useState('fixture-target-a');
  const params = new URLSearchParams(window.location.search);
  const [consoleHost, setConsoleHost] = useState(params.has('console'));
  const content = <main className={consoleHost ? 'qms-console-content' : 'qms-content'} style={{ padding: 8, color: 'var(--qms-text)', background: 'var(--qms-background)' }}>
    <Space wrap style={{ marginBottom: 8 }}><strong>正式组件验证 · 仅模拟数据</strong><span>{organization}</span>
      <Button onClick={() => setOrganization(current => current === 'fixture-target-a' ? 'fixture-target-b' : 'fixture-target-a')}>切换演示目标组织</Button>
      <Button onClick={() => setConsoleHost(current => !current)}>切换演示宿主（当前{consoleHost ? '控制台' : '业务'}）</Button>
      <LanguageSwitcher />
      {consoleHost ? <ConsoleAppearanceControls /> : <AppearanceButton />}
    </Space>
    <p>宿主切换会重建模拟页，不验证业务草稿保持。</p>
    <LedgerScopeProvider organizationId={organization} portal={consoleHost ? 'console' : 'business'}>{params.has('cards') ? <CardListFixture /> : params.has('sticky') ? <StickyFixture short={params.has('short')} pinned={params.has('pinned')} /> : params.has('toolbar') ? <ToolbarFixture /> : params.has('boundaries') ? <BoundaryFixture /> : <FixtureTable />}</LedgerScopeProvider>
  </main>;
  return <LanguageProvider><ThemeProvider>{consoleHost ? <ConsoleTheme>{content}</ConsoleTheme> : content}</ThemeProvider></LanguageProvider>;
}
function ConsoleAppearanceControls() {
  const { t } = useLanguage();
  const { mode, setMode } = useConsoleAppearance();
  return <Space wrap role="group" aria-label={t('显示模式')}>
    {([{ value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }, { value: 'system', label: '跟随系统' }] as const).map(option => <Button key={option.value} aria-pressed={mode === option.value} onClick={() => setMode(option.value)}>{t(option.label)}</Button>)}
  </Space>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
