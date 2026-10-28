import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { apiRequest, csrfToken, getSession } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { SupplierQualityPage } from './SupplierQualityPage';

vi.mock('../../api/client', async original => ({ ...await original<typeof import('../../api/client')>(), apiRequest: vi.fn(), csrfToken: vi.fn(), getSession: vi.fn() }));

it.each([false, true])('retains the real issuer attempt and freezes sibling editing (canEditFacts=%s)', async canEditFacts => {
  const id = '11111111-1111-4111-8111-111111111111';
  const assignmentId = '22222222-2222-4222-8222-222222222222';
  const record = { id, version: 7, profileId: 'profile', supplierName: 'Supplier', title: 'Prepared supplier draft', materialCode: 'PART',
    defectDescription: 'Observed defect', defectQuantity: 1, severity: 'HIGH', responseForm: 'EIGHT_D', replyMode: 'SUPPLIER', stage: 'DRAFT',
    canEditFacts, canEditResponse: false, controlledEightD: true, responseDraft: {}, updatedAt: '2026-10-28T00:00:00Z' };
  useWorkTabsStore.getState().reset(); useWorkTabsStore.getState().bindSession('INTERNAL:org:actor');
  vi.mocked(getSession).mockResolvedValue({ accountType: 'INTERNAL', organizationId: 'org', userId: 'actor', landingPath: '/app/workbench' });
  vi.mocked(csrfToken).mockResolvedValue('csrf');
  let writes = 0;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (path === '/api/v1/system/my-permissions') return { permissions: ['supplier-quality:issues:read', 'supplier-quality:issues:issue'] } as never;
    if (path.includes('reference-options')) return { items: [], total: 0 } as never;
    if (path.includes('assignment-options')) return { items: [{ assignmentId, userId: 'sqe', username: 'sqe', fullName: 'SQE', departmentId: 'section', departmentName: 'Supplier quality', positionName: 'Engineer' }], total: 1 } as never;
    if (init?.method === 'POST') { if (writes++ === 0) throw new TypeError('Response lost'); return { supplierProblemId: id } as never; }
    return record as never;
  });
  render(<LanguageProvider><MemoryRouter initialEntries={[`/app/supplier-quality/problems/${id}`]}><UnsavedChangesProvider><SupplierQualityPage /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>);
  const assignment = await screen.findByLabelText('SQE责任任职');
  const issuer = within(assignment.closest('section')!);
  await within(assignment).findByRole('option', { name: /Supplier quality/ });
  fireEvent.change(assignment, { target: { value: assignmentId } });
  fireEvent.click(issuer.getByRole('button', { name: '正式发起8D' }));
  await screen.findByText(/发单结果未知/);
  if (canEditFacts) {
    const title = screen.getByLabelText('问题标题');
    const save = within(title.closest('section')!).getByRole('button', { name: '保存问题草稿' });
    expect(title).toBeDisabled();
    expect(save).toBeDisabled();
    fireEvent.submit(save.closest('form')!);
    expect(vi.mocked(apiRequest).mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
  }
  const reads = vi.mocked(apiRequest).mock.calls.filter(([, init]) => !init?.method).length;
  const toolbar = within(screen.getByText('返回台账').closest('.supplier-toolbar')!);
  fireEvent.click(toolbar.getByRole('button', { name: '重新加载' }));
  expect(screen.queryByText('当前草稿尚未保存，继续将放弃修改。')).not.toBeInTheDocument();
  const retry = issuer.getByRole('button', { name: '重试原发单' });
  expect(retry).toBeVisible();
  expect(vi.mocked(apiRequest).mock.calls.filter(([, init]) => !init?.method)).toHaveLength(reads);
  fireEvent.click(retry);
  await waitFor(() => expect(writes).toBe(2));
  await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.filter(([, init]) => !init?.method).length).toBeGreaterThan(reads));
  await within(await screen.findByLabelText('SQE责任任职')).findByRole('option', { name: /Supplier quality/ });
  const attempts = vi.mocked(apiRequest).mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(attempts[1]![1]?.body).toBe(attempts[0]![1]?.body);
  expect(attempts[1]![1]?.headers).toEqual(attempts[0]![1]?.headers);
});
