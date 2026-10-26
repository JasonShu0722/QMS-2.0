import { LanguageProvider } from '../../i18n/Language';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { apiRequest } from '../../api/client';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { ProcessShipmentReportPanel } from './ProcessShipmentReportPanel';
import { ProcessDefectLedgerPage } from './ProcessDefectLedgerPage';

vi.mock('../../api/client', async () => ({ ...(await vi.importActual<typeof import('../../api/client')>('../../api/client')), apiRequest: vi.fn() }));
vi.mock('../attachments/AttachmentPanel', () => ({ AttachmentPanel: () => null }));

const report = { id: 'report-1', reportNumber: 'SHIP-001', status: 'DRAFT', version: 1, periodStart: '2026-10-01', periodEnd: '2026-10-02', batchCount: 1, goodQuantity: 90, defectQuantity: 10, yieldRate: 0.9, evidence: [], customers: [], issues: [] };
const other = { ...report, id: 'report-2', reportNumber: 'SHIP-002' };

beforeEach(() => {
  vi.mocked(apiRequest).mockReset().mockImplementation(async (url) => {
    if (url.includes('/my-permissions')) return { permissions: ['process-quality:defects:write'] };
    if (url.includes('?page=')) return { items: [report, other], total: 2 };
    if (url.endsWith('/report-2')) return other;
    return report;
  });
});

it.each(['close', 'refresh', 'switch'] as const)('protects an unbound shipment problem on local %s', async (action) => {
  render(<LanguageProvider><MemoryRouter><UnsavedChangesProvider><ProcessShipmentReportPanel /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>);
  fireEvent.click(await screen.findByLabelText('查看出货报告 SHIP-001'));
  fireEvent.change(await screen.findByLabelText('正式问题 ID'), { target: { value: 'unsaved-problem' } });
  if (action === 'close') fireEvent.click(within(screen.getByLabelText('正式问题 ID').closest('[role="dialog"]') as HTMLElement).getByLabelText('关闭'));
  if (action === 'refresh') fireEvent.click(screen.getByText('刷新报告', { selector: 'button span' }));
  if (action === 'switch') fireEvent.click(screen.getByLabelText('查看出货报告 SHIP-002'));
  await waitFor(() => expect(screen.getByText('当前草稿尚未保存，继续将放弃修改。')).toBeVisible());
  const title = screen.getByText('当前草稿尚未保存，继续将放弃修改。', { selector: '.ant-modal-title' });
  fireEvent.click(within(title.closest('[role="dialog"]') as HTMLElement).getByText('继续编辑'));
  expect(screen.getByLabelText('正式问题 ID')).toHaveValue('unsaved-problem');
  expect(screen.getByRole('dialog', { name: 'SHIP-001' })).toBeVisible();
});

it('retains a new shipment report when closing is declined', async () => {
  render(<LanguageProvider><MemoryRouter><UnsavedChangesProvider><ProcessShipmentReportPanel /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>);
  await screen.findByLabelText('查看出货报告 SHIP-001');
  fireEvent.click(screen.getByText('新建出货报告', { selector: 'button span' }));
  const input = await screen.findByLabelText('报告编号');
  fireEvent.change(input, { target: { value: 'SHIP-DRAFT' } });
  fireEvent.click(within(input.closest('[role="dialog"]') as HTMLElement).getByLabelText('关闭'));
  const title = await screen.findByText('当前草稿尚未保存，继续将放弃修改。', { selector: '.ant-modal-title' });
  await waitFor(() => expect(title).toBeVisible());
  fireEvent.click(within(title.closest('[role="dialog"]') as HTMLElement).getByText('继续编辑'));
  expect(screen.getByLabelText('报告编号')).toHaveValue('SHIP-DRAFT');
});

it('retains a process issue form when closing is declined', async () => {
  const defect = { id: 'defect-1', description: '表面划伤', defectTypeCode: 'SCRATCH', defectQuantity: 1, responsibilityCategory: 'PROCESS', occurredAt: '2026-10-01', version: 1 };
  vi.mocked(apiRequest).mockImplementation(async (url) => url.includes('/defects?') ? { items: [defect], total: 1 } : url.includes('/my-permissions') ? { permissions: [] } : { items: [], total: 0 });
  render(<LanguageProvider><MemoryRouter><UnsavedChangesProvider><ProcessDefectLedgerPage /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>);
  fireEvent.click(await screen.findByLabelText('选择制程不良 表面划伤'));
  fireEvent.click(screen.getByText('发起问题'));
  fireEvent.change(screen.getByLabelText('实例标识'), { target: { value: 'issue-draft' } });
  fireEvent.click(within(screen.getByLabelText('实例标识').closest('[role="dialog"]') as HTMLElement).getByLabelText('关闭'));
  const title = await screen.findByText('当前草稿尚未保存，继续将放弃修改。', { selector: '.ant-modal-title' });
  await waitFor(() => expect(title).toBeVisible());
  fireEvent.click(within(title.closest('[role="dialog"]') as HTMLElement).getByText('继续编辑'));
  expect(screen.getByLabelText('实例标识')).toHaveValue('issue-draft');
});

beforeEach(() => { localStorage.clear(); vi.stubEnv('NODE_ENV', 'development'); });
afterEach(() => vi.unstubAllEnvs());
