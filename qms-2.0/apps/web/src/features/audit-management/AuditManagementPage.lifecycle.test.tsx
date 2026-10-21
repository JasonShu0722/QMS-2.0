import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError, apiRequest } from '../../api/client';
import { AuditManagementPage } from './AuditManagementPage';

vi.mock('../../api/client', async () => ({ ...(await vi.importActual<typeof import('../../api/client')>('../../api/client')), apiRequest: vi.fn() }));
vi.mock('./AuditMobileExecution', () => ({ AuditMobileExecution: () => null }));
vi.mock('./AuditExcelImport', async () => {
  const { useState } = await import('react');
  return { AuditExcelImport: ({ onImported }: { onImported: () => void }) => {
    const [retryKey, setRetryKey] = useState('');
    return <><output aria-label="未成功行原请求键">{retryKey}</output><button onClick={() => { setRetryKey('row-2-original-key'); onImported(); }}>模拟部分成功</button></>;
  } };
});

const permissions = { organizationId: 'org-1', permissions: ['audit-management:write'] };
const page = { items: [], total: 0, page: 1, pageSize: 20 };

beforeEach(() => { vi.mocked(apiRequest).mockReset(); });

it('keeps the same importer and retry key through the real onImported parent refresh', async () => {
  let finishList!: (value: typeof page) => void;
  let finishPermissions!: (value: typeof permissions) => void;
  const nextList = new Promise<typeof page>((resolve) => { finishList = resolve; });
  const nextPermissions = new Promise<typeof permissions>((resolve) => { finishPermissions = resolve; });
  let lists = 0;
  let permissionReads = 0;
  vi.mocked(apiRequest).mockImplementation((url) => url.includes('/my-permissions')
    ? (++permissionReads === 1 ? Promise.resolve(permissions) : nextPermissions) as never
    : (++lists === 1 ? Promise.resolve(page) : nextList) as never);
  render(<AuditManagementPage />);
  fireEvent.click(await screen.findByRole('button', { name: '模拟部分成功' }));
  await waitFor(() => expect(lists).toBe(2));
  expect(screen.getByLabelText('未成功行原请求键')).toHaveTextContent('row-2-original-key');
  await act(async () => { finishList(page); });
  await waitFor(() => expect(permissionReads).toBe(2));
  expect(screen.getByLabelText('未成功行原请求键')).toHaveTextContent('row-2-original-key');
  await act(async () => { finishPermissions(permissions); });
  expect(screen.getByLabelText('未成功行原请求键')).toHaveTextContent('row-2-original-key');
});

it.each(['ledger', 'permissions'] as const)('retains retry rows when the background %s refresh fails transiently', async (failure) => {
  let lists = 0;
  let permissionReads = 0;
  vi.mocked(apiRequest).mockImplementation(async (url) => {
    if (url.includes('/my-permissions')) {
      if (++permissionReads > 1 && failure === 'permissions') throw new Error('offline');
      return permissions;
    }
    if (++lists > 1 && failure === 'ledger') throw new Error('offline');
    return page;
  });
  render(<AuditManagementPage />);
  fireEvent.click(await screen.findByRole('button', { name: '模拟部分成功' }));
  await screen.findByText(failure === 'ledger' ? '导入行加载或复核失败' : '无法验证发单权限');
  expect(screen.getByLabelText('未成功行原请求键')).toHaveTextContent('row-2-original-key');
});

it.each(['ledger', 'permissions'] as const)('clears the importer when the background %s refresh explicitly denies access', async (failure) => {
  let lists = 0;
  let permissionReads = 0;
  const denied = new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'denied' }, 403);
  vi.mocked(apiRequest).mockImplementation(async (url) => {
    if (url.includes('/my-permissions')) {
      if (++permissionReads > 1 && failure === 'permissions') throw denied;
      return permissions;
    }
    if (++lists > 1 && failure === 'ledger') throw denied;
    return page;
  });
  render(<AuditManagementPage />);
  fireEvent.click(await screen.findByRole('button', { name: '模拟部分成功' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '模拟部分成功' })).not.toBeInTheDocument());
});
