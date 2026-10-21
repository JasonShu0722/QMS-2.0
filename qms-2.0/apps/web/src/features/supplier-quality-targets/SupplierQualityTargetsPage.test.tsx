import { expect, it, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { SupplierQualityTargetsPage } from './SupplierQualityTargetsPage';
import * as client from '../../api/client';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';

vi.mock('../../api/client', async (importOriginal) => ({ ...(await importOriginal<typeof client>()), apiRequest: vi.fn(), csrfToken: vi.fn().mockResolvedValue('csrf') }));
const request = vi.mocked(client.apiRequest);
const target = { id: 'target-1', profileId: 'profile-1', periodType: 'ANNUAL', targetYear: 2026, targetMonth: null, revision: 1, title: '年度 PPM', metrics: { ppm: 100 }, status: 'SUBMITTED', version: 2 };
function server(permissions: string[], row = target) {
  request.mockImplementation(async (path) => path === '/api/v1/system/my-permissions' ? { permissions, organizationId: 'org-1' } as never : path.includes('/actuals') ? { items: [], total: 0, latestVersion: 0 } as never : { items: [row], total: 1 } as never);
}
afterEach(() => vi.clearAllMocks());

it('keeps the target drawer open while approval is pending', async () => {
  let finish!: () => void;
  const pending = new Promise<never>((resolve) => { finish = () => resolve(target as never); });
  request.mockImplementation(async (path) => {
    if (path.endsWith('/approve')) return pending;
    if (path === '/api/v1/system/my-permissions') return { permissions: ['supplier-quality:targets:read', 'supplier-quality:targets:approve'] } as never;
    return path.includes('/actuals') ? { items: [], total: 0 } as never : { items: [target], total: 1 } as never;
  });
  render(<MemoryRouter><UnsavedChangesProvider><SupplierQualityTargetsPage /></UnsavedChangesProvider></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: '实际与流程' }));
  fireEvent.click(await screen.findByRole('button', { name: '批准目标' }));
  await waitFor(() => expect(request).toHaveBeenCalledWith('/api/v1/supplier-quality-targets/target-1/approve', expect.objectContaining({ method: 'POST' })));
  try {
    const drawer = screen.getByRole('dialog', { name: '目标实际与流程' });
    const close = within(drawer).queryByRole('button', { name: 'Close' });
    if (close) fireEvent.click(close);
    expect(screen.getByRole('dialog', { name: '目标实际与流程' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '放弃修改并关闭' })).not.toBeInTheDocument();
  } finally { await act(async () => { finish(); await pending; }); }
});

it('offers approval only with approval permission and sends the current version', async () => {
  server(['supplier-quality:targets:read', 'supplier-quality:targets:approve']);
  render(<SupplierQualityTargetsPage />);
  await userEvent.click(await screen.findByRole('button', { name: '实际与流程' }));
  await userEvent.click(await screen.findByRole('button', { name: '批准目标' }));
  expect(request).toHaveBeenCalledWith('/api/v1/supplier-quality-targets/target-1/approve', expect.objectContaining({ method: 'POST', body: JSON.stringify({ expectedVersion: 2 }) }));
  expect(screen.queryByRole('button', { name: '新建质量目标' })).not.toBeInTheDocument();
});

it('shows a target creation form for writers', async () => {
  server(['supplier-quality:targets:read', 'supplier-quality:targets:write']);
  render(<SupplierQualityTargetsPage />);
  await userEvent.click(await screen.findByRole('button', { name: '新建质量目标' }));
  expect(screen.getByLabelText('目标指标 JSON')).toBeInTheDocument();
});

it('publishes only an approved version with the selected effective dates', async () => {
  server(['supplier-quality:targets:read', 'supplier-quality:targets:publish'], { ...target, status: 'APPROVED', version: 3 });
  render(<SupplierQualityTargetsPage />);
  await userEvent.click(await screen.findByRole('button', { name: '实际与流程' }));
  fireEvent.change(screen.getByLabelText('生效开始'), { target: { value: '2026-10-01' } });
  await userEvent.click(screen.getByRole('button', { name: '发布目标' }));
  await waitFor(() => expect(request).toHaveBeenCalledWith('/api/v1/supplier-quality-targets/target-1/publish', expect.objectContaining({ method: 'POST', body: JSON.stringify({ expectedVersion: 3, effectiveFrom: '2026-10-01' }) })));
});
