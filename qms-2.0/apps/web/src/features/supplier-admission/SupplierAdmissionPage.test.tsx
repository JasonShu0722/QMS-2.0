import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiRequest } from '../../api/client';
import { SupplierAdmissionPage } from './SupplierAdmissionPage';

vi.mock('../../api/client', async () => { const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client'); return { ...actual, apiRequest: vi.fn() }; });

beforeEach(() => vi.mocked(apiRequest).mockReset());

it('shows the real supplier document ledger and scan-bound submission affordance', async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce({ items: [{ id: 'd1', profileId: 'p1', ownerOrganizationId: 'o1', supplierOrganizationId: 's1', documentType: 'QUALITY_MANUAL', title: '质量手册', status: 'DRAFT', version: 1, fileId: null, reviewNote: null, createdAt: '2026-09-24T00:00:00Z', updatedAt: '2026-09-24T00:00:00Z' }], total: 1, page: 1, pageSize: 50 });
  render(<SupplierAdmissionPage portal />);
  expect((await screen.findAllByText('质量手册'))[0]).toBeVisible();
  expect(screen.queryByText('请输入已扫描通过的附件 ID')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '提交审核' })).toBeEnabled();
});
