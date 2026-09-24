import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiRequest } from '../../api/client';
import { AuditManagementPage } from './AuditManagementPage';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, apiRequest: vi.fn() };
});

const plan = {
  id: 'plan-1', organization_id: 'org-1', year: 2026, title: '年度体系审核', audit_type: 'SYSTEM' as const,
  planned_start: '2026-10-01T08:00:00.000Z', planned_end: '2026-10-02T17:00:00.000Z', status: 'PLANNED' as const, version: 1,
};

beforeEach(() => vi.mocked(apiRequest).mockReset());

it('loads a plan after the user enters its identifier', async () => {
  vi.mocked(apiRequest).mockResolvedValue(plan);
  render(<AuditManagementPage />);
  fireEvent.change(screen.getByLabelText('审核计划 ID'), { target: { value: plan.id } });
  fireEvent.click(screen.getByRole('button', { name: '查看计划' }));
  expect(await screen.findByText('年度体系审核')).toBeVisible();
  expect(apiRequest).toHaveBeenCalledWith(`/api/v1/audit-management/plans/${plan.id}`);
  expect(screen.getByText('已计划')).toBeVisible();
});

it('shows an explicit empty state after a successful lookup with no plan', async () => {
  vi.mocked(apiRequest).mockResolvedValue(undefined as never);
  render(<AuditManagementPage planId="missing-plan" />);
  expect(await screen.findByText('未找到审核计划')).toBeVisible();
});

it('offers a retry action for transient failures', async () => {
  vi.mocked(apiRequest).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(plan);
  render(<AuditManagementPage planId={plan.id} />);
  expect(await screen.findByText('审计计划加载失败，请重试。')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
  await waitFor(() => expect(screen.getByText('年度体系审核')).toBeVisible());
});
