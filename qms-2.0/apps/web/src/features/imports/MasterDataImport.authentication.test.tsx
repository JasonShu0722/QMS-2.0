import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import type { components } from '@qms/contracts';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, csrfToken } from '../../api/client';
import { MasterDataImport } from './MasterDataImport';
import { readXlsxFile } from './read-xlsx';

vi.mock('./read-xlsx', () => ({ readXlsxFile: vi.fn() }));
vi.mock('../../api/client', async () => ({ ...await vi.importActual('../../api/client'), apiRequest: vi.fn(), csrfToken: vi.fn() }));
type Row = components['schemas']['ComponentProjectImportDto']['rows'][number];

beforeEach(() => {
  vi.mocked(csrfToken).mockReset().mockResolvedValue('csrf');
  vi.mocked(apiRequest).mockReset();
  vi.mocked(readXlsxFile).mockResolvedValue([['组件号', '组件名称'], ...Array.from({ length: 201 }, (_, index) => [`C-${index}`, 'Name'])]);
});

it.each(['request', 'csrf'] as const)('notifies the host and stops refreshing the old organization after %s authentication expires', async (source) => {
  const expired = new ApiError({ code: 'AUTH_SESSION_REQUIRED', message: 'Expired session' }, 401);
  const onUnauthorized = vi.fn();
  const onImported = vi.fn();
  if (source === 'csrf') vi.mocked(csrfToken).mockRejectedValueOnce(expired);
  else vi.mocked(apiRequest).mockResolvedValueOnce({ created: 100, skipped: 0, failed: 0, items: [] }).mockRejectedValueOnce(expired);
  render(<ConfigProvider theme={{ token: { motion: false } }}><MasterDataImport<Row>
    organizationId="organization" onImported={onImported} onUnauthorized={onUnauthorized}
    domain="组件" endpoint="/component-import" headers={['组件号', '组件名称']} fields={['componentCode', 'componentName']}
    rule="Test import" parse={(sheet) => sheet.slice(1).map((cells, index) => ({ rowNumber: index + 2, componentCode: String(cells[0]), componentName: String(cells[1]) }))}
  /></ConfigProvider>);
  fireEvent.click(screen.getByRole('button', { name: '批量导入组件' }));
  fireEvent.change(screen.getByLabelText('组件清单文件'), { target: { files: [new File(['test'], 'components.xlsx')] } });
  await waitFor(() => expect(screen.getByRole('button', { name: '导入组件' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '导入组件' }));
  await waitFor(() => expect(onUnauthorized).toHaveBeenCalledWith(expired));
  expect(apiRequest).toHaveBeenCalledTimes(source === 'csrf' ? 0 : 2);
  expect(onImported).not.toHaveBeenCalled();
});

it.each([
  { source: 'later csrf', status: 401, callback: true },
  { source: 'request without callback', status: 401, callback: false },
  { source: 'non-authentication request', status: 403, callback: true },
])('preserves the callback boundary for $source', async ({ source, status, callback }) => {
  const failure = new ApiError({ code: status === 401 ? 'AUTH_SESSION_REQUIRED' : 'FEATURE_PERMISSION_DENIED', message: 'Rejected' }, status);
  const onUnauthorized = vi.fn();
  const onImported = vi.fn();
  vi.mocked(apiRequest).mockResolvedValueOnce({ created: 100, skipped: 0, failed: 0, items: [] }).mockRejectedValueOnce(failure);
  if (source === 'later csrf') vi.mocked(csrfToken).mockResolvedValueOnce('csrf').mockRejectedValueOnce(failure);
  render(<ConfigProvider theme={{ token: { motion: false } }}><MasterDataImport<Row>
    organizationId="organization" onImported={onImported} onUnauthorized={callback ? onUnauthorized : undefined}
    domain="组件" endpoint="/component-import" headers={['组件号', '组件名称']} fields={['componentCode', 'componentName']}
    rule="Test import" parse={(sheet) => sheet.slice(1).map((cells, index) => ({ rowNumber: index + 2, componentCode: String(cells[0]), componentName: String(cells[1]) }))}
  /></ConfigProvider>);
  fireEvent.click(screen.getByRole('button', { name: '批量导入组件' }));
  fireEvent.change(screen.getByLabelText('组件清单文件'), { target: { files: [new File(['test'], 'components.xlsx')] } });
  await waitFor(() => expect(screen.getByRole('button', { name: '导入组件' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '导入组件' }));
  if (callback && status === 401) {
    await waitFor(() => expect(onUnauthorized).toHaveBeenCalledWith(failure));
    expect(onImported).not.toHaveBeenCalled();
  } else {
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(screen.getByText('当前批次结果未知，请使用原批次重试；已确认结果保留。')).toBeVisible();
  }
  expect(apiRequest).toHaveBeenCalledTimes(source === 'later csrf' ? 1 : 2);
  expect(csrfToken).toHaveBeenCalledTimes(2);
});
