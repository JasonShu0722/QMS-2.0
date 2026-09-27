import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiRequest } from '../../api/client';
import { SupplierAsnPage } from './SupplierAsnPage';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, apiRequest: vi.fn(), csrfToken: vi.fn().mockResolvedValue('csrf') };
});
vi.mock('../attachments/AttachmentPanel', () => ({ AttachmentPanel: () => null }));

const asn = { id: 'a1', asnNumber: 'ASN-1', materialCode: 'M-1', plannedArrivalDate: '2026-10-01', quantity: 5, status: 'DRAFT', version: 1, evidence: [] };
const page = { items: [asn], total: 1, page: 1, pageSize: 20 };
beforeEach(() => vi.mocked(apiRequest).mockReset().mockImplementation(async (path) => String(path).includes('my-permissions') ? { permissions: ['supplier-asn:read', 'supplier-asn:write', 'supplier-asn:submit', 'supplier-quality:profiles:read'] } as never : String(path).includes('profiles') ? { items: [] } as never : String(path).endsWith('/a1') ? asn as never : page as never));

it('prevents submission until scanned evidence has been bound to the ASN', async () => {
  render(<SupplierAsnPage />);
  await userEvent.click(await screen.findByRole('button', { name: '查看与提交' }));
  const drawer = await screen.findByRole('dialog', { name: 'ASN 详情' });
  expect(within(drawer).getByText('请先绑定已扫描通过的证据')).toBeVisible();
  expect(within(drawer).getByRole('button', { name: '提交 ASN' })).toBeDisabled();
});

it('shows the single contracted material line and hides unauthorized submit', async () => {
  vi.mocked(apiRequest).mockImplementation(async (path) => String(path).includes('my-permissions') ? { permissions: ['supplier-asn:read'] } as never : String(path).endsWith('/a1') ? asn as never : page as never);
  render(<SupplierAsnPage />);
  expect(await screen.findByRole('button', { name: '查看与提交' })).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: '查看与提交' }));
  const drawer = await screen.findByRole('dialog', { name: 'ASN 详情' });
  expect(within(drawer).getByText('物料明细（1 项）')).toBeVisible();
  expect(within(drawer).getByText('M-1')).toBeVisible();
  expect(within(drawer).queryByRole('button', { name: '提交 ASN' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '新建 ASN' })).not.toBeInTheDocument();
});

it('submits bound evidence with the current ASN version', async () => {
  vi.mocked(apiRequest).mockImplementation(async (path, options) => {
    if (options?.method === 'POST') return { ...asn, status: 'SUBMITTED', version: 5 } as never;
    return String(path).includes('my-permissions') ? { permissions: ['supplier-asn:read', 'supplier-asn:submit'] } as never
      : String(path).endsWith('/a1') ? { ...asn, version: 4, evidence: [{ fileId: 'f1', fileVersion: 2, sha256: 'hash', scannedAt: '2026-09-27T00:00:00Z' }] } as never : page as never;
  });
  render(<SupplierAsnPage />);
  await userEvent.click(await screen.findByRole('button', { name: '查看与提交' }));
  await userEvent.click(await screen.findByRole('button', { name: '提交 ASN' }));
  expect(vi.mocked(apiRequest)).toHaveBeenCalledWith('/api/v1/supplier-asn/a1/submit', expect.objectContaining({ method: 'POST', body: JSON.stringify({ expectedVersion: 4 }) }));
});
