import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiRequest, csrfToken } from '../../api/client';
import { CustomerComplaintEightDPanel } from './CustomerComplaintEightDPanel';

vi.mock('../../api/client', async () => ({ ...(await vi.importActual<typeof import('../../api/client')>('../../api/client')), apiRequest: vi.fn(), csrfToken: vi.fn().mockResolvedValue('csrf') }));
const draft = { complaintId: 'c1', version: 1, status: 'DRAFT', approvalLevel: 'L2', submittedAt: null, approvedAt: null, verificationEvidenceFileIds: [], archiveChecklist: [], what: '', why: '', where: '', when: '', who: '', how: '', howMuch: '', containment: '', rootCause: '', verification: '', preventiveAction: '', horizontalDeployment: '', lessonsLearned: '' } as const;
beforeEach(() => vi.mocked(apiRequest).mockResolvedValue(draft as never));
it('renders 5W2H and submits the internal graded approval request', async () => {
  render(<CustomerComplaintEightDPanel complaintId="c1" canWrite />);
  expect(await screen.findByLabelText('What · 发生了什么')).toBeVisible();
  for (const label of ['What · 发生了什么', 'Why · 为什么', 'Where · 发生地点', 'When · 发生时间', 'Who · 涉及人员', 'How · 如何发生', 'How much · 影响数量', '围堵措施', 'D4 根本原因', 'D6 验证结果', 'D7 预防措施', 'D8 水平展开', '经验教训']) fireEvent.change(screen.getByLabelText(label), { target: { value: label === 'D4 根本原因' ? '设备偏移' : '已确认' } });
  for (const item of ['SOURCE_CONFIRMED', 'CONTAINMENT_VERIFIED', 'ROOT_CAUSE_VERIFIED', 'PREVENTION_DEPLOYED', 'HORIZONTAL_DEPLOYMENT_RECORDED', 'EVIDENCE_COMPLETE']) fireEvent.click(screen.getByText(item));
  fireEvent.click(screen.getByRole('button', { name: '提交分级审批' }));
  await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith('/api/v1/customer-quality/complaints/c1/8d/submit', expect.objectContaining({ method: 'POST' })));
  expect(csrfToken).toHaveBeenCalled();
});
