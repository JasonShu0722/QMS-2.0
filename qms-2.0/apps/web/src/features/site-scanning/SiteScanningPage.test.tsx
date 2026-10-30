import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiRequest, csrfToken } from '../../api/client';
import { SiteScanningPage } from './SiteScanningPage';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, apiRequest: vi.fn(), csrfToken: vi.fn().mockResolvedValue('csrf-token') };
});

const rule = { id: 'rule-1', title: '关键件扫码', materialCode: 'MAT-1', prefix: 'MAT', codeLength: 8, status: 'PUBLISHED', version: 2 };

beforeEach(() => {
  vi.mocked(apiRequest).mockReset();
  vi.mocked(csrfToken).mockReset().mockResolvedValue('csrf-token');
});

it('scans a published rule with a stable retry key and clears the code after success', async () => {
  let attempts = 0;
  vi.mocked(apiRequest).mockImplementation((path) => {
    if (path === '/api/v1/system/my-permissions') return Promise.resolve({ permissions: ['supplier-barcode:scan'], organizationId: 'org-1' }) as never;
    if (path.startsWith('/api/v1/supplier-barcode?')) return Promise.resolve({ items: [rule], total: 1, page: 1, pageSize: 100 }) as never;
    if (path === '/api/v1/supplier-barcode/scan') return ++attempts === 1 ? Promise.reject(new Error('offline')) : Promise.resolve({ id: 'scan-1', barcode: 'MAT00001', scannedAt: '2026-09-26T12:00:00Z' }) as never;
    throw new Error(`unexpected ${path}`);
  });
  render(<SiteScanningPage />);
  fireEvent.change(await screen.findByLabelText('条码'), { target: { value: 'MAT00001' } });
  expect(screen.getByRole('heading', { level: 1, name: '关键件条码校验' })).toHaveClass('sr-only');
  fireEvent.click(screen.getByRole('button', { name: '确认扫码' }));
  expect(await screen.findByText('offline')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '重试扫码' }));
  await screen.findByText('MAT00001 已归档');
  const scans = vi.mocked(apiRequest).mock.calls.filter(([path]) => path === '/api/v1/supplier-barcode/scan');
  expect(scans).toHaveLength(2);
  expect(scans[0]?.[1]?.headers).toEqual(scans[1]?.[1]?.headers);
  expect(scans[0]?.[1]?.body).toBe(JSON.stringify({ ruleId: 'rule-1', barcode: 'MAT00001' }));
  expect(screen.getByLabelText('条码')).toHaveValue('');
});

it('blocks scanning when permission is absent', async () => {
  vi.mocked(apiRequest).mockResolvedValue({ permissions: [], organizationId: 'org-1' });
  render(<SiteScanningPage />);
  expect(await screen.findByText('暂无现场扫码权限')).toBeVisible();
  expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path === '/api/v1/supplier-barcode/scan')).toBe(false);
});

it('requires a published rule and a matching code length', async () => {
  vi.mocked(apiRequest).mockImplementation((path) => path === '/api/v1/system/my-permissions'
    ? Promise.resolve({ permissions: ['supplier-barcode:scan'], organizationId: 'org-1' }) as never
    : Promise.resolve({ items: [rule], total: 1, page: 1, pageSize: 100 }) as never);
  render(<SiteScanningPage />);
  fireEvent.change(await screen.findByLabelText('条码'), { target: { value: 'MAT1' } });
  fireEvent.click(screen.getByRole('button', { name: '确认扫码' }));
  expect(await screen.findByText('条码格式与规则不符')).toBeVisible();
  await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.filter(([path]) => path === '/api/v1/supplier-barcode/scan')).toHaveLength(0));
});

it('does not send another scan when Enter is pressed while the first scan is pending', async () => {
  let resolveScan: ((value: unknown) => void) | undefined;
  let resolveCsrf!: (value: string) => void;
  vi.mocked(csrfToken).mockImplementationOnce(() => new Promise(resolve => { resolveCsrf = resolve; }));
  vi.mocked(apiRequest).mockImplementation((path) => {
    if (path === '/api/v1/system/my-permissions') return Promise.resolve({ permissions: ['supplier-barcode:scan'], organizationId: 'org-1' }) as never;
    if (path.startsWith('/api/v1/supplier-barcode?')) return Promise.resolve({ items: [rule], total: 1, page: 1, pageSize: 100 }) as never;
    if (path === '/api/v1/supplier-barcode/scan') return new Promise((resolve) => { resolveScan = resolve; }) as never;
    throw new Error(`unexpected ${path}`);
  });
  render(<SiteScanningPage />);
  const barcode = await screen.findByLabelText('条码');
  fireEvent.change(barcode, { target: { value: 'MAT00001' } });
  fireEvent.keyDown(barcode, { key: 'Enter', code: 'Enter', keyCode: 13 });
  fireEvent.keyUp(barcode, { key: 'Enter', code: 'Enter', keyCode: 13 });
  fireEvent.keyDown(barcode, { key: 'Enter', code: 'Enter', keyCode: 13 });
  fireEvent.keyUp(barcode, { key: 'Enter', code: 'Enter', keyCode: 13 });
  expect(vi.mocked(csrfToken)).toHaveBeenCalledTimes(1);
  expect(barcode).toBeDisabled();
  expect(screen.getByLabelText('批次（可选）')).toBeDisabled();
  expect(screen.getByLabelText('条码规则')).toBeDisabled();
  expect(vi.mocked(apiRequest).mock.calls.filter(([path]) => path === '/api/v1/supplier-barcode/scan')).toHaveLength(0);
  await act(async () => resolveCsrf('csrf-token'));
  await waitFor(() => expect(resolveScan).toBeDefined());
  fireEvent.keyDown(barcode, { key: 'Enter', code: 'Enter', keyCode: 13 });
  fireEvent.keyUp(barcode, { key: 'Enter', code: 'Enter', keyCode: 13 });
  await waitFor(() => expect(vi.mocked(csrfToken)).toHaveBeenCalled());
  expect(vi.mocked(csrfToken)).toHaveBeenCalledTimes(1);
  expect(vi.mocked(apiRequest).mock.calls.filter(([path]) => path === '/api/v1/supplier-barcode/scan')).toHaveLength(1);
  await act(async () => resolveScan!({ id: 'scan-1' }));
  expect(await screen.findByText('MAT00001 已归档')).toBeVisible();
  fireEvent.change(barcode, { target: { value: 'MAT00002' } });
  fireEvent.keyDown(barcode, { key: 'Enter', code: 'Enter', keyCode: 13 });
  fireEvent.keyUp(barcode, { key: 'Enter', code: 'Enter', keyCode: 13 });
  await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.filter(([path]) => path === '/api/v1/supplier-barcode/scan')).toHaveLength(2));
  const scans = vi.mocked(apiRequest).mock.calls.filter(([path]) => path === '/api/v1/supplier-barcode/scan');
  expect(scans[1]?.[1]?.headers).not.toEqual(scans[0]?.[1]?.headers);
  await act(async () => resolveScan!({ id: 'scan-2' }));
  expect(await screen.findByText('MAT00002 已归档')).toBeVisible();
});
