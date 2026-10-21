import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import type { ReactNode } from 'react';
import { fireEvent, render as testingRender, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import type { AdminOrganization } from '../admin/admin';
import { ConfigurationAdministration } from './ConfigurationAdministration';
import type { NotificationRule, PositionCategory, Settings } from './governance';

const render = (children: ReactNode) => testingRender(<ConfigProvider locale={zhCN} theme={{ token: { motion: false } }}>{children}</ConfigProvider>);

const organization: AdminOrganization = { id: 'org-a', code: 'A', name: '甲组织', type: 'INTERNAL', permissions: ['configuration:read', 'configuration:manage'] };
const settings: Settings = { notificationLocale: 'zh-CN', exportRetentionMinutes: 60, version: 3 };
const rule: NotificationRule = { kind: 'TASK_ASSIGNED', enabled: true, subjectTemplate: '任务标题', bodyTemplate: '任务正文', version: 2 };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
beforeEach(() => { localStorage.clear(); // rc-component uses one shared test-id in test mode; keep dialog and Select IDs distinct.
  vi.stubEnv('NODE_ENV', 'development'); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function mountConfiguration(saveFailureStatus?: number) {
  const writes: RequestInit[] = [];
  const reads: string[] = [];
  const server = { rule, categories: [] as PositionCategory[] };
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (init.method && init.method !== 'GET') writes.push(init);
    else reads.push(path);
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf-test' });
    if (init.method === 'PATCH' && saveFailureStatus) return json({ code: saveFailureStatus === 409 ? 'CONCURRENCY_CONFLICT' : 'HTTP_500', traceId: 'configuration-save-failed' }, saveFailureStatus);
    if (path.includes('/settings?')) return json(settings);
    if (path.includes('/notification-rules?')) return json([server.rule]);
    if (path.includes('/position-categories?')) return json(server.categories);
    if (path.includes('/notification-rules/') && init.method === 'PATCH') return json({ ...server.rule, ...JSON.parse(String(init.body)), version: server.rule.version + 1 });
    throw new Error(`unexpected ${path}`);
  }));
  render(<MemoryRouter><UnsavedChangesProvider><Routes>
    <Route path="/" element={<><Link to="/other">离开配置</Link><ConfigurationAdministration organization={organization} /></>} />
    <Route path="/other" element={<h1>目标页面</h1>} />
  </Routes></UnsavedChangesProvider></MemoryRouter>);
  return { writes, reads, server };
}

it.each(['rule', 'category'] as const)('configuration %s refresh handler discards editor state only after confirmation and rereads server versions', async (kind) => {
  const user = userEvent.setup();
  const { writes, reads, server } = mountConfiguration();
  const refresh = screen.getByRole('button', { name: /^刷\s*新$/ });
  await waitFor(() => expect(refresh).toBeEnabled());
  await user.click(screen.getByRole('button', { name: kind === 'rule' ? /^编\s*辑$/ : /^新\s*建$/ }));
  const title = kind === 'rule' ? '通知规则' : '岗位类别';
  const label = kind === 'rule' ? '通知标题' : '名称';
  const editor = await screen.findByRole('dialog', { name: title });
  const input = within(editor).getByLabelText(label);
  await waitFor(() => expect(input).toBeVisible());
  fireEvent.change(input, { target: { value: '未保存草稿' } });
  const dirtyUnload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(dirtyUnload);
  expect(dirtyUnload.defaultPrevented).toBe(true);
  const initialReads = [...reads];

  // The page refresh is behind the Modal: fireEvent tests the handler contract, not a browser click path.
  fireEvent.click(refresh);
  const confirmation = await screen.findByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' });
  await waitFor(() => expect(confirmation).toBeVisible(), { timeout: 5000 });
  expect(reads).toEqual(initialReads);
  await user.click(screen.getByRole('button', { name: '继续编辑' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' })).not.toBeInTheDocument());
  await waitFor(() => expect(editor).toBeVisible(), { timeout: 5000 });
  expect(input).toHaveValue('未保存草稿');
  expect(reads).toEqual(initialReads);
  expect(writes).toEqual([]);

  server.rule = { ...rule, subjectTemplate: '服务端新标题', version: 7 };
  server.categories = [{ id: 'category-a', code: 'A', name: '服务端新类别', status: 'ACTIVE', sortOrder: 0, version: 5 }];
  fireEvent.click(refresh);
  const discardConfirmation = await screen.findByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' });
  await waitFor(() => expect(discardConfirmation).toBeVisible(), { timeout: 5000 });
  expect(reads).toEqual(initialReads);
  await user.click(screen.getByRole('button', { name: /^放弃修改(?:并关闭)?$/ }));
  await waitFor(() => expect(reads).toHaveLength(initialReads.length + 3));
  await waitFor(() => expect(refresh).toBeEnabled());
  const cleanUnload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(cleanUnload);
  expect(cleanUnload.defaultPrevented).toBe(false);
  await waitFor(() => expect(screen.queryByRole('dialog', { name: title })).not.toBeInTheDocument());
  expect(writes).toEqual([]);

  const row = screen.getByRole('row', { name: kind === 'rule' ? /任务分配/ : /服务端新类别/ });
  if (kind === 'rule') expect(within(row).getByRole('cell', { name: /^7$/ })).toBeVisible();
  await user.click(within(row).getByRole('button', { name: /^编\s*辑$/ }));
  const reopened = await screen.findByRole('dialog', { name: title });
  expect(within(reopened).getByLabelText(label)).toHaveValue(kind === 'rule' ? '服务端新标题' : '服务端新类别');
  expect(writes).toEqual([]);
  if (kind === 'rule') {
    fireEvent.change(within(reopened).getByLabelText(label), { target: { value: '明确保存新标题' } });
    await user.click(within(reopened).getByRole('button', { name: /^保\s*存$/ }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(JSON.parse(String(writes[0].body))).toMatchObject({ subjectTemplate: '明确保存新标题', expectedVersion: 7 });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  }
}, 30000);

it('configuration category draft cancel retains changes until discard without saving settings or rules', async () => {
  const user = userEvent.setup();
  const { writes } = mountConfiguration();
  await waitFor(() => expect(screen.getByRole('button', { name: /^刷\s*新$/ })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: /^新\s*建$/ }));
  const editor = await screen.findByRole('dialog', { name: '岗位类别' });
  await waitFor(() => expect(within(editor).getByLabelText('名称')).toBeVisible());
  fireEvent.change(within(editor).getByLabelText('名称'), { target: { value: '未保存类别' } });
  await user.click(within(editor).getByRole('button', { name: /^取\s*消$/ }));
  await screen.findByText('当前草稿尚未保存，继续将放弃修改。');
  await user.click(screen.getByRole('button', { name: '继续编辑' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' })).not.toBeInTheDocument());
  expect(within(editor).getByLabelText('名称')).toHaveValue('未保存类别');
  await user.click(within(editor).getByRole('button', { name: /^取\s*消$/ }));
  await user.click(await screen.findByRole('button', { name: /^放弃修改(?:并关闭)?$/ }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await user.click(screen.getByRole('button', { name: /^新\s*建$/ }));
  expect(within(await screen.findByRole('dialog', { name: '岗位类别' })).getByLabelText('名称')).toHaveValue('');
  expect(writes).toEqual([]);
}, 30000);

it.each(['refresh', 'navigate'] as const)('configuration settings draft requires confirmation before %s and keeps input on continue', async (action) => {
  const user = userEvent.setup();
  const { writes, reads } = mountConfiguration();
  const retention = await screen.findByLabelText('导出保留时间（分钟）');
  await waitFor(() => expect(retention).toHaveValue('60'));
  await waitFor(() => expect(screen.getByRole('button', { name: /^刷\s*新$/ })).toBeEnabled());
  fireEvent.change(retention, { target: { value: '120' } });
  expect(retention).toHaveValue('120');
  const initialReads = reads.filter(path => path.includes('/settings?')).length;
  const leave = () => action === 'refresh'
    ? user.click(screen.getByRole('button', { name: /^刷\s*新$/ }))
    : user.click(screen.getByRole('link', { name: '离开配置' }));
  await leave();
  await screen.findByText('当前草稿尚未保存，继续将放弃修改。');
  expect(reads.filter(path => path.includes('/settings?'))).toHaveLength(initialReads);
  expect(screen.queryByRole('heading', { name: '目标页面' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '继续编辑' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' })).not.toBeInTheDocument());
  expect(retention).toHaveValue('120');
  await leave();
  await user.click(await screen.findByRole('button', { name: /^放弃修改(?:并关闭)?$/ }));
  if (action === 'refresh') {
    await waitFor(() => expect(reads.filter(path => path.includes('/settings?'))).toHaveLength(initialReads + 1));
    await waitFor(() => expect(screen.getByLabelText('导出保留时间（分钟）')).toHaveValue('60'));
  } else expect(await screen.findByRole('heading', { name: '目标页面' })).toBeVisible();
  expect(writes).toEqual([]);
}, 30000);

it('configuration notification draft close requires confirmation and switching remains local until save', async () => {
  const user = userEvent.setup();
  const { writes } = mountConfiguration();
  await user.click(await screen.findByRole('button', { name: /^编\s*辑$/ }));
  const editor = await screen.findByRole('dialog', { name: '通知规则' });
  const enabled = within(editor).getByRole('switch', { name: '发送站内通知' });
  await waitFor(() => expect(enabled).toBeVisible());
  expect(enabled).toBeChecked();
  await user.click(enabled);
  expect(enabled).not.toBeChecked();
  expect(writes).toEqual([]);
  await user.click(within(editor).getByRole('button', { name: '关闭' }));
  await screen.findByText('当前草稿尚未保存，继续将放弃修改。');
  await user.click(screen.getByRole('button', { name: '继续编辑' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' })).not.toBeInTheDocument());
  expect(enabled).not.toBeChecked();
  await user.click(within(editor).getByRole('button', { name: '关闭' }));
  await user.click(await screen.findByRole('button', { name: /^放弃修改(?:并关闭)?$/ }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await user.click(screen.getByRole('button', { name: /^编\s*辑$/ }));
  const reopened = await screen.findByRole('dialog', { name: '通知规则' });
  expect(within(reopened).getByRole('switch', { name: '发送站内通知' })).toBeChecked();
  expect(writes).toEqual([]);
}, 30000);

it.each([409, 500])('configuration error retry after a %s save failure protects the settings draft until discard', async (status) => {
  const user = userEvent.setup();
  const { writes, reads } = mountConfiguration(status);
  const retention = await screen.findByLabelText('导出保留时间（分钟）');
  await waitFor(() => expect(retention).toHaveValue('60'));
  fireEvent.change(retention, { target: { value: '120' } });
  await user.click(screen.getByRole('button', { name: /^保\s*存$/ }));
  await screen.findByText('configuration-save-failed');
  expect(writes).toHaveLength(1);
  expect(JSON.parse(String(writes[0].body))).toMatchObject({ exportRetentionMinutes: 120, expectedVersion: settings.version });
  expect(retention).toHaveValue('120');
  const initialReads = reads.filter(path => path.includes('/settings?')).length;

  await user.click(screen.getByRole('button', { name: /^重\s*试$/ }));
  await screen.findByText('当前草稿尚未保存，继续将放弃修改。');
  expect(reads.filter(path => path.includes('/settings?'))).toHaveLength(initialReads);
  await user.click(screen.getByRole('button', { name: '继续编辑' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(retention).toHaveValue('120');
  expect(reads.filter(path => path.includes('/settings?'))).toHaveLength(initialReads);

  await user.click(screen.getByRole('button', { name: /^重\s*试$/ }));
  await user.click(await screen.findByRole('button', { name: /^放弃修改(?:并关闭)?$/ }));
  await waitFor(() => expect(reads.filter(path => path.includes('/settings?'))).toHaveLength(initialReads + 1));
  await waitFor(() => expect(screen.getByLabelText('导出保留时间（分钟）')).toHaveValue('60'));
  expect(writes).toHaveLength(1);
}, 30000);
