import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiRequest } from '../../api/client';
import { SupplierPpapPage } from './SupplierPpapPage';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, apiRequest: vi.fn(), csrfToken: vi.fn().mockResolvedValue('csrf') };
});
vi.mock('../attachments/AttachmentPanel', () => ({ AttachmentPanel: () => null }));

const pack = { id: 'p1', title: '控制计划', partNumber: 'M-1', level: 3, status: 'DRAFT', version: 1, items: [{ id: 'i1', packageId: 'p1', itemCode: 'CP', title: '控制计划', required: true, status: 'PENDING', evidenceFileIds: [], version: 1 }] };
const page = { items: [pack], total: 1, page: 1, pageSize: 20 };
const permissions = { permissions: ['supplier-ppap:read', 'supplier-ppap:write', 'supplier-ppap:review', 'supplier-quality:profiles:read'] };

beforeEach(() => {
  vi.mocked(apiRequest).mockReset().mockImplementation(async (path) => String(path).includes('my-permissions') ? permissions as never : String(path).includes('profiles') ? { items: [] } as never : String(path).endsWith('/p1') ? pack as never : page as never);
});

it('adds a custom checklist item through the contracted item endpoint', async () => {
  render(<SupplierPpapPage />);
  await userEvent.click(await screen.findByRole('button', { name: '查看与审核' }));
  await userEvent.click(await screen.findByRole('button', { name: '新增检查项' }));
  await userEvent.type(screen.getByLabelText('检查项编码'), 'CUSTOM');
  await userEvent.type(screen.getByLabelText('检查项名称'), '补充验证');
  await userEvent.click(screen.getByRole('button', { name: '保存检查项' }));
  expect(vi.mocked(apiRequest)).toHaveBeenCalledWith('/api/v1/supplier-ppap/p1/items', expect.objectContaining({ method: 'POST', body: expect.stringContaining('"itemCode":"CUSTOM"') }));
});

it('hides write and review actions without their permissions', async () => {
  vi.mocked(apiRequest).mockImplementation(async (path) => String(path).includes('my-permissions') ? { permissions: ['supplier-ppap:read'] } as never : String(path).endsWith('/p1') ? { ...pack, status: 'SUBMITTED' } as never : page as never);
  render(<SupplierPpapPage />);
  expect(await screen.findByRole('button', { name: '查看与审核' })).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: '查看与审核' }));
  expect(await screen.findByRole('dialog', { name: 'PPAP 资料包详情' })).toBeVisible();
  expect(screen.queryByRole('button', { name: '新建 PPAP' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '提交审核结论' })).not.toBeInTheDocument();
});

it('shows missing required evidence before offering submission', async () => {
  render(<SupplierPpapPage />);
  await userEvent.click(await screen.findByRole('button', { name: '查看与审核' }));
  const drawer = await screen.findByRole('dialog', { name: 'PPAP 资料包详情' });
  expect(within(drawer).getByText('1 个必需检查项缺少扫描证据')).toBeVisible();
  expect(within(drawer).getByRole('button', { name: '提交审核' })).toBeDisabled();
});

it('sends a mandatory review note and version with the package decision', async () => {
  vi.mocked(apiRequest).mockImplementation(async (path, options) => options?.method === 'POST' ? { ...pack, status: 'APPROVED', version: 3 } as never : String(path).includes('my-permissions') ? permissions as never : String(path).includes('profiles') ? { items: [] } as never : String(path).endsWith('/p1') ? { ...pack, status: 'SUBMITTED', version: 2 } as never : page as never);
  const user = userEvent.setup();
  render(<SupplierPpapPage />);
  await user.click(await screen.findByRole('button', { name: '查看与审核' }));
  await user.type(await screen.findByLabelText('审核意见'), '文件有效');
  await user.click(screen.getByRole('button', { name: '提交审核结论' }));
  await user.click(screen.getByRole('button', { name: 'OK' }));
  expect(vi.mocked(apiRequest)).toHaveBeenCalledWith('/api/v1/supplier-ppap/p1/review', expect.objectContaining({ method: 'POST', body: JSON.stringify({ expectedVersion: 2, decision: 'APPROVED', note: '文件有效' }) }));
}, 30_000);
