import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { transferableAbortController } from 'node:util';
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, csrfToken } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { WorkflowClosurePreview } from './WorkflowClosurePreview';

vi.mock('../../api/client', async importOriginal => ({ ...await importOriginal<typeof import('../../api/client')>(), apiRequest: vi.fn(), csrfToken: vi.fn() }));
vi.setConfig({ testTimeout: 30_000 });

const section = '00000000-0000-4000-8000-000000000001';
const professional = '00000000-0000-4000-8000-000000000002';
const owner = '00000000-0000-4000-8000-000000000003';
const manager = '00000000-0000-4000-8000-000000000004';
const directory: components['schemas']['WorkflowClosureOptionsDto'] = {
  departments: [{ id: section, code: 'QA', name: '质量科' }],
  users: [{ id: professional, username: 'engineer', fullName: '专业张工' }, { id: owner, username: 'owner', fullName: '负责人李工' }],
  departmentTotal: 1, userTotal: 2, page: 1, pageSize: 20,
};
const participant = { userId: professional, username: 'engineer', fullName: '专业张工', assignmentId: null, positionId: null, departmentId: section, bindingId: null, scopeId: null, bindingVersion: null, scopeVersion: null };
const preview: components['schemas']['WorkflowClosurePreviewDto'] = {
  previewOnly: true, configurationReady: true, organizationId: 'org', sectionDepartmentId: section,
  at: '2026-10-25T08:00:00.000Z', executionMode: 'PARALLEL',
  duties: [
    { duty: 'PROFESSIONAL', status: 'PENDING', participant },
    { duty: 'SECTION_MANAGER', status: 'SKIPPED_SAME_PERSON', participant: { ...participant, userId: owner, username: 'owner', fullName: '负责人李工' } },
  ], samePersonGroups: [], issues: [],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const posts = () => vi.mocked(apiRequest).mock.calls.filter(([, init]) => init?.method === 'POST');
const reads = () => vi.mocked(apiRequest).mock.calls.filter(([path]) => path.startsWith('/api/v1/workflows/closure-options'));
function mount(policy: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL', disabled = false) {
  const tree = (next: 'INTERNAL' | 'SUPPLIER', off = false) => <MemoryRouter initialEntries={['/app/workflow-designer']}><LanguageProvider><UnsavedChangesProvider><Routes>
    <Route path="/app/workflow-designer" element={<WorkflowClosurePreview policy={next} disabled={off} />} />
    <Route path="/login" element={<p>登录目的页</p>} />
  </Routes></UnsavedChangesProvider></LanguageProvider></MemoryRouter>;
  const view = render(tree(policy, disabled));
  return { ...view, change: (next: 'INTERNAL' | 'SUPPLIER', off = false) => view.rerender(tree(next, off)) };
}
async function choose(label: string, text: string) {
  const input = screen.getByLabelText(label);
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.mouseDown(input);
  const option = await waitFor(() => {
    const option = screen.getAllByText(text).find(element => element.closest('.ant-select-item-option-content') && !element.closest('.ant-select-dropdown-hidden'));
    expect(option).toBeDefined();
    return option!;
  });
  fireEvent.click(option);
  expect(input.closest('.ant-select')).toHaveTextContent(text);
}
async function configure(policy: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
  fireEvent.click(screen.getByRole('button', { name: '打开关闭职责预览' }));
  await waitFor(() => expect(reads()).toHaveLength(1));
  await choose('责任科室', '质量科 (QA)');
  await choose('专业人员（配置测试）', '专业张工 (engineer)');
  if (policy === 'INTERNAL') await choose('内部负责人（配置测试）', '负责人李工 (owner)');
}
async function submit() { fireEvent.click(screen.getByRole('button', { name: '运行配置预览' })); await waitFor(() => expect(posts()).toHaveLength(1)); }

beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); sessionStorage.clear();
  useWorkTabsStore.getState().reset(); useWorkTabsStore.getState().bindSession('INTERNAL:org:actor');
  vi.mocked(csrfToken).mockResolvedValue('csrf-test');
  vi.mocked(apiRequest).mockImplementation(async (path) => path.startsWith('/api/v1/workflows/closure-options') ? directory : preview);
});
afterEach(() => vi.unstubAllGlobals());

it('loads only on demand, posts generated contract inputs and presents read-only duties and source details', async () => {
  mount(); expect(apiRequest).not.toHaveBeenCalled();
  await configure(); await submit();
  expect(posts()[0]).toEqual(['/api/v1/workflows/closure-preview', expect.objectContaining({ method: 'POST', signal: expect.anything(), headers: { 'x-csrf-token': 'csrf-test' }, body: JSON.stringify({ policy: 'INTERNAL', severity: 'MEDIUM', responsibleSectionDepartmentId: section, professionalUserId: professional, ownerUserId: owner }) }), { replayAfterReauthentication: false }]);
  expect((await screen.findAllByText('待审'))[0]).toBeVisible();
  expect(screen.getByText('同人跳过')).toBeVisible();
  expect(screen.getByRole('dialog')).toHaveTextContent('不会发单或审批');
  fireEvent.click(screen.getAllByText('展开来源明细')[0]!);
  expect(screen.getByRole('dialog')).toHaveTextContent(section);
  expect(screen.queryByRole('button', { name: '确认审批' })).not.toBeInTheDocument();
});

it('keeps directory search in its dedicated input instead of an editable dropdown that disables itself on search', async () => {
  mount(); fireEvent.click(screen.getByRole('button', { name: '打开关闭职责预览' }));
  const picker = await screen.findByRole('combobox', { name: '责任科室' });
  await waitFor(() => expect(picker).toBeEnabled());
  expect(picker).toHaveAttribute('readonly');
  const search = screen.getByRole('textbox', { name: '搜索科室或内部人员' });
  await userEvent.type(search, '质');
  expect(search).toHaveFocus(); expect(search).toHaveValue('质');
  await waitFor(() => expect(reads().some(([path]) => path.includes('search=%E8%B4%A8'))).toBe(true));
});

it('shows two waiting supplier management duties for the same person without mixing professional confirmation', async () => {
  const source = { ...participant, userId: manager, username: 'manager', fullName: '管理王工' };
  vi.mocked(apiRequest).mockImplementation(async path => path.startsWith('/api/v1/workflows/closure-options') ? directory : {
    ...preview, executionMode: 'PROFESSIONAL_THEN_MANAGEMENT', duties: [preview.duties[0],
      { duty: 'SECTION_MANAGER', status: 'WAITING', participant: { ...source, assignmentId: owner } },
      { duty: 'MINISTER', status: 'WAITING', participant: { ...source, assignmentId: section } }],
    samePersonGroups: [{ userId: manager, duties: ['SECTION_MANAGER', 'MINISTER'] }],
  });
  mount('SUPPLIER'); await configure('SUPPLIER'); await choose('严重度', '高'); await submit();
  expect(JSON.parse(posts()[0]![1]!.body as string)).toMatchObject({ policy: 'SUPPLIER', severity: 'HIGH' });
  expect(JSON.parse(posts()[0]![1]!.body as string)).not.toHaveProperty('ownerUserId');
  expect(await screen.findByText('同人职责说明')).toBeVisible();
  expect(screen.getByRole('dialog')).toHaveTextContent('一次确认两项管理职责；正式办理时需明确两项职责并原子记录，本页不执行确认。');
  expect(screen.getAllByText('尚未启动')).toHaveLength(2);
  expect(screen.getByRole('dialog')).toHaveTextContent('科室经理'); expect(screen.getByRole('dialog')).toHaveTextContent('部长');
  expect(screen.queryByText('同人跳过')).not.toBeInTheDocument();
});

it('excludes supplier owner and renders WAITING without claiming execution eligibility', async () => {
  vi.mocked(apiRequest).mockImplementation(async path => path.includes('closure-options') ? directory : { ...preview, executionMode: 'PROFESSIONAL_THEN_MANAGEMENT', duties: [{ ...preview.duties[1]!, status: 'WAITING' }] });
  mount('SUPPLIER'); await configure('SUPPLIER'); await submit();
  expect(JSON.parse(posts()[0]![1]!.body as string)).not.toHaveProperty('ownerUserId');
  expect(screen.queryByRole('combobox', { name: '内部负责人（配置测试）' })).not.toBeInTheDocument();
  expect(await screen.findByText('尚未启动')).toBeVisible();
  expect(screen.getByRole('dialog')).toHaveTextContent('不代表执行授权');
});

it('searches and pages the bounded directory, retaining selected labels across pages', async () => {
  vi.mocked(apiRequest).mockImplementation(async path => path.includes('closure-options') ? { ...directory, departmentTotal: 45, userTotal: 65, ...(path.includes('page=2') || path.includes('search=missing') ? { departments: [], users: [] } : {}) } : preview);
  mount(); await configure();
  fireEvent.click(screen.getByTitle('2'));
  await waitFor(() => expect(reads().some(([path]) => path.includes('page=2') && path.includes('pageSize=20'))).toBe(true));
  expect(screen.getByRole('dialog')).toHaveTextContent('专业张工 (engineer)');
  expect(screen.getByRole('dialog')).toHaveTextContent('质量科 (QA)');
  fireEvent.change(screen.getByRole('textbox', { name: '搜索科室或内部人员' }), { target: { value: 'missing' } });
  await waitFor(() => expect(reads().some(([path]) => path.includes('search=missing') && path.includes('page=1'))).toBe(true));
  await submit();
  expect(JSON.parse(posts()[0]![1]!.body as string)).toMatchObject({ professionalUserId: professional, responsibleSectionDepartmentId: section });
});

it('clears results on edits and safe errors, shows trace and allows explicit retry', async () => {
  mount(); await configure(); await submit();
  expect(await screen.findByText('同人跳过')).toBeVisible();
  await choose('严重度', '高');
  expect(screen.queryByText('同人跳过')).not.toBeInTheDocument();
  vi.mocked(apiRequest).mockRejectedValueOnce(new ApiError({ code: 'VALIDATION_FAILED', message: 'unsafe diagnostic', traceId: 'closure-trace' }, 400));
  fireEvent.click(screen.getByRole('button', { name: '运行配置预览' }));
  expect(await screen.findByText('closure-trace')).toBeVisible();
  expect(screen.queryByText('unsafe diagnostic')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重试配置预览' }));
  expect(await screen.findByText('同人跳过')).toBeVisible();
  expect(posts()).toHaveLength(3);
});

it.each(['directory', 'preview'])('locks all operations on %s 403 without leaking previous results', async source => {
  const forbidden = new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'unsafe', traceId: 'denied-trace' }, 403);
  mount();
  if (source === 'directory') { vi.mocked(apiRequest).mockRejectedValueOnce(forbidden); fireEvent.click(screen.getByRole('button', { name: '打开关闭职责预览' })); }
  else { await configure(); vi.mocked(apiRequest).mockRejectedValueOnce(forbidden); await submit(); }
  await waitFor(() => expect(screen.getByText('denied-trace')).toBeVisible());
  expect(screen.getByRole('button', { name: '运行配置预览' })).toBeDisabled();
  expect(screen.queryByText('同人跳过')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /重试/ })).not.toBeInTheDocument();
});

it('serializes keyboard submit and repeated clicks and cannot close while CSRF is pending', async () => {
  const user = userEvent.setup();
  const token = deferred<string>(); vi.mocked(csrfToken).mockReturnValue(token.promise);
  mount(); await configure();
  const form = screen.getByRole('form', { name: '关闭职责配置测试' });
  screen.getByLabelText('搜索科室或内部人员').focus();
  await user.keyboard('{Enter}');
  expect(csrfToken).toHaveBeenCalledTimes(1);
  fireEvent.submit(form); fireEvent.submit(form);
  fireEvent.click(screen.getByRole('button', { name: '运行配置预览' }));
  expect(csrfToken).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '关闭预览' })).toBeDisabled();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });
  expect(screen.getByRole('dialog')).toBeVisible();
  await act(async () => token.resolve('late-csrf'));
  await waitFor(() => expect(posts()).toHaveLength(1));
});

it.each(['policy', 'session', 'disabled', 'unmount'])('never dispatches after late CSRF when %s invalidates the scope', async reason => {
  const token = deferred<string>(); vi.mocked(csrfToken).mockReturnValue(token.promise);
  const view = mount(); await configure();
  fireEvent.click(screen.getByRole('button', { name: '运行配置预览' }));
  const signal = vi.mocked(csrfToken).mock.calls[0]![0]!;
  if (reason === 'policy') view.change('SUPPLIER');
  if (reason === 'session') act(() => useWorkTabsStore.getState().bindSession('INTERNAL:other:new-actor'));
  if (reason === 'disabled') view.change('INTERNAL', true);
  if (reason === 'unmount') view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => token.resolve('late-token'));
  expect(posts()).toHaveLength(0);
});

it.each([false, true])('isolates late preview success/error after policy change (error=%s)', async fails => {
  const pending = deferred<typeof preview>();
  const view = mount(); await configure(); vi.mocked(apiRequest).mockReturnValueOnce(pending.promise); await submit();
  view.change('SUPPLIER');
  expect(posts()[0]![1]!.signal!.aborted).toBe(true);
  await act(async () => { if (fails) pending.reject(new ApiError({ code: 'AUTH_SESSION_REQUIRED', message: 'late' }, 401)); else pending.resolve(preview); });
  expect(useWorkTabsStore.getState().sessionScope).toBe('INTERNAL:org:actor');
  expect(screen.queryByText('同人跳过')).not.toBeInTheDocument();
  expect(screen.queryByText('登录目的页')).not.toBeInTheDocument();
});

it('finishes current-session 401 navigation through the shared busy guard', async () => {
  mount(); await configure();
  vi.mocked(apiRequest).mockRejectedValueOnce(new ApiError({ code: 'AUTH_SESSION_REQUIRED', message: 'expired' }, 401));
  await submit();
  expect(await screen.findByText('登录目的页')).toBeVisible();
  expect(useWorkTabsStore.getState().sessionScope).toBeUndefined();
  expect(screen.queryByText('当前草稿尚未保存，继续将放弃修改。')).not.toBeInTheDocument();
});

it('supports keyboard activation and closing with no unsaved-draft prompt', async () => {
  const user = userEvent.setup(); mount();
  screen.getByRole('button', { name: '打开关闭职责预览' }).focus(); await user.keyboard('{Enter}');
  await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible());
  await waitFor(() => expect(screen.getByRole('combobox', { name: '责任科室' })).toBeEnabled());
  within(screen.getByRole('dialog')).getByRole('button', { name: '关闭预览' }).focus(); await user.keyboard('{Enter}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: '打开关闭职责预览' })).toHaveFocus();
});

it('retries failed directory reads, aborts obsolete searches and ignores their late 401', async () => {
  mount();
  vi.mocked(apiRequest).mockRejectedValueOnce(new ApiError({ code: 'RATE_LIMITED', message: 'unsafe', traceId: 'directory-trace' }, 429));
  fireEvent.click(screen.getByRole('button', { name: '打开关闭职责预览' }));
  await waitFor(() => expect(screen.getByText('directory-trace')).toBeVisible());
  const old = deferred<typeof directory>(); vi.mocked(apiRequest).mockReturnValueOnce(old.promise);
  fireEvent.click(screen.getByRole('button', { name: '重试目录' }));
  await waitFor(() => expect(reads()).toHaveLength(2));
  fireEvent.change(screen.getByLabelText('搜索科室或内部人员'), { target: { value: 'QA' } });
  expect(reads()[1]![1]!.signal!.aborted).toBe(true);
  await waitFor(() => expect(reads()).toHaveLength(3));
  await act(async () => old.reject(new ApiError({ code: 'AUTH_SESSION_REQUIRED', message: 'old directory' }, 401)));
  expect(useWorkTabsStore.getState().sessionScope).toBe('INTERNAL:org:actor');
  expect(screen.queryByText('directory-trace')).not.toBeInTheDocument();
  expect(screen.getByLabelText('责任科室')).toBeEnabled();
});

it.each([false, true])('isolates late preview results from a replaced session (401=%s)', async unauthorized => {
  const pending = deferred<typeof preview>();
  mount(); await configure(); vi.mocked(apiRequest).mockReturnValueOnce(pending.promise); await submit();
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:new-org:new-user'));
  expect(posts()[0]![1]!.signal!.aborted).toBe(true);
  await act(async () => { if (unauthorized) pending.reject(new ApiError({ code: 'AUTH_SESSION_REQUIRED', message: 'old session' }, 401)); else pending.resolve(preview); });
  expect(useWorkTabsStore.getState().sessionScope).toBe('INTERNAL:new-org:new-user');
  expect(screen.queryByText('同人跳过')).not.toBeInTheDocument();
  expect(screen.queryByText('登录目的页')).not.toBeInTheDocument();
});

it('aborts a pending preview when unmounted', async () => {
  const pending = deferred<typeof preview>();
  const view = mount(); await configure(); vi.mocked(apiRequest).mockReturnValueOnce(pending.promise); await submit();
  view.unmount(); expect(posts()[0]![1]!.signal!.aborted).toBe(true);
  await act(async () => pending.resolve(preview));
  expect(screen.queryByText('同人跳过')).not.toBeInTheDocument();
});

it('clears an already displayed result and all identities on policy change', async () => {
  const view = mount(); await configure(); await submit();
  expect(await screen.findByText('同人跳过')).toBeVisible();
  view.change('SUPPLIER');
  expect(screen.queryByText('同人跳过')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '打开关闭职责预览' }));
  expect(screen.getByRole('button', { name: '运行配置预览' })).toBeDisabled();
  expect(screen.queryByText('负责人李工 (owner)')).not.toBeInTheDocument();
});

it('renders unresolved participants and configuration issues without pretending they are approvals', async () => {
  vi.mocked(apiRequest).mockImplementation(async path => path.includes('closure-options') ? directory : {
    ...preview, configurationReady: false, samePersonGroups: [], duties: [{ ...preview.duties[0]!, participant: null }],
    issues: [{ duty: 'MINISTER', code: 'SCOPE_MISSING' }],
  });
  mount('SUPPLIER'); await configure('SUPPLIER'); await submit();
  expect(await screen.findByText('尚未解析')).toBeVisible();
  expect(screen.getByText('部长：缺少有效分管')).toBeVisible();
  expect(screen.getByText('配置缺项，请维护后重新预览；本页不提供审批。')).toBeVisible();
});

it('does not open or load the directory when disabled', () => {
  mount('INTERNAL', true);
  expect(screen.getByRole('button', { name: '打开关闭职责预览' })).toBeDisabled();
  expect(apiRequest).not.toHaveBeenCalled();
});

it.each([false, true])('completes 401 navigation with the data-router busy blocker and parent draft dirty=%s', async dirty => {
  // React Router's native Request requires a Node-compatible signal in jsdom.
  vi.stubGlobal('AbortController', function () { return transferableAbortController(); });
  function ParentEditor() { useUnsavedChanges(dirty); return <WorkflowClosurePreview policy="INTERNAL" />; }
  const router = createMemoryRouter([
    { path: '/app/workflow-designer', element: <LanguageProvider><UnsavedChangesProvider><ParentEditor /></UnsavedChangesProvider></LanguageProvider> },
    { path: '/login', element: <p>登录目的页</p> },
  ], { initialEntries: ['/app/workflow-designer'] });
  render(<RouterProvider router={router} />);
  await configure();
  vi.mocked(apiRequest).mockRejectedValueOnce(new ApiError({ code: 'AUTH_SESSION_REQUIRED', message: 'expired' }, 401));
  await submit();
  expect(await screen.findByText('登录目的页')).toBeVisible();
  expect(router.state.location.pathname).toBe('/login');
  expect(useWorkTabsStore.getState().sessionScope).toBeUndefined();
  expect(screen.queryByText('当前草稿尚未保存，继续将放弃修改。')).not.toBeInTheDocument();
});
