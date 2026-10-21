import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiRequest } from '../../api/client';
import { AuditStandardsPage } from './AuditStandardsPage';
import { Link, MemoryRouter } from 'react-router-dom';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, apiRequest: vi.fn(), csrfToken: vi.fn().mockResolvedValue('csrf') };
});

beforeEach(() => vi.mocked(apiRequest).mockReset());

it('lists published standards and opens immutable version details', async () => {
  vi.mocked(apiRequest)
    .mockResolvedValueOnce({ items: [{ id: 'standard-1', name: '过程审核检查表', auditType: 'PROCESS', status: 'PUBLISHED', version: 2, latestVersion: 1, updatedAt: '2026-09-24T00:00:00.000Z' }], total: 1, page: 1, pageSize: 20 })
    .mockResolvedValueOnce({ id: 'standard-1', name: '过程审核检查表', auditType: 'PROCESS', status: 'PUBLISHED', version: 2, latestVersion: 1, draftDefinition: { items: [{ key: 'P1', text: '过程受控' }] }, versions: [{ id: 'version-1', version: 1, definition: { items: [{ key: 'P1', text: '过程受控' }] }, publishedAt: '2026-09-24T00:00:00.000Z', publishedById: 'user-1' }] });
  render(<AuditStandardsPage />);
  const catalog = await screen.findByRole('region', { name: '审核标准目录' });
  expect(within(catalog).getByText('过程审核检查表')).toBeVisible();
  fireEvent.click(within(catalog).getByRole('button', { name: '查看版本' }));
  expect(await screen.findByText('过程受控')).toBeVisible();
  expect(apiRequest).toHaveBeenCalledWith('/api/v1/audit-standards/templates/standard-1');
});

it('distinguishes empty catalog from request failure', async () => {
  vi.mocked(apiRequest).mockRejectedValueOnce(new Error('offline'));
  render(<AuditStandardsPage />);
  expect(await screen.findByText('审核标准加载失败，请重试')).toBeVisible();
  expect(screen.queryByText('暂无审核标准')).not.toBeInTheDocument();
});

it('blocks leaving while a standard save is still awaiting its result', async () => {
  let complete!: (value: unknown) => void;
  const saving = new Promise((resolve) => { complete = resolve; });
  const detail = { id: 'new-standard', name: '新标准', auditType: 'PROCESS', status: 'DRAFT', version: 1, latestVersion: 0, draftDefinition: { items: [{ key: 'P1', text: '过程受控' }] }, versions: [] };
  vi.mocked(apiRequest).mockImplementation((url, init) => init?.method === 'POST' ? saving : Promise.resolve(String(url).endsWith('/new-standard') ? detail : { items: [], total: 0, page: 1, pageSize: 20 }));
  render(<MemoryRouter><UnsavedChangesProvider><AuditStandardsPage /><Link to="/app/workbench">返回工作台</Link></UnsavedChangesProvider></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: '新建标准' }));
  const title = await screen.findByText('新建审核标准', { selector: '.ant-drawer-title' });
  const drawer = title.closest('[role="dialog"]');
  expect(drawer).not.toBeNull();
  const editor = within(drawer as HTMLElement);
  fireEvent.change(await editor.findByRole('textbox', { name: '标准名称' }), { target: { value: '新标准' } });
  fireEvent.change(editor.getByPlaceholderText('检查项编号'), { target: { value: 'P1' } });
  fireEvent.change(editor.getByPlaceholderText('检查内容'), { target: { value: '过程受控' } });
  fireEvent.click(editor.getByRole('button', { name: /保\s*存/ }));
  await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
  expect(editor.getByRole('textbox', { name: '标准名称' })).toBeDisabled();
  await act(async () => { fireEvent.click(screen.getByRole('link', { name: '返回工作台' })); });
  const offeredDiscardWhileSaving = screen.queryByText('当前草稿尚未保存，继续将放弃修改。') !== null;
  await act(async () => { complete({ id: detail.id }); await saving; });
  expect(offeredDiscardWhileSaving).toBe(false);
});
