import { fireEvent, render as renderView, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiRequest, csrfToken } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { SupplierPerformancePortalPage } from './SupplierPerformancePortalPage';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, apiRequest: vi.fn(), csrfToken: vi.fn() };
});

const render = (ui: ReactElement) => renderView(ui, { wrapper: LanguageProvider });
beforeEach(() => {
  // rc-component uses duplicate IDs in test mode, unlike the application.
  vi.stubEnv('NODE_ENV', 'development');
  localStorage.setItem('qms:locale:v1', 'zh-CN');
  vi.mocked(apiRequest).mockReset(); vi.mocked(csrfToken).mockReset(); vi.mocked(csrfToken).mockResolvedValue('csrf-test');
});
afterEach(() => vi.unstubAllEnvs());

it('keeps the supplier appeal reason when closing is cancelled and discards only after confirmation', async () => {
  const user = userEvent.setup();
  vi.mocked(apiRequest).mockImplementation(async (path) => String(path).includes('/cards?')
    ? { items: [{ id: 'card-1', month: '2026-09', status: 'PUBLISHED', sourceInspections: [] }], total: 1 } as never
    : { items: [], total: 0 } as never);
  render(<MemoryRouter><UnsavedChangesProvider><SupplierPerformancePortalPage /></UnsavedChangesProvider></MemoryRouter>);
  await user.click(await screen.findByRole('button', { name: '提出申诉' }));
  const modal = await screen.findByRole('dialog', { name: '申诉 2026-09 绩效卡' });
  await waitFor(() => expect(modal).toBeVisible());
  await user.click(within(modal).getByRole('textbox', { name: '申诉说明' }));
  await user.paste('待核查的检验批次');
  expect(within(modal).getByRole('textbox', { name: '申诉说明' })).toHaveValue('待核查的检验批次');
  await user.click(within(modal).getByRole('button', { name: '关闭' }));
  const confirmation = await screen.findByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' });
  await waitFor(() => expect(confirmation).toBeVisible());
  await user.click(within(confirmation).getByRole('button', { name: '继续编辑' }));
  await waitFor(() => expect(confirmation).not.toBeVisible());
  expect(within(modal).getByRole('textbox', { name: '申诉说明' })).toHaveValue('待核查的检验批次');
  await user.click(within(modal).getByRole('button', { name: '关闭' }));
  await user.click(await screen.findByRole('button', { name: '放弃修改并关闭' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '申诉 2026-09 绩效卡' })).not.toBeInTheDocument());
  await user.click(screen.getByRole('button', { name: '提出申诉' }));
  const reopened = await screen.findByRole('dialog', { name: '申诉 2026-09 绩效卡' });
  await waitFor(() => expect(reopened).toBeVisible());
  expect(within(reopened).getByRole('textbox', { name: '申诉说明' })).toHaveValue('');
  expect(apiRequest).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'POST' }));
});

it('shows published cards and submits a supplier appeal with CSRF', async () => {
  vi.mocked(apiRequest).mockImplementation(async (path) => {
    if (String(path).startsWith('/api/v1/supplier-portal/performance/cards?')) return { items: [{ id: 'card-1', supplierName: '本企业', month: '2026-09', status: 'PUBLISHED', totalScore: 82, incomingScore: 80, cooperationScore: 85, inspectionCount: 5, passCount: 4, incomingWeight: 60, cooperationWeight: 40, cooperationNote: '待核实', sourceInspections: [] }], total: 1 } as never;
    if (path === '/api/v1/supplier-portal/performance/appeals') return { items: [], total: 0 } as never;
    throw new Error(String(path));
  });
  render(<SupplierPerformancePortalPage />);
  expect(await screen.findByText('2026-09')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '提出申诉' }));
  fireEvent.change(screen.getByRole('textbox', { name: '申诉说明' }), { target: { value: '本月来料批次结论需复核' } });
  fireEvent.click(screen.getByRole('button', { name: '保存申诉草稿' }));
  await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith('/api/v1/supplier-portal/performance/appeals', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'x-csrf-token': 'csrf-test', 'Idempotency-Key': expect.any(String) }), body: JSON.stringify({ cardId: 'card-1', reason: '本月来料批次结论需复核' }) })));
});
