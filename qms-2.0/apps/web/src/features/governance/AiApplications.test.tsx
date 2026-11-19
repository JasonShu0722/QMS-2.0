import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, createAdminMutation } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider, useNavigationGuard } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { AiApplications } from './AiApplications';

const mutate = vi.fn();
vi.mock('../../api/client', async original => ({ ...await original<typeof import('../../api/client')>(), apiRequest: vi.fn(), createAdminMutation: vi.fn() }));
const organization = { id: 'org', code: 'ORG', name: '当前组织', type: 'INTERNAL' as const, permissions: ['ai:applications:read', 'ai:applications:manage', 'ai:applications:publish', 'ai:applications:test', 'ai:connections:read'] };
const application = { id: 'application-1', organizationId: 'org', name: '不良现象整理', domain: 'PROCESS_QUALITY', scene: 'PROCESS_DEFECT_DESCRIPTION', enabled: true, variables: [{ variable: 'fault', label: '异常现象' }], connectionId: 'channel-1', model: 'quality-model', prompt: '整理{{fault}}', output: { mode: 'TEXT', field: 'description', target: 'description' }, fallback: 'DIRECT', version: 2, publishedVersion: 1, createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:00:00Z' };
const sourceRule = { id: 'rule-1', organizationId: 'org', name: '制程不良规则', target: 'PROCESS_DEFECT', descriptionComposition: { fields: [{ path: 'faultText', variable: 'fault', label: '接收现象' }], separator: '\n' } };
beforeEach(() => {
  localStorage.clear(); vi.stubEnv('NODE_ENV', 'development');
  useWorkTabsStore.getState().bindSession('INTERNAL:org:user');
  vi.mocked(createAdminMutation).mockReturnValue(mutate);
  vi.mocked(apiRequest).mockReset().mockImplementation(async path => path.includes('/ai-connections') ? [{ id: 'channel-1', organizationId: 'org', name: '质量模型', enabled: true, hasKey: true, models: ['quality-model'], defaultModel: 'quality-model' }] as never : path.includes('/integrations/ingestion/rules') ? { items: [sourceRule], total: 1, page: 1, limit: 100 } as never : { items: [application], total: 1, page: 1, limit: 20 } as never);
  mutate.mockReset().mockResolvedValue({ ...application, version: 3 });
});
afterEach(() => vi.unstubAllEnvs());
function Leave({ leave }: { leave: () => void }) { const guard = useNavigationGuard(); return <button onClick={() => guard(leave)}>离开应用</button>; }
function mount(permissions = organization.permissions, leave = vi.fn()) { return render(<LanguageProvider><MemoryRouter><UnsavedChangesProvider><AiApplications organization={{ ...organization, permissions }} /><Leave leave={leave} /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>); }
async function edit() { const row = (await screen.findByText(application.name, { selector: 'td' })).closest('tr')!; fireEvent.click(within(row).getByRole('button', { name: /^编\s*辑$/ })); return within(screen.getByRole('dialog', { name: '提示词应用' })); }

const invocationPermissions = ['ai:applications:read', 'audit:read', 'ingestion:read', 'process-quality:defects:read'];
it('opens paginated, organization-scoped call records for a read-only operator and distinguishes samples from runtime tasks', async () => {
  const path = '/api/v1/admin/ai-applications/application-1/invocations?organizationId=org&page=1&limit=20';
  vi.mocked(apiRequest).mockResolvedValueOnce({ items: [application], total: 1, page: 1, limit: 20 } as never)
    .mockResolvedValueOnce({ items: [
      { id: 'trial-event', organizationId: 'org', source: 'APPLICATION_TEST', applicationVersion: 2, status: 'SUCCESS', model: null, outputMode: null, connectionId: null, connectionVersion: null, attempts: null, errorCode: null, recordedAt: application.updatedAt, traceId: 'trial-trace', taskId: null },
      { id: 'actual-task', organizationId: 'org', source: 'RUNTIME_TASK', applicationVersion: 1, status: 'FAILED', model: 'runtime-model', outputMode: 'JSON', connectionId: 'runtime-channel', connectionVersion: 3, attempts: 2, errorCode: 'AI_CONNECTION_TIMEOUT', recordedAt: application.updatedAt, traceId: null, taskId: 'actual-task' },
    ], total: 2, page: 1, limit: 20 } as never);
  mount(invocationPermissions);
  const action = await screen.findByRole('button', { name: '调用记录' });
  expect(apiRequest).not.toHaveBeenCalledWith(path, expect.anything());
  fireEvent.click(action);
  const dialog = within(await screen.findByRole('dialog', { name: '调用记录' }));
  expect(await dialog.findByText('样本试运行')).toBeInTheDocument();
  expect(dialog.getByText('实际运行任务')).toBeInTheDocument();
  expect(dialog.getByText('runtime-model')).toBeInTheDocument();
  expect(dialog.getByRole('columnheader', { name: '输出模式' })).toBeInTheDocument();
  expect(dialog.getByRole('cell', { name: 'JSON' })).toBeInTheDocument();
  expect(dialog.getByText('AI_CONNECTION_TIMEOUT')).toBeInTheDocument();
  expect(dialog.getByText('actual-task')).toBeInTheDocument();
  expect(apiRequest).toHaveBeenCalledWith(path, expect.anything());
});
it.each(invocationPermissions.slice(1))('keeps call records hidden without %s', async permission => {
  mount(invocationPermissions.filter(code => code !== permission));
  await screen.findByText(application.name, { selector: 'td' });
  expect(screen.queryByRole('button', { name: '调用记录' })).not.toBeInTheDocument();
  expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path.includes('/invocations'))).toBe(false);
});

it('edits an application draft with scene variables and keeps publication a separate explicit action', async () => {
  mount(); const dialog = await edit();
  expect(dialog.getByLabelText('应用名称')).toHaveValue(application.name);
  expect(dialog.getByLabelText('变量名1')).toHaveValue('fault');
  expect(dialog.getByLabelText('变量标签1')).toHaveValue('异常现象');
  expect(dialog.queryByLabelText('IMS来源路径')).not.toBeInTheDocument();
  fireEvent.change(dialog.getByLabelText('提示词'), { target: { value: '仅整理{{fault}}' } });
  fireEvent.click(dialog.getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
  expect(mutate.mock.calls[0].slice(0, 3)).toEqual(['/api/v1/admin/ai-applications/application-1?organizationId=org', 'PATCH', { ...Object.fromEntries(Object.entries(application).filter(([key]) => !['id', 'organizationId', 'createdAt', 'updatedAt', 'version', 'publishedVersion'].includes(key))), prompt: '仅整理{{fault}}', expectedVersion: 2 }]);
  expect(mutate.mock.calls[0][0]).not.toContain('/publish');
});
it('takes prompt variable candidates from one saved process rule and inserts the selected variable', async () => {
  const permissions = [...organization.permissions, 'ingestion:read']; mount(permissions); const dialog = await edit();
  await waitFor(() => expect(dialog.getByLabelText('变量来源规则')).toBeInTheDocument());
  fireEvent.mouseDown(dialog.getByLabelText('变量来源规则')); fireEvent.click(await screen.findByText('制程不良规则', { selector: '.ant-select-item-option-content' }));
  expect(dialog.getByLabelText('变量名1')).toHaveValue('fault');
  expect(dialog.getByLabelText('变量标签1')).toHaveValue('接收现象');
  const prompt = dialog.getByLabelText<HTMLTextAreaElement>('提示词');
  fireEvent.change(prompt, { target: { value: '整理现象。' } });
  prompt.setSelectionRange(2, 4);
  fireEvent.click(dialog.getByRole('button', { name: '插入 fault' }));
  expect(prompt).toHaveValue('整理{{fault}}。');
  fireEvent.click(dialog.getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
  expect(mutate.mock.calls[0][2]).toMatchObject({ variables: [{ variable: 'fault', label: '接收现象' }], prompt: '整理{{fault}}。', expectedVersion: 2 });
});
it('preserves a migrated variable label with newline and tab when only renaming an application', async () => {
  const legacy = { ...application, variables: [{ variable: 'fault', label: '现象：\n\t' }] };
  vi.mocked(apiRequest).mockResolvedValueOnce({ items: [legacy], total: 1, page: 1, limit: 20 } as never);
  mount(); const dialog = await edit();
  fireEvent.change(dialog.getByLabelText('应用名称'), { target: { value: '仅重命名应用' } });
  fireEvent.click(dialog.getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
  expect(mutate.mock.calls[0][2]).toMatchObject({ name: '仅重命名应用', variables: legacy.variables, prompt: legacy.prompt, enabled: legacy.enabled, expectedVersion: legacy.version });
});
it.each([false, true])('allows a removed saved model only when disabling the application: enabled=%s', async enabled => {
  vi.mocked(apiRequest).mockImplementation(async path => path.includes('/ai-connections') ? [{ id: 'channel-1', organizationId: 'org', name: '质量模型', enabled: true, hasKey: true, models: ['replacement-model'], defaultModel: 'replacement-model' }] as never : { items: [application], total: 1, page: 1, limit: 20 } as never);
  mount(); const dialog = await edit();
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(expect.stringContaining('/ai-connections?'), expect.anything()));
  if (!enabled) fireEvent.click(dialog.getByRole('switch', { name: '启用应用' }));
  fireEvent.click(dialog.getByRole('button', { name: '保存草稿' }));
  if (enabled) {
    expect(await dialog.findByText('请选择可用模型')).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  } else {
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate.mock.calls[0].slice(0, 3)).toEqual(['/api/v1/admin/ai-applications/application-1?organizationId=org', 'PATCH', { ...Object.fromEntries(Object.entries(application).filter(([key]) => !['id', 'organizationId', 'createdAt', 'updatedAt', 'version', 'publishedVersion'].includes(key))), enabled: false, expectedVersion: 2 }]);
  }
});
it('retries the complete original draft after an unknown result and retains normal navigation protection', async () => {
  mutate.mockRejectedValueOnce(new TypeError('provider-private-detail')).mockResolvedValueOnce({ ...application, version: 3 });
  mount(); const dialog = await edit();
  fireEvent.change(dialog.getByLabelText('提示词'), { target: { value: '未确认{{fault}}' } });
  fireEvent.click(dialog.getByRole('button', { name: '保存草稿' }));
  const retry = await dialog.findByRole('button', { name: '重试原请求' });
  expect(dialog.getByLabelText('提示词')).toBeDisabled();
  expect(dialog.getByRole('button', { name: /^取\s*消$/ })).toBeDisabled();
  expect(document.body.textContent).not.toContain('provider-private-detail');
  fireEvent.click(retry);
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
  expect(mutate.mock.calls[1].slice(0, 3)).toEqual(mutate.mock.calls[0].slice(0, 3));
});
it('runs the saved draft only with explicit sample variables and publishes the saved version after confirmation', async () => {
  mutate.mockResolvedValueOnce({ applicationId: application.id, version: 2, status: 'SUCCESS', code: 'OK', text: '整理结果' }).mockResolvedValueOnce({ ...application, version: 3, publishedVersion: 2 });
  mount(); const row = (await screen.findByText(application.name, { selector: 'td' })).closest('tr')!;
  fireEvent.click(within(row).getByRole('button', { name: '样本试运行' }));
  const trial = within(screen.getByRole('dialog', { name: '样本试运行' }));
  expect(mutate).not.toHaveBeenCalled();
  fireEvent.change(trial.getByLabelText('异常现象'), { target: { value: '引脚断裂' } });
  fireEvent.click(trial.getByRole('button', { name: '运行样本' }));
  await waitFor(() => expect(trial.getByText('整理结果')).toBeVisible());
  expect(mutate.mock.calls[0].slice(0, 3)).toEqual(['/api/v1/admin/ai-applications/application-1/test?organizationId=org', 'POST', { expectedVersion: 2, samples: [{ variable: 'fault', value: '引脚断裂' }] }]);
  fireEvent.click(trial.getAllByRole('button', { name: /^关\s*闭$/ }).find(button => !button.classList.contains('ant-modal-close'))!);
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '样本试运行' })).not.toBeInTheDocument());
  fireEvent.click(within(row).getByRole('button', { name: '发布版本' }));
  const publishing = within(screen.getByRole('dialog', { name: '发布应用版本' }));
  await waitFor(() => expect(publishing.getByText('既有入库规则仍使用原绑定版本。')).toBeVisible());
  fireEvent.click(publishing.getByRole('button', { name: '确认发布' }));
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
  expect(mutate.mock.calls[1].slice(0, 3)).toEqual(['/api/v1/admin/ai-applications/application-1/publish?organizationId=org', 'POST', { expectedVersion: 2 }]);
});
it('readers have no write actions and an ABA identity transition retires pending application data', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(apiRequest).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  mount(['ai:applications:read']);
  expect(screen.queryByRole('button', { name: '新增应用' })).not.toBeInTheDocument();
  act(() => { useWorkTabsStore.getState().bindSession('INTERNAL:org:another'); useWorkTabsStore.getState().bindSession('INTERNAL:org:user'); });
  await act(async () => finish({ items: [application], total: 1, page: 1, limit: 20 }));
  expect(screen.queryByText(application.name)).not.toBeInTheDocument();
});
it('keeps draft maintenance separate from publication and sample calls', async () => {
  mount(['ai:applications:read', 'ai:applications:manage']);
  const row = (await screen.findByText(application.name, { selector: 'td' })).closest('tr')!;
  expect(screen.queryByRole('button', { name: '新增应用' })).not.toBeInTheDocument();
  expect(within(row).queryByRole('button', { name: '发布版本' })).not.toBeInTheDocument();
  expect(within(row).queryByRole('button', { name: '样本试运行' })).not.toBeInTheDocument();
  fireEvent.click(within(row).getByRole('button', { name: /^编\s*辑$/ }));
  const dialog = within(screen.getByRole('dialog', { name: '提示词应用' }));
  expect(dialog.getByRole('combobox', { name: '模型渠道' })).toBeDisabled();
  expect(apiRequest).not.toHaveBeenCalledWith(expect.stringContaining('/ai-connections'), expect.anything());
  fireEvent.change(dialog.getByLabelText('应用名称'), { target: { value: '仅草稿维护' } });
  fireEvent.click(dialog.getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
  expect(mutate.mock.calls[0][2]).toMatchObject({ name: '仅草稿维护', connectionId: application.connectionId, model: application.model });
});
it.each([
  ['ai:applications:publish', '发布版本', '样本试运行'],
  ['ai:applications:test', '样本试运行', '发布版本'],
])('exposes only the separately assigned %s operation', async (permission, allowed, denied) => {
  mount(['ai:applications:read', permission]);
  const row = (await screen.findByText(application.name, { selector: 'td' })).closest('tr')!;
  expect(within(row).getByRole('button', { name: allowed })).toBeEnabled();
  expect(within(row).queryByRole('button', { name: denied })).not.toBeInTheDocument();
  expect(within(row).queryByRole('button', { name: /^编\s*辑$/ })).not.toBeInTheDocument();
});
it('known draft conflicts preserve editable input and busy blocks leaving until the request settles', async () => {
  let rejectWrite!: (cause: unknown) => void;
  mutate.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectWrite = reject; }));
  const leave = vi.fn(); mount(organization.permissions, leave); const dialog = await edit();
  fireEvent.change(dialog.getByLabelText('提示词'), { target: { value: '保留{{fault}}' } });
  fireEvent.click(dialog.getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: '离开应用' })); expect(leave).not.toHaveBeenCalled();
  await act(async () => rejectWrite(new ApiError({ code: 'CONCURRENCY_CONFLICT', message: 'private' }, 409)));
  expect(await dialog.findByRole('alert')).toBeVisible();
  expect(dialog.getByLabelText('提示词')).toHaveValue('保留{{fault}}');
  expect(dialog.getByRole('button', { name: '保存草稿' })).toBeEnabled();
});
