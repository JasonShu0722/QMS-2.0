import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { apiRequest, getSession } from '../../api/client';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { LanguageProvider } from '../../i18n/Language';
import { NewProductQualityPage } from './NewProductQualityPage';
import { NewProductIssueClosurePanel } from './NewProductIssueClosurePanel';

vi.mock('../../api/client', async () => ({ ...(await vi.importActual<typeof import('../../api/client')>('../../api/client')), apiRequest: vi.fn(), getSession: vi.fn() }));
vi.mock('../attachments/AttachmentPanel', () => ({ AttachmentPanel: () => null }));

const batch = { id: 'b1', code: 'T1' };
const project = { id: 'p1', code: 'NP-1', name: '项目一', status: 'ACTIVE', version: 1, stages: [], lessons: [], batches: [batch, { id: 'b2', code: 'T2' }] };

beforeEach(() => {
  vi.mocked(getSession).mockReset().mockResolvedValue({ userId: 'reviewer', organizationId: 'org', accountType: 'INTERNAL', landingPath: '/app/workbench' });
  vi.mocked(apiRequest).mockReset().mockImplementation(async (url) => {
    if (url.includes('/projects/')) return project;
    if (url.endsWith('/report')) return { ...batch, metrics: [] };
    return null;
  });
});

it.each(['refresh', 'lookup', 'enter', 'batch'] as const)('protects an unfinished trial conclusion on %s', async (action) => {
  render(<LanguageProvider><MemoryRouter><UnsavedChangesProvider><NewProductQualityPage projectId="p1" /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>);
  fireEvent.click(await screen.findByRole('button', { name: '查看试产报告 T1' }));
  fireEvent.change(await screen.findByLabelText('试产结论'), { target: { value: '未保存的试产结论' } });
  if (action === 'refresh') fireEvent.click(screen.getByRole('button', { name: /^刷\s*新$/ }));
  if (action === 'batch') fireEvent.click(screen.getByRole('button', { name: '查看试产报告 T2' }));
  if (action === 'lookup' || action === 'enter') {
    fireEvent.change(screen.getByLabelText('新产品项目 ID'), { target: { value: 'p2' } });
    if (action === 'lookup') fireEvent.click(screen.getByRole('button', { name: '查看项目' }));
    else fireEvent.keyDown(screen.getByLabelText('新产品项目 ID'), { key: 'Enter', keyCode: 13 });
  }
  await waitFor(() => expect(screen.getByText('当前草稿尚未保存，继续将放弃修改。')).toBeVisible());
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('试产结论')).toHaveValue('未保存的试产结论');
});

it('retains an initial-flow plan when cancellation is declined', async () => {
  render(<LanguageProvider><MemoryRouter><UnsavedChangesProvider><NewProductQualityPage projectId="p1" /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>);
  fireEvent.click(await screen.findByRole('button', { name: '创建方案' }));
  fireEvent.change(screen.getByLabelText('监控方案'), { target: { value: '未保存方案' } });
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /取\s*消/ }));
  await waitFor(() => expect(screen.getByText('当前草稿尚未保存，继续将放弃修改。')).toBeVisible());
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('监控方案')).toHaveValue('未保存方案');
});

it('retains a handover risk statement when cancellation is declined', async () => {
  render(<LanguageProvider><MemoryRouter><UnsavedChangesProvider><NewProductQualityPage projectId="p1" /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>);
  fireEvent.click(await screen.findByRole('button', { name: '量产移交' }));
  fireEvent.change(screen.getByLabelText('遗留风险说明'), { target: { value: '未签署风险' } });
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /取\s*消/ }));
  await waitFor(() => expect(screen.getByText('当前草稿尚未保存，继续将放弃修改。')).toBeVisible());
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('遗留风险说明')).toHaveValue('未签署风险');
});

it('retains a trial issue measure when local cancellation is declined', async () => {
  const value = { items: [{ id: 'i1', status: 'IN_PROGRESS', severity: 'MEDIUM', version: 1, owner_user_id: 'handler' }], stats: { total: 1, open: 0, escalated: 0, in_progress: 1, verified: 0, closed: 0 } };
  render(<LanguageProvider><MemoryRouter><UnsavedChangesProvider><NewProductIssueClosurePanel projectId="p1" value={value} active currentUserId="handler" onRefresh={vi.fn()} /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>);
  fireEvent.click(screen.getByRole('button', { name: '记录措施' }));
  fireEvent.change(screen.getByLabelText('整改措施'), { target: { value: '未保存措施' } });
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /取\s*消/ }));
  await waitFor(() => expect(screen.getByText('当前草稿尚未保存，继续将放弃修改。')).toBeVisible());
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('整改措施')).toHaveValue('未保存措施');
});

beforeEach(() => { localStorage.clear(); vi.stubEnv('NODE_ENV', 'development'); });
afterEach(() => vi.unstubAllEnvs());
