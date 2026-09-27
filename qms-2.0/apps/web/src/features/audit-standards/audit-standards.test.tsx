import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiRequest } from '../../api/client';
import { AuditStandardsPage } from './AuditStandardsPage';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, apiRequest: vi.fn() };
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
