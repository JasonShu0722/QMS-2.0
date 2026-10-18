import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiRequest, csrfToken } from '../../api/client';
import { CustomerMasterSection } from '../customer-quality/CustomerMasterSection';
import { SupplierProfilesPage } from '../supplier-quality/SupplierProfilesPage';
import { MaterialMasterPage } from '../material-master/MaterialMasterPage';
import { readXlsxFile } from './read-xlsx';

vi.mock('./read-xlsx', () => ({ readXlsxFile: vi.fn() }));
vi.mock('../../api/client', async () => ({ ...await vi.importActual('../../api/client'), apiRequest: vi.fn(), csrfToken: vi.fn() }));
beforeEach(() => { vi.mocked(apiRequest).mockReset(); vi.mocked(csrfToken).mockResolvedValue('csrf'); });

it.each(['供应商', '客户', '物料'])('retains %s receipt and reports a real page refresh failure', async (domain) => {
  const Component = domain === '供应商' ? SupplierProfilesPage : domain === '客户' ? CustomerMasterSection : MaterialMasterPage;
  const permissions = domain === '供应商' ? ['supplier-quality:profiles:read', 'supplier-quality:profiles:write'] : domain === '客户' ? ['customer-quality:complaints:read', 'customer-quality:complaints:write'] : ['material-master:read', 'material-master:import'];
  let reads = 0;
  vi.mocked(apiRequest).mockImplementation(async (_path, init) => {
    if (init?.method === 'POST') return { created: 1, skipped: 0, failed: 0, items: [{ rowNumber: 2, code: '0001', status: 'CREATED' }] };
    if (++reads > 1) throw new Error('refresh offline');
    return domain === '供应商' ? { items: [], total: 0 } : [];
  });
  vi.mocked(readXlsxFile).mockResolvedValue([[`${domain}编码`, `${domain}名称`, ...(domain === '供应商' ? ['联系人', '联系邮箱'] : [])], ['0001', '名称']]);
  render(<Component organizationPermissions={permissions} />);
  await waitFor(() => expect(apiRequest).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: `批量导入${domain}` }));
  fireEvent.change(screen.getByLabelText(`${domain}清单文件`), { target: { files: [new File(['xlsx'], 'master.xlsx')] } });
  const submit = screen.getByRole('button', { name: `导入${domain}` });
  await waitFor(() => expect(submit).toBeEnabled()); fireEvent.click(submit);
  await screen.findByText('导入回执已保留，列表刷新失败，请稍后刷新列表。');
  expect(screen.getByText('新增 1，重复跳过 0，失败 0')).toBeInTheDocument();
  expect(screen.getByText('已确认 1 / 1，未处理 0')).toBeInTheDocument();
  expect(vi.mocked(apiRequest).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});

it('keeps the customer importer and receipt mounted when permission revalidation fails', async () => {
  let permissionReads = 0;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (path.includes('my-permissions')) {
      if (++permissionReads > 1) throw new Error('permission read offline');
      return { permissions: ['customer-quality:complaints:read', 'customer-quality:complaints:write'] };
    }
    if (init?.method === 'POST') return { created: 1, skipped: 0, failed: 0, items: [{ rowNumber: 2, code: '0001', status: 'CREATED' }] };
    return [];
  });
  vi.mocked(readXlsxFile).mockResolvedValue([['客户编码', '客户名称'], ['0001', '客户']]);
  render(<CustomerMasterSection />);
  fireEvent.click(await screen.findByRole('button', { name: '批量导入客户' }));
  fireEvent.change(screen.getByLabelText('客户清单文件'), { target: { files: [new File(['xlsx'], 'master.xlsx')] } });
  const submit = screen.getByRole('button', { name: '导入客户' });
  await waitFor(() => expect(submit).toBeEnabled()); fireEvent.click(submit);
  await screen.findByText('导入回执已保留，列表刷新失败，请稍后刷新列表。');
  expect(screen.getByRole('button', { name: '新增客户' })).toBeInTheDocument();
  expect(screen.getByText('新增 1，重复跳过 0，失败 0')).toBeInTheDocument();
});
