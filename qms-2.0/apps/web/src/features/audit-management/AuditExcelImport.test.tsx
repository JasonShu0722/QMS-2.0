import ExcelJS from 'exceljs';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, csrfToken } from '../../api/client';
import { AuditExcelImport } from './AuditExcelImport';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, apiRequest: vi.fn(), csrfToken: vi.fn() };
});

async function workbookFile(rows: unknown[][]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('审核问题');
  sheet.addRow(['sourceSystem', 'externalKey', 'finding']);
  rows.forEach((row) => sheet.addRow(row));
  const bytes = await workbook.xlsx.writeBuffer();
  const file = new File([bytes], 'audit.xlsx');
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array(bytes as unknown as ArrayBuffer).buffer });
  return file;
}

beforeEach(() => { vi.mocked(apiRequest).mockReset(); vi.mocked(csrfToken).mockReset().mockResolvedValue('csrf'); });

it('previews real workbook rows and retries only failed rows with the same key', async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'row-a' }).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ id: 'row-b' });
  const done = vi.fn();
  render(<AuditExcelImport organizationId="org-a" onImported={done} onDenied={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('审核 Excel 文件'), { target: { files: [await workbookFile([['CUSTOMER', 'a', '第一条'], ['SECOND_PARTY', 'b', '第二条']])] } });
  expect(await screen.findByText('第一条')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '导入待处理行' }));
  expect(await screen.findByText('结果未知，请使用原请求重试')).toBeVisible();
  const attempts = vi.mocked(apiRequest).mock.calls;
  expect(attempts).toHaveLength(2);
  const failedKey = (attempts[1]![1]!.headers as Record<string, string>)['Idempotency-Key'];
  const retryButton = screen.getByRole('button', { name: /重试未成功行/ });
  await waitFor(() => { expect(retryButton).toBeEnabled(); expect(retryButton).not.toHaveClass('ant-btn-loading'); });
  fireEvent.click(retryButton);
  await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(3));
  expect((vi.mocked(apiRequest).mock.calls[2]![1]!.headers as Record<string, string>)['Idempotency-Key']).toBe(failedKey);
  expect(JSON.parse(vi.mocked(apiRequest).mock.calls[2]![1]!.body as string)).toMatchObject({ externalKey: 'b', organizationId: 'org-a' });
  await waitFor(() => expect(screen.getAllByText('已导入')).toHaveLength(2));
});

it('shows rejected row errors and never submits them', async () => {
  render(<AuditExcelImport organizationId="org-a" onImported={vi.fn()} onDenied={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('审核 Excel 文件'), { target: { files: [await workbookFile([['BAD', '', '无效行'], ['CUSTOMER', 'valid', '有效行']])] } });
  expect(await screen.findByText(/仅支持 CUSTOMER/)).toBeVisible();
  vi.mocked(apiRequest).mockResolvedValue({ id: 'valid' });
  fireEvent.click(screen.getByRole('button', { name: '导入待处理行' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1));
  expect(JSON.parse(vi.mocked(apiRequest).mock.calls[0]![1]!.body as string)).toMatchObject({ externalKey: 'valid' });
});

it('stops the remaining rows and clears workbook data on permission denial', async () => {
  const denied = vi.fn();
  vi.mocked(apiRequest).mockRejectedValue(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'denied' }, 403));
  render(<AuditExcelImport organizationId="org-a" onImported={vi.fn()} onDenied={denied} />);
  fireEvent.change(screen.getByLabelText('审核 Excel 文件'), { target: { files: [await workbookFile([['CUSTOMER', 'a', '敏感发现'], ['CUSTOMER', 'b', '第二条']])] } });
  await screen.findByText('敏感发现');
  fireEvent.click(screen.getByRole('button', { name: '导入待处理行' }));
  await waitFor(() => expect(denied).toHaveBeenCalled());
  expect(apiRequest).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('敏感发现')).toBeNull();
});

it('blocks another retry while the original failed row is still being retried', async () => {
  let completeRetry!: (value: unknown) => void;
  const retry = new Promise((resolve) => { completeRetry = resolve; });
  vi.mocked(apiRequest).mockRejectedValueOnce(new Error('offline')).mockReturnValue(retry);
  render(<AuditExcelImport organizationId="org-a" onImported={vi.fn()} onDenied={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('审核 Excel 文件'), { target: { files: [await workbookFile([['CUSTOMER', 'a', '重试发现']])] } });
  await screen.findByText('重试发现');
  fireEvent.click(screen.getByRole('button', { name: '导入待处理行' }));
  await screen.findByText('结果未知，请使用原请求重试');
  const button = screen.getByRole('button', { name: '重试未成功行' });
  await waitFor(() => { expect(button).toBeEnabled(); expect(button).not.toHaveClass('ant-btn-loading'); });
  fireEvent.click(button);
  await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(2));
  const disabledDuringRetry = button.hasAttribute('disabled');
  await act(async () => { fireEvent.click(button); });
  const attemptsDuringRetry = vi.mocked(apiRequest).mock.calls.length;
  await act(async () => { completeRetry({ id: 'row-a' }); await retry; });
  await screen.findByText('已导入');
  expect(disabledDuringRetry).toBe(true);
  expect(attemptsDuringRetry).toBe(2);
});
