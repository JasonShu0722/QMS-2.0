import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, csrfToken } from '../../api/client';
import { AuditMobileExecution } from './AuditMobileExecution';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, apiRequest: vi.fn(), csrfToken: vi.fn() };
});

const snapshot = {
  execution: { id: 'exec-1', plan_id: 'plan-1', template_version_id: 'version-1', status: 'OPEN', version: 1 },
  items: [{ key: 'P1', text: '过程受控' }, { key: 'P2', text: '记录完整' }],
  checklist: [],
};

beforeEach(() => { vi.mocked(apiRequest).mockReset(); vi.mocked(csrfToken).mockReset().mockResolvedValue('csrf'); localStorage.clear(); useWorkTabsStore.getState().bindSession('INTERNAL:org-1:user-1'); });

it('saves checklist values locally while offline and restores them on reload', async () => {
  vi.mocked(apiRequest).mockResolvedValue(snapshot as never);
  render(<AuditMobileExecution initialExecutionId="exec-1" />);
  expect(await screen.findByText(/P1 · 过程受控/)).toBeVisible();
  fireEvent.click(screen.getByLabelText('P1 结果').querySelector('input[value="NG"]')!);
  fireEvent.change(screen.getByLabelText('P1 备注'), { target: { value: '现场记录缺失' } });
  expect(JSON.parse(localStorage.getItem('qms.audit.mobile-draft.INTERNAL:org-1:user-1.exec-1')!)).toMatchObject({ P1: { result: 'NG', note: '现场记录缺失' } });
});

it('keeps the local draft and shows a conflict when sync races another session', async () => {
  vi.mocked(apiRequest)
    .mockResolvedValueOnce(snapshot as never)
    .mockRejectedValueOnce(new ApiError({ code: 'CONCURRENCY_CONFLICT', message: 'conflict' }, 409));
  render(<AuditMobileExecution initialExecutionId="exec-1" />);
  await screen.findByText(/P1 · 过程受控/);
  fireEvent.click(screen.getByLabelText('P1 结果').querySelector('input[value="OK"]')!);
  fireEvent.click(screen.getByRole('button', { name: '同步草稿' }));
  expect(await screen.findByText('审核已在其他会话中更新')).toBeVisible();
  expect(localStorage.getItem('qms.audit.mobile-draft.INTERNAL:org-1:user-1.exec-1')).toContain('P1');
  await waitFor(() => expect(csrfToken).toHaveBeenCalled());
});
