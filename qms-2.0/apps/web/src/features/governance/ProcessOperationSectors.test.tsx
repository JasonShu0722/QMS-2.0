import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ApiError, apiRequest, createAdminMutation } from '../../api/client';
import { UnsavedChangesProvider, useNavigationGuard } from '../../layouts/UnsavedChanges';
import { LanguageProvider } from '../../i18n/Language';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { ProcessOperationSectors } from './ProcessOperationSectors';

const mutate = vi.fn();
vi.mock('../../api/client', async () => ({ ...(await vi.importActual<typeof import('../../api/client')>('../../api/client')), apiRequest: vi.fn(), createAdminMutation: vi.fn() }));
const organization = { id: 'org', code: 'ORG', name: '当前组织', type: 'INTERNAL', permissions: ['process-quality:configuration:read', 'process-quality:configuration:manage'] } as const;
const sector = { id: 'sector-1', organizationId: 'org', operationName: '终检', sectorName: '装配', active: true, version: 2 };
beforeEach(() => {
  localStorage.clear(); vi.stubEnv('NODE_ENV', 'development');
  useWorkTabsStore.getState().bindSession('INTERNAL:org:user');
  vi.mocked(createAdminMutation).mockReturnValue(mutate);
  vi.mocked(apiRequest).mockReset().mockResolvedValue([sector]);
  mutate.mockReset().mockResolvedValue({ ...sector, version: 3 });
});
afterEach(() => vi.unstubAllEnvs());
function mount(permissions: string[] = [...organization.permissions]) {
  return render(<LanguageProvider><MemoryRouter><UnsavedChangesProvider><ProcessOperationSectors organization={{ ...organization, permissions }} /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>);
}
it('requires code and name on manual creation and preserves leading zeroes', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: '新增工序' }));
  const dialog = within(screen.getByRole('dialog', { name: '新增工序' }));
  const code = dialog.getByLabelText('工序编码');
  const name = dialog.getByLabelText('工序名称');
  fireEvent.click(dialog.getByRole('button', { name: /^保\s*存$/ }));
  await waitFor(() => { expect(code).toHaveAttribute('aria-invalid', 'true'); expect(name).toHaveAttribute('aria-invalid', 'true'); });
  expect(mutate).not.toHaveBeenCalled();
  fireEvent.change(code, { target: { value: ' 001 ' } });
  fireEvent.change(name, { target: { value: ' 首检 ' } });
  fireEvent.click(dialog.getByRole('button', { name: /^保\s*存$/ }));
  await waitFor(() => expect(mutate.mock.calls[0]?.[2]).toEqual({ organizationId: 'org', operationCode: '001', operationName: '首检', sectorName: null }));
});
it('validates pasted rows and retries the same batch after an unknown result', async () => {
  mutate.mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce([{ ...sector, id: 'new-1', operationCode: '001', operationName: '首检' }, { ...sector, id: 'new-2', operationCode: '002', operationName: '复检' }]);
  mount();
  fireEvent.click(screen.getByRole('button', { name: '批量新增' }));
  const dialog = within(screen.getByRole('dialog', { name: '批量新增工序' }));
  const input = dialog.getByRole('textbox', { name: '工序数据' });
  const submit = dialog.getByRole('button', { name: /^保\s*存$/ });
  fireEvent.change(input, { target: { value: '001\t首检\r\n001\t复检\r\n\t终检' } });
  fireEvent.click(submit);
  expect(await dialog.findByText(/第 2 行/)).toBeInTheDocument();
  expect(dialog.getByText(/第 3 行/)).toBeInTheDocument();
  expect(mutate).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: '工序编码\t工序名称\r\n001\t首检\r\n002\t复检\r\n' } });
  fireEvent.click(submit);
  fireEvent.click(await dialog.findByRole('button', { name: '重试原请求' }));
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
  expect(mutate.mock.calls[0].slice(0, 3)).toEqual(['/api/v1/process-quality/operation-sectors/bulk-create', 'POST', { organizationId: 'org', items: [{ operationCode: '001', operationName: '首检' }, { operationCode: '002', operationName: '复检' }] }]);
  expect(mutate.mock.calls[1].slice(0, 3)).toEqual(mutate.mock.calls[0].slice(0, 3));
  expect(await screen.findByText('复检', { selector: 'td' })).toBeInTheDocument();
});
it('maps a database code conflict back to the original pasted line', async () => {
  mutate.mockRejectedValueOnce(new ApiError({ code: 'PROCESS_OPERATION_CODE_CONFLICT', message: '', fields: { 'items[1].operationCode': ['duplicate'] } }, 400));
  mount();
  fireEvent.click(screen.getByRole('button', { name: '批量新增' }));
  const dialog = within(screen.getByRole('dialog', { name: '批量新增工序' }));
  const input = dialog.getByRole('textbox', { name: '工序数据' });
  const value = '工序编码\t工序名称\n001\t"首检\n含""特殊""说明"\n\n002\t复检';
  fireEvent.change(input, { target: { value } });
  fireEvent.click(dialog.getByRole('button', { name: /^保\s*存$/ }));
  expect(await dialog.findByText(/第 5 行 · 工序编码重复/)).toBeInTheDocument();
  expect(mutate.mock.calls[0]?.[2].items[0]).toEqual({ operationCode: '001', operationName: '首检\n含"特殊"说明' });
  expect(input).toHaveValue(value);
  expect(input).not.toBeDisabled();
});
it('releases navigation after a rejected batch retires the current panel', async () => {
  let rejectWrite!: (cause: unknown) => void;
  mutate.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectWrite = reject; }));
  const leave = vi.fn();
  function NavigationProbe() {
    const navigate = useNavigationGuard();
    return <button onClick={() => navigate(leave)}>离开工序配置</button>;
  }
  render(<LanguageProvider><MemoryRouter><UnsavedChangesProvider><ProcessOperationSectors organization={{ ...organization, permissions: [...organization.permissions] }} /><NavigationProbe /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>);
  fireEvent.click(screen.getByRole('button', { name: '批量新增' }));
  const dialog = within(screen.getByRole('dialog', { name: '批量新增工序' }));
  fireEvent.change(dialog.getByRole('textbox', { name: '工序数据' }), { target: { value: '001\t首检' } });
  const submit = dialog.getByRole('button', { name: /^保\s*存$/ });
  fireEvent.click(submit);
  await waitFor(() => expect(submit).toHaveClass('ant-btn-loading'));
  await act(async () => rejectWrite(new ApiError({ code: 'CSRF_INVALID', message: 'csrf changed' }, 403)));
  await screen.findByText('会话或配置权限已变化，请重新进入。');
  fireEvent.click(screen.getByRole('button', { name: '离开工序配置' }));
  expect(leave).toHaveBeenCalledTimes(1);
});
it('maintains an exact operation name with version protection in the selected organization', async () => {
  mount();
  const row = (await screen.findByText('终检', { selector: 'td' })).closest('tr')!;
  fireEvent.click(within(row).getByRole('button', { name: /^编\s*辑$/ }));
  const dialog = within(screen.getByRole('dialog', { name: '工序主数据' }));
  fireEvent.change(dialog.getByLabelText('工序名称'), { target: { value: '  终检  ' } });
  fireEvent.change(dialog.getByLabelText('板块名称'), { target: { value: '电测' } });
  fireEvent.click(dialog.getByRole('button', { name: /^保\s*存$/ }));
  await waitFor(() => expect(mutate).toHaveBeenCalled());
  expect(mutate.mock.calls[0].slice(0, 3)).toEqual(['/api/v1/process-quality/operation-sectors/sector-1?organizationId=org', 'PUT', { organizationId: 'org', expectedVersion: 2, operationCode: null, operationName: '终检', sectorName: '电测', active: true }]);
});
it('shows the imported code and allows clearing its board', async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce([{ ...sector, operationCode: 'OP-001' }]);
  mount();
  const row = (await screen.findByText('OP-001')).closest('tr')!;
  fireEvent.click(within(row).getByRole('button', { name: /^编\s*辑$/ }));
  const dialog = within(screen.getByRole('dialog', { name: '工序主数据' }));
  expect(dialog.getByLabelText('工序编码')).toHaveAttribute('readonly');
  fireEvent.change(dialog.getByLabelText('板块名称'), { target: { value: '' } });
  fireEvent.click(dialog.getByRole('button', { name: /^保\s*存$/ }));
  await waitFor(() => expect(mutate.mock.calls[0]?.[2]).toMatchObject({ operationCode: 'OP-001', sectorName: null }));
});
it('keeps a conflicting edit and offers the exact request after an unknown result', async () => {
  mutate.mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce({ ...sector, version: 3 });
  mount();
  fireEvent.click(within((await screen.findByText('终检', { selector: 'td' })).closest('tr')!).getByRole('button', { name: /^编\s*辑$/ }));
  const dialog = within(screen.getByRole('dialog', { name: '工序主数据' }));
  fireEvent.change(dialog.getByLabelText('板块名称'), { target: { value: '保留输入' } });
  fireEvent.click(dialog.getByRole('button', { name: /^保\s*存$/ }));
  fireEvent.click(await dialog.findByRole('button', { name: '重试原请求' }));
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
  expect(mutate.mock.calls[1].slice(0, 3)).toEqual(mutate.mock.calls[0].slice(0, 3));
});
it('hides mutations for a reader and retires late rows after identity changes', async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(apiRequest).mockReturnValue(new Promise(done => { resolve = done; }));
  mount(['process-quality:configuration:read']);
  expect(screen.queryByRole('button', { name: '新增工序' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '批量新增' })).not.toBeInTheDocument();
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:org:another'));
  await act(async () => resolve([sector]));
  expect(screen.queryByText('终检')).not.toBeInTheDocument();
});
