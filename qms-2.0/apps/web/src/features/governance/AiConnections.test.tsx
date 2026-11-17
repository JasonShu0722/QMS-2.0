import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, createAdminMutation } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider, useNavigationGuard } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { ConfigurationAdministration } from './ConfigurationAdministration';
import { AiConnections } from './AiConnections';

const mutate = vi.fn();
vi.mock('../../api/client', async original => ({ ...await original<typeof import('../../api/client')>(), apiRequest: vi.fn(), createAdminMutation: vi.fn() }));
vi.mock('./ProcessOperationSectors', () => ({ ProcessOperationSectors: () => <div>工序板块规则</div> }));
const organization = { id: 'org', code: 'ORG', name: '当前组织', type: 'INTERNAL', permissions: ['configuration:read', 'configuration:manage'] } as const;
const connection = { id: 'ai-1', organizationId: 'org', name: '生产描述', baseUrl: 'https://models.example.com/v1', models: ['quality-model', 'quality-fast'], defaultModel: 'quality-model', enabled: true, hasKey: true, version: 2, createdAt: '2026-11-16T00:00:00Z', updatedAt: '2026-11-16T00:00:00Z' };
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development'); localStorage.clear();
  useWorkTabsStore.getState().bindSession('INTERNAL:org:user');
  vi.mocked(createAdminMutation).mockReturnValue(mutate);
  vi.mocked(apiRequest).mockReset().mockImplementation(async path => {
    if (path.includes('/ai-connections')) return [connection] as never;
    if (path.includes('/settings')) return { notificationLocale: 'zh-CN', exportRetentionMinutes: 60, version: 1 } as never;
    return [] as never;
  });
  mutate.mockReset().mockResolvedValue({ ...connection, version: 3 });
});
afterEach(() => vi.unstubAllEnvs());
function NavigationProbe({ leave }: { leave: () => void }) {
  const requestLeave = useNavigationGuard();
  return <button onClick={() => requestLeave(leave)}>离开AI配置</button>;
}
function mount(permissions: string[] = [...organization.permissions], leave?: () => void) {
  return render(<LanguageProvider><MemoryRouter><UnsavedChangesProvider><AiConnections organization={{ ...organization, permissions }} />{leave ? <NavigationProbe leave={leave} /> : null}</UnsavedChangesProvider></MemoryRouter></LanguageProvider>);
}

it('platform configuration retains process mappings and does not mount model channels', async () => {
  render(<LanguageProvider><MemoryRouter><UnsavedChangesProvider><ConfigurationAdministration organization={{ ...organization, permissions: [...organization.permissions] }} /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>);
  await screen.findByText('系统参数');
  expect(screen.queryByText('AI连接')).not.toBeInTheDocument();
  expect(screen.getByText('工序板块规则')).toBeInTheDocument();
  expect(apiRequest).not.toHaveBeenCalledWith(expect.stringContaining('/ai-connections'), expect.anything());
});

it('protocol changes require a new write-only key and offer all four supported protocols', async () => {
  mount(); const dialog = await edit();
  const protocol = dialog.getByLabelText('渠道协议');
  fireEvent.keyDown(protocol, { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 });
  expect(protocol).toHaveAttribute('aria-expanded', 'true');
  for (const label of ['OpenAI Chat Completions', 'OpenAI Responses', 'Anthropic Messages', 'Gemini Generate Content']) expect(await screen.findByText(label, { selector: '.ant-select-item-option-content' })).toBeInTheDocument();
  fireEvent.click(screen.getByText('Anthropic Messages', { selector: '.ant-select-item-option-content' }));
  fireEvent.click(dialog.getByRole('button', { name: /^保\s*存$/ }));
  expect(await dialog.findByText('更换渠道协议时请填写新密钥')).toBeVisible();
  expect(mutate).not.toHaveBeenCalled();
  fireEvent.change(dialog.getByLabelText('API密钥'), { target: { value: 'fixture-secret-write-only' } });
  fireEvent.click(dialog.getByRole('button', { name: /^保\s*存$/ }));
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
  expect(mutate.mock.calls[0][2]).toMatchObject({ protocol: 'ANTHROPIC_MESSAGES', apiKey: 'fixture-secret-write-only' });
});
async function edit() {
  const row = (await screen.findByText('生产描述', { selector: 'td' })).closest('tr')!;
  fireEvent.click(within(row).getByRole('button', { name: /^编\s*辑$/ }));
  return within(screen.getByRole('dialog', { name: 'AI连接' }));
}
it('AI connection keeps saved keys write-only and binds a replacement to a changed address', async () => {
  mount(); const dialog = await edit();
  expect(dialog.getByLabelText('API密钥')).toHaveValue('');
  expect(dialog.getByLabelText('API密钥')).toHaveAttribute('type', 'password');
  expect(dialog.getByLabelText('API密钥').parentElement?.querySelector('.ant-input-password-icon')).not.toBeInTheDocument();
  expect(dialog.queryByRole('button', { name: /显示|复制|Show|Copy/ })).not.toBeInTheDocument();
  fireEvent.change(dialog.getByLabelText('服务API地址'), { target: { value: 'https://other.example.com/v1' } });
  fireEvent.click(dialog.getByRole('button', { name: /^保\s*存$/ }));
  expect(await dialog.findByText('更换服务地址时请填写新密钥')).toBeVisible();
  expect(mutate).not.toHaveBeenCalled();
  fireEvent.change(dialog.getByLabelText('API密钥'), { target: { value: 'fixture-secret-write-only' } });
  fireEvent.click(dialog.getByRole('button', { name: /^保\s*存$/ }));
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
  expect(mutate.mock.calls[0].slice(0, 3)).toEqual(['/api/v1/admin/ai-connections/ai-1?organizationId=org', 'PATCH', { name: '生产描述', baseUrl: 'https://other.example.com/v1', protocol: 'OPENAI_CHAT_COMPLETIONS', models: ['quality-model', 'quality-fast'], defaultModel: 'quality-model', enabled: true, apiKey: 'fixture-secret-write-only', expectedVersion: 2 }]);
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'AI连接' })).not.toBeInTheDocument());
  expect(document.body.textContent).not.toContain('fixture-secret-write-only');
  expect(JSON.stringify(localStorage)).not.toContain('fixture-secret-write-only');
});
it('AI connection preserves a blank key and clears it only after a separate confirmation', async () => {
  mount(); const dialog = await edit();
  fireEvent.click(dialog.getByRole('button', { name: /^保\s*存$/ }));
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
  expect(mutate.mock.calls[0][2]).not.toHaveProperty('apiKey');
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'AI连接' })).not.toBeInTheDocument());
  const row = screen.getByText('生产描述', { selector: 'td' }).closest('tr')!;
  fireEvent.click(within(row).getByRole('button', { name: '清除密钥' }));
  expect(mutate).toHaveBeenCalledTimes(1);
  fireEvent.click(within(screen.getByRole('dialog', { name: '清除AI密钥' })).getByRole('button', { name: '确认清除' }));
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
  expect(mutate.mock.calls[1].slice(0, 3)).toEqual(['/api/v1/admin/ai-connections/ai-1/clear-key?organizationId=org', 'POST', { expectedVersion: 3 }]);
});
it('AI connection retries a private original request after an unknown outcome', async () => {
  mutate.mockRejectedValueOnce(new TypeError('fixture-secret-write-only')).mockResolvedValueOnce({ ...connection, version: 3 });
  mount(); const dialog = await edit();
  fireEvent.change(dialog.getByLabelText('API密钥'), { target: { value: 'fixture-secret-write-only' } });
  fireEvent.click(dialog.getByRole('button', { name: /^保\s*存$/ }));
  const retry = await dialog.findByRole('button', { name: '重试原请求' });
  expect(retry).toBeEnabled(); expect(document.body.textContent).not.toContain('fixture-secret-write-only');
  expect(dialog.getByLabelText('API密钥')).toBeDisabled();
  fireEvent.click(retry);
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
  expect(mutate.mock.calls[1].slice(0, 3)).toEqual(mutate.mock.calls[0].slice(0, 3));
});
it('AI connection hides management from readers and retires an ABA identity response', async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(apiRequest).mockImplementation(async path => path.includes('/ai-connections') ? new Promise(done => { resolve = done; }) : path.includes('/settings') ? { notificationLocale: 'zh-CN', exportRetentionMinutes: 60, version: 1 } as never : [] as never);
  mount(['configuration:read']);
  expect(screen.queryByRole('button', { name: '新增AI连接' })).not.toBeInTheDocument();
  act(() => { useWorkTabsStore.getState().bindSession('INTERNAL:org:another'); useWorkTabsStore.getState().bindSession('INTERNAL:org:user'); });
  await act(async () => resolve([connection]));
  expect(screen.queryByText('生产描述')).not.toBeInTheDocument();
});
it('AI connection never renders provider error content when a known write fails', async () => {
  mutate.mockRejectedValueOnce(new ApiError({ code: 'AI_CONNECTION_INVALID', message: 'fixture-secret-write-only', fields: {} }, 400));
  mount(); const dialog = await edit();
  fireEvent.click(dialog.getByRole('button', { name: /^保\s*存$/ }));
  const alert = await dialog.findByRole('alert');
  await waitFor(() => expect(alert).toBeVisible());
  expect(dialog.getByRole('button', { name: /^保\s*存$/ })).toBeEnabled();
  expect(document.body.textContent).not.toContain('fixture-secret-write-only');
});
it('AI connection reader sees safe metadata without management actions', async () => {
  mount(['configuration:read']);
  const row = (await screen.findByText('生产描述', { selector: 'td' })).closest('tr')!;
  expect(within(row).getByText('已配置')).toBeVisible();
  expect(within(row).queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('API密钥')).not.toBeInTheDocument();
  expect(mutate).not.toHaveBeenCalled();
});
it('AI connection tests a chosen channel using only its saved version', async () => {
  mutate.mockResolvedValue({ connectionId: connection.id, version: 2, model: 'quality-model', status: 'FAILED', code: 'AI_CONNECTION_REQUEST_FAILED' });
  mount();
  const row = (await screen.findByText('生产描述', { selector: 'td' })).closest('tr')!;
  fireEvent.click(within(row).getByRole('button', { name: '测试连接' }));
  expect(await within(row).findByText('测试失败，请检查配置')).toBeVisible();
  expect(mutate.mock.calls[0].slice(0, 3)).toEqual(['/api/v1/admin/ai-connections/ai-1/test?organizationId=org', 'POST', { expectedVersion: 2 }]);
});
it('AI connection releases global navigation busy after a CSRF refusal while the same organization instance remains mounted', async () => {
  let rejectWrite!: (cause: unknown) => void;
  mutate.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectWrite = reject; }));
  const leave = vi.fn();
  const view = render(<LanguageProvider><MemoryRouter><UnsavedChangesProvider><AiConnections organization={{ ...organization, permissions: [...organization.permissions] }} /><NavigationProbe leave={leave} /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>);
  const retainedPanel = view.container.querySelector('.qms-guard-boundary');
  const leaveButton = screen.getByRole('button', { name: '离开AI配置' });
  const dialog = await edit();
  fireEvent.change(dialog.getByLabelText('API密钥'), { target: { value: 'fixture-secret-write-only' } });
  const save = dialog.getByRole('button', { name: /^保\s*存$/ }); fireEvent.click(save);
  await waitFor(() => expect(save).toHaveClass('ant-btn-loading'));
  fireEvent.click(leaveButton);
  expect(leave).not.toHaveBeenCalled();
  await act(async () => rejectWrite(new ApiError({ code: 'CSRF_INVALID', message: 'csrf changed' }, 403)));
  await screen.findByText('会话或配置权限已变化，请重新进入。');
  await waitFor(() => expect(leave).toHaveBeenCalledTimes(1));
  expect(view.container.querySelector('.qms-guard-boundary')).toBe(retainedPanel);
  expect(useWorkTabsStore.getState().sessionScope).toBe('INTERNAL:org:user');
  expect(screen.queryByLabelText('API密钥')).not.toBeInTheDocument();
  expect(document.body.textContent).not.toContain('fixture-secret-write-only');
});
