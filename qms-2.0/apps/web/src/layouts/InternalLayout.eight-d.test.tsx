import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { LanguageProvider } from '../i18n/Language';
import { publishSessionSignal } from '../features/auth/session-invalidation';
import { InternalLayout } from './InternalLayout';
import { activeInternalDomain, internalDomains } from '../features/navigation/navigation';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';

vi.mock('../features/problem-center/ProblemCenterPage', () => ({ ProblemCenterPage: ({ eightDDomain }: { eightDDomain?: string }) => <div>followup:{eightDDomain}</div> }));
vi.mock('../features/customer-quality/CustomerQualityPage', () => ({ CustomerQualityPage: () => <div>customer-ledger</div> }));
vi.mock('../features/new-product-quality/NewProductQualityPage', () => ({ NewProductQualityPage: () => <div>new-product-ledger</div> }));
vi.mock('../features/process-eight-d/ProcessEightDWorkspace', () => ({ ProcessEightDWorkspace: ({ onRefresh }: { onRefresh?: () => void }) => <div>制程 8D 办理<button onClick={onRefresh}>刷新工作区</button></div> }));
const instance: components['schemas']['ProblemInstanceDto'] = {
  id: 'instance', workflowVersionId: 'workflow-version', version: 1, status: 'RUNNING', currentNodeId: 'node',
  current: true, createdAt: '2026-11-26T00:00:00Z',
};
const workspaceRecord = (problemId: string, title: string) => ({
  problem: { id: problemId, organizationId: 'org', reportNumber: '8D-2026-001', domainCode: 'process-quality', summary: { title } },
  domain: { summary: { domainUiKey: 'process-eight-d' }, sections: [] }, selectedInstance: instance, instances: [instance],
});
beforeEach(() => {
  useWorkTabsStore.getState().reset();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [], permissions: [] })));
});
it.each(['customer-quality', 'new-product-quality'])('routes %s follow-up exclusively without mounting its editable ledger', async domain => {
  render(<MemoryRouter initialEntries={[`/app/${domain}/problems`]}><LanguageProvider><InternalLayout /></LanguageProvider></MemoryRouter>);
  expect(await screen.findByText(`followup:${domain}`)).toBeVisible();
  expect(screen.queryByText('customer-ledger')).not.toBeInTheDocument();
  expect(screen.queryByText('new-product-ledger')).not.toBeInTheDocument();
  expect(activeInternalDomain(`/app/${domain}/problems`)?.path).toBe(`/app/${domain}/problems`);
  expect(internalDomains.flatMap(item => item.children).filter(item => item.path === `/app/${domain}/problems`)).toHaveLength(1);
});

it.each([
  ['装配工序尺寸超差', '装配工序尺寸超差'],
  ['  ', '8D-2026-001'],
])('keeps the authorized problem label %s after returning to the workbench', async (title, label) => {
  const problemId = '3fe4f86d-0000-4000-8000-000000000001';
  const path = `/app/problem-workspace/${problemId}`;
  const store = useWorkTabsStore.getState();
  store.openTab({ id: '/app/process-quality/problems', title: '制程问题跟进', path: '/app/process-quality/problems' });
  vi.stubGlobal('fetch', vi.fn(async (input: string) => Response.json(input.includes(problemId) ? workspaceRecord(problemId, title) : { items: [], permissions: [] })));
  render(<MemoryRouter initialEntries={[path]}><LanguageProvider><InternalLayout /></LanguageProvider></MemoryRouter>);
  const header = within(screen.getByRole('banner'));
  expect(header.getByRole('link', { name: '问题处理' })).toHaveAttribute('href', path);
  await header.findByRole('link', { name: label });

  await userEvent.click(screen.getByRole('link', { name: '综合工作台' }));
  expect(header.getByText('综合工作台')).toBeVisible();
  expect(header.getByRole('link', { name: label })).not.toHaveAttribute('aria-current');
  await userEvent.click(header.getByRole('button', { name: '全部标签' }));
  expect(within(screen.getByRole('dialog')).getByRole('button', { name: label })).toBeVisible();
});

it('resets the label while reopening a problem and keeps it generic on denial', async () => {
  const problemId = '3fe4f86d-0000-4000-8000-000000000001';
  const path = `/app/problem-workspace/${problemId}`;
  const title = '装配工序尺寸超差';
  const store = useWorkTabsStore.getState();
  store.openTab({ id: '/app/process-quality/problems', title: '制程问题跟进', path: '/app/process-quality/problems' });
  let resolveRecheck!: (response: Response) => void;
  const recheck = new Promise<Response>(resolve => { resolveRecheck = resolve; });
  const readWorkspace = vi.fn()
    .mockResolvedValueOnce(Response.json(workspaceRecord(problemId, title)))
    .mockReturnValueOnce(recheck);
  vi.stubGlobal('fetch', vi.fn(async (input: string) => input.includes(problemId) ? readWorkspace() : Response.json({ items: [], permissions: [] })));
  render(<MemoryRouter initialEntries={[path]}><LanguageProvider><InternalLayout /></LanguageProvider></MemoryRouter>);
  const header = within(screen.getByRole('banner'));
  await header.findByRole('link', { name: title });
  await userEvent.click(screen.getByRole('link', { name: '综合工作台' }));
  await userEvent.click(header.getByRole('link', { name: title }));
  await waitFor(() => expect(readWorkspace).toHaveBeenCalledTimes(2));
  expect(header.getByRole('link', { name: '问题处理' })).toHaveAttribute('aria-current', 'page');
  expect(header.queryByRole('link', { name: title })).not.toBeInTheDocument();

  await act(async () => resolveRecheck(Response.json({ message: 'Forbidden' }, { status: 403 })));
  expect(header.getByRole('link', { name: '问题处理' })).toBeVisible();
  expect(header.queryByRole('link', { name: title })).not.toBeInTheDocument();
});

it.each([true, false])('renames after same-page revalidation with a delayed old read (old first: %s)', async oldFirst => {
  const problemId = '3fe4f86d-0000-4000-8000-000000000001';
  const path = `/app/problem-workspace/${problemId}`;
  const store = useWorkTabsStore.getState();
  store.bindSession('INTERNAL:org:user');
  store.openTab({ id: '/app/process-quality/problems', title: '制程问题跟进', path: '/app/process-quality/problems' });
  const record = (title: string) => Response.json(workspaceRecord(problemId, title));
  let resolveOld!: (response: Response) => void;
  let resolveNew!: (response: Response) => void;
  const older = new Promise<Response>(resolve => { resolveOld = resolve; });
  const newer = new Promise<Response>(resolve => { resolveNew = resolve; });
  const readWorkspace = vi.fn().mockResolvedValueOnce(record('已打开的问题')).mockReturnValueOnce(older).mockReturnValueOnce(newer);
  vi.stubGlobal('fetch', vi.fn(async (input: string) => input.includes(problemId) ? readWorkspace() : Response.json({ items: [], permissions: [] })));
  render(<MemoryRouter initialEntries={[path]}><LanguageProvider><InternalLayout /></LanguageProvider></MemoryRouter>);
  const header = within(screen.getByRole('banner'));
  await header.findByRole('link', { name: '已打开的问题' });
  await userEvent.click(await screen.findByRole('button', { name: '刷新工作区' }));
  await waitFor(() => expect(readWorkspace).toHaveBeenCalledTimes(2));
  act(() => publishSessionSignal('revalidate'));
  expect(header.getByRole('link', { name: '问题处理', current: 'page' })).toBeVisible();

  if (oldFirst) {
    await act(async () => resolveOld(record('旧授权结果')));
    expect(header.getByRole('link', { name: '问题处理', current: 'page' })).toBeVisible();
  }
  await userEvent.click(await screen.findByRole('button', { name: '刷新工作区' }));
  await waitFor(() => expect(readWorkspace).toHaveBeenCalledTimes(3));
  await act(async () => resolveNew(record('本次授权的问题标题')));
  expect(header.getByRole('link', { name: '本次授权的问题标题', current: 'page' })).toBeVisible();

  if (!oldFirst) await act(async () => resolveOld(record('旧授权结果')));
  expect(header.getByRole('link', { name: '本次授权的问题标题', current: 'page' })).toBeVisible();
  expect(header.queryByRole('link', { name: '旧授权结果' })).not.toBeInTheDocument();
});
