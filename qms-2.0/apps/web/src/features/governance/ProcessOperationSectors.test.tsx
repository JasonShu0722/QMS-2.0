import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { apiRequest, createAdminMutation } from '../../api/client';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { LanguageProvider } from '../../i18n/Language';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { ProcessOperationSectors } from './ProcessOperationSectors';

const mutate = vi.fn();
vi.mock('../../api/client', async () => ({ ...(await vi.importActual<typeof import('../../api/client')>('../../api/client')), apiRequest: vi.fn(), createAdminMutation: vi.fn() }));
const organization = { id: 'org', code: 'ORG', name: '当前组织', type: 'INTERNAL', permissions: ['configuration:read', 'configuration:manage'] } as const;
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
it('maintains an exact operation name with version protection in the selected organization', async () => {
  mount();
  const row = (await screen.findByText('终检', { selector: 'td' })).closest('tr')!;
  fireEvent.click(within(row).getByRole('button', { name: /^编\s*辑$/ }));
  const dialog = within(screen.getByRole('dialog', { name: '工序板块规则' }));
  fireEvent.change(dialog.getByLabelText('工序名称'), { target: { value: '  终检  ' } });
  fireEvent.change(dialog.getByLabelText('板块名称'), { target: { value: '电测' } });
  fireEvent.click(dialog.getByRole('button', { name: /^保\s*存$/ }));
  await waitFor(() => expect(mutate).toHaveBeenCalled());
  expect(mutate.mock.calls[0].slice(0, 3)).toEqual(['/api/v1/process-quality/operation-sectors/sector-1?organizationId=org', 'PUT', { organizationId: 'org', expectedVersion: 2, operationName: '终检', sectorName: '电测', active: true }]);
});
it('keeps a conflicting edit and offers the exact request after an unknown result', async () => {
  mutate.mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce({ ...sector, version: 3 });
  mount();
  fireEvent.click(within((await screen.findByText('终检', { selector: 'td' })).closest('tr')!).getByRole('button', { name: /^编\s*辑$/ }));
  const dialog = within(screen.getByRole('dialog', { name: '工序板块规则' }));
  fireEvent.change(dialog.getByLabelText('板块名称'), { target: { value: '保留输入' } });
  fireEvent.click(dialog.getByRole('button', { name: /^保\s*存$/ }));
  fireEvent.click(await dialog.findByRole('button', { name: '重试原请求' }));
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
  expect(mutate.mock.calls[1].slice(0, 3)).toEqual(mutate.mock.calls[0].slice(0, 3));
});
it('hides mutations for a reader and retires late rows after identity changes', async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(apiRequest).mockReturnValue(new Promise(done => { resolve = done; }));
  mount(['configuration:read']);
  expect(screen.queryByRole('button', { name: '新建板块规则' })).not.toBeInTheDocument();
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:org:another'));
  await act(async () => resolve([sector]));
  expect(screen.queryByText('终检')).not.toBeInTheDocument();
});
