import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { apiRequest, csrfToken } from '../../api/client';
import { UnsavedChangesProvider, useNavigationGuard } from '../../layouts/UnsavedChanges';
import { CustomerMasterImport } from '../customer-quality/CustomerMasterImport';
import { readXlsxFile } from './read-xlsx';

vi.mock('./read-xlsx', () => ({ readXlsxFile: vi.fn() }));
vi.mock('../../api/client', async () => ({ ...await vi.importActual('../../api/client'), apiRequest: vi.fn(), csrfToken: vi.fn() }));
beforeEach(() => {
  vi.mocked(apiRequest).mockReset(); vi.mocked(csrfToken).mockResolvedValue('csrf');
  vi.mocked(readXlsxFile).mockResolvedValue([['客户编码', '客户名称'], ...Array.from({ length: 101 }, (_, i) => [`00${i}`, '客户'])]);
});
function Page() {
  const [organization, setOrganization] = useState('old');
  const leave = useNavigationGuard();
  return <><span>{organization}</span><button onClick={() => leave(() => setOrganization('new'))}>切换组织</button><Link to="/other">离开</Link><CustomerMasterImport organizationId={organization} onImported={vi.fn()} /></>;
}
async function upload() {
  fireEvent.click(screen.getByRole('button', { name: '批量导入客户' }));
  fireEvent.change(screen.getByLabelText('客户清单文件'), { target: { files: [new File(['xlsx'], 'masters.xlsx')] } });
  await waitFor(() => expect(screen.getByRole('button', { name: '导入客户' })).toBeEnabled());
}
function renderPage() {
  render(<MemoryRouter><UnsavedChangesProvider><Routes><Route path="/" element={<Page />} /><Route path="/other" element={<div>目标页面</div>} /></Routes></UnsavedChangesProvider></MemoryRouter>);
}
it.each(['切换组织', '离开'])('guards %s and unload, retains the pending batch on cancel and stops on confirmed leave', async (action) => {
  let resolve!: (value: unknown) => void;
  vi.mocked(apiRequest).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  renderPage(); await upload();
  fireEvent.click(screen.getByRole('button', { name: '导入客户' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledOnce());
  expect(screen.getByLabelText('客户清单文件')).toBeDisabled();
  expect(screen.queryByRole('button', { name: /关\s*闭/ })).not.toBeInTheDocument();
  const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
  const leave = () => fireEvent.click(screen.getByRole(action === '离开' ? 'link' : 'button', { name: action }));
  leave(); await screen.findByText('当前草稿尚未保存，继续将放弃修改。');
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(apiRequest).toHaveBeenCalledOnce(); expect(screen.getByText('old')).toBeInTheDocument();
  leave(); fireEvent.click(screen.getByRole('button', { name: '放弃修改' }));
  await screen.findByText(action === '离开' ? '目标页面' : 'new');
  await act(async () => resolve({ created: 100, skipped: 0, failed: 0, items: [] }));
  expect(apiRequest).toHaveBeenCalledOnce();
});
