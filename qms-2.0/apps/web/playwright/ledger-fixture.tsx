import { Button, Input, Pagination, Space } from 'antd';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider, LanguageSwitcher, useLanguage } from '../src/i18n/Language';
import { ConsoleTheme, useConsoleAppearance } from '../src/console/ConsoleTheme';
import { AppearanceButton } from '../src/theme/AppearanceButton';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { LedgerScopeProvider, LedgerTable, useLedgerPageSize } from '../src/ui/ledger';
import { useWorkTabsStore } from '../src/work-tabs/workTabsStore';

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
function Fixture() {
  const [organization, setOrganization] = useState('fixture-target-a');
  const [consoleHost, setConsoleHost] = useState(false);
  const content = <main className={consoleHost ? 'qms-console-content' : 'qms-content'} style={{ padding: 8, color: 'var(--qms-text)', background: 'var(--qms-background)' }}>
    <Space wrap style={{ marginBottom: 8 }}><strong>正式组件验证 · 仅模拟数据</strong><span>{organization}</span>
      <Button onClick={() => setOrganization(current => current === 'fixture-target-a' ? 'fixture-target-b' : 'fixture-target-a')}>切换演示目标组织</Button>
      <Button onClick={() => setConsoleHost(current => !current)}>切换演示宿主（当前{consoleHost ? '控制台' : '业务'}）</Button>
      <LanguageSwitcher />
      {consoleHost ? <ConsoleAppearanceControls /> : <AppearanceButton />}
    </Space>
    <p>宿主切换会重建模拟页，不验证业务草稿保持。</p>
    <LedgerScopeProvider organizationId={organization} portal={consoleHost ? 'console' : 'business'}><FixtureTable /></LedgerScopeProvider>
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
