import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiRequest, csrfToken } from '../../api/client';
import { CustomerComplaintEightDPanel } from './CustomerComplaintEightDPanel';
import { Link, MemoryRouter } from 'react-router-dom';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { AttachmentPanel } from '../attachments/AttachmentPanel';

vi.mock('../../api/client', async () => ({ ...(await vi.importActual<typeof import('../../api/client')>('../../api/client')), apiRequest: vi.fn(), csrfToken: vi.fn().mockResolvedValue('csrf') }));
vi.mock('../attachments/AttachmentPanel', () => ({ AttachmentPanel: vi.fn(() => <></>) }));
const draft = { complaintId: 'c1', version: 1, status: 'DRAFT', approvalLevel: 'L2', submittedAt: null, approvedAt: null, verificationEvidenceFileIds: [], archiveChecklist: [], what: '', why: '', where: '', when: '', who: '', how: '', howMuch: '', containment: '', rootCause: '', verification: '', preventiveAction: '', horizontalDeployment: '', lessonsLearned: '' } as const;
beforeEach(() => { vi.mocked(apiRequest).mockReset().mockResolvedValue(draft as never); vi.mocked(AttachmentPanel).mockReset().mockImplementation(() => <></>); });
it('protects an unfinished 8D draft when navigating away', async () => {
  render(<MemoryRouter><UnsavedChangesProvider><CustomerComplaintEightDPanel complaintId="c1" canWrite /><Link to="/app/workbench">返回工作台</Link></UnsavedChangesProvider></MemoryRouter>);
  fireEvent.change(await screen.findByLabelText('D4 根本原因'), { target: { value: '尚未保存的原因' } });
  fireEvent.click(screen.getByRole('link', { name: '返回工作台' }));
  await waitFor(() => expect(screen.getByText('当前草稿尚未保存，继续将放弃修改。')).toBeVisible());
  await waitFor(() => expect(screen.getByRole('button', { name: '继续编辑' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('D4 根本原因')).toHaveValue('尚未保存的原因');
});
it('renders 5W2H and submits the internal graded approval request', async () => {
  render(<CustomerComplaintEightDPanel complaintId="c1" canWrite />);
  expect(await screen.findByLabelText('What · 发生了什么')).toBeVisible();
  for (const label of ['What · 发生了什么', 'Why · 为什么', 'Where · 发生地点', 'When · 发生时间', 'Who · 涉及人员', 'How · 如何发生', 'How much · 影响数量', '围堵措施', 'D4 根本原因', 'D6 验证结果', 'D7 预防措施', 'D8 水平展开', '经验教训']) fireEvent.change(screen.getByLabelText(label), { target: { value: label === 'D4 根本原因' ? '设备偏移' : '已确认' } });
  for (const item of ['SOURCE_CONFIRMED', 'CONTAINMENT_VERIFIED', 'ROOT_CAUSE_VERIFIED', 'PREVENTION_DEPLOYED', 'HORIZONTAL_DEPLOYMENT_RECORDED', 'EVIDENCE_COMPLETE']) fireEvent.click(screen.getByText(item));
  fireEvent.click(screen.getByRole('button', { name: '提交分级审批' }));
  await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith('/api/v1/customer-quality/complaints/c1/8d/submit', expect.objectContaining({ method: 'POST' })));
  expect(csrfToken).toHaveBeenCalled();
});

it('retains saved evidence ids before metadata loads and removes explicitly deleted evidence', async () => {
  vi.mocked(apiRequest).mockResolvedValue({ ...draft, verificationEvidenceFileIds: ['evidence-1', 'evidence-2'] } as never);
  vi.mocked(AttachmentPanel).mockImplementation(({ fileIds, onRemoved }) => <><span>{fileIds.join(',')}</span><button onClick={() => onRemoved?.('evidence-2')}>删除第二份证据</button></>);
  render(<CustomerComplaintEightDPanel complaintId="c1" canWrite />);
  await screen.findByText('evidence-1,evidence-2');
  fireEvent.click(screen.getByRole('button', { name: '删除第二份证据' }));
  fireEvent.click(screen.getByRole('button', { name: '保存 8D 草稿' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/customer-quality/complaints/c1/8d/draft', expect.objectContaining({ body: expect.stringContaining('"verificationEvidenceFileIds":["evidence-1"]') })));
});

it('allows submitted approval while freezing its inputs and blocking duplicate writes', async () => {
  let complete!: (value: unknown) => void;
  vi.mocked(apiRequest).mockResolvedValueOnce({ ...draft, status: 'SUBMITTED' } as never).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  render(<CustomerComplaintEightDPanel complaintId="c1" canWrite />);
  const note = await screen.findByLabelText('8D 审批意见');
  expect(note).toBeEnabled();
  fireEvent.change(note, { target: { value: '独立审批通过' } });
  const approve = screen.getByRole('button', { name: '审批通过' });
  fireEvent.click(approve); fireEvent.click(approve);
  await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(2));
  expect(note).toBeDisabled();
  complete({ ...draft, status: 'APPROVED' });
  await waitFor(() => expect(screen.queryByLabelText('8D 审批意见')).not.toBeInTheDocument());
});
