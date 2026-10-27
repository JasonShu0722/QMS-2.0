import type { components } from '@qms/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, csrfToken, getSession } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider, useNavigationBusy } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { CustomerLedgerHandoff } from './customer-ledger-handoff';

vi.mock('../../api/client', async () => ({ ...(await vi.importActual<typeof import('../../api/client')>('../../api/client')), apiRequest: vi.fn(), csrfToken: vi.fn(), getSession: vi.fn() }));
const org = '22222222-2222-4222-8222-222222222222';
const candidate: components['schemas']['CustomerLedgerCandidateDto'] = {
  assignmentId: '33333333-3333-4333-8333-333333333333', userId: 'new-qe', username: 'qe', fullName: '接任工程师', departmentName: '质量', positionName: '项目质量',
};
const record: components['schemas']['CustomerLedgerDetailDto'] = {
  id: '11111111-1111-4111-8111-111111111111', organizationId: org, complaintNumber: 'CQ-HANDOFF', version: 7, status: 'FOLLOWING', legacyStatus: 'OPEN', customerId: null,
  raw: { quantity: '20', investigation: '原调查' },
  normalized: { complaintType: null, customerName: null, terminalCustomerName: null, componentCode: null, productModel: null, defectDescription: null, quantity: 20, vin: null, barcode: null, batch: null, mileage: null, occurredOn: null, productionOn: null, purchaseOn: null, vehicleDeliveryOn: null, vehicleOfflineOn: null, onlineOn: null, occurredAtLocation: null, occurredAtRegion: null, serviceMode: null, interceptionStatus: null, investigation: '原调查' },
  warnings: [{ field: 'qualityEngineerId', code: 'ENGINEER_NO_LONGER_ELIGIBLE' }], registeredByUserId: 'registrar', qualityEngineerId: 'old-qe', qualityEngineerAssignmentId: '44444444-4444-4444-8444-444444444444', qualityEngineerSource: 'MANUAL', stage: 'NEW_PRODUCT', mapping: null,
  mileageBand: null, serviceMonths: null, misTag: null, courierNumber: null, receivedOn: null, closedAt: null, closedByUserId: null, closureNote: null, createdAt: '2026-10-27T01:00:00Z', history: [],
};
const permissions = ['customer-quality:complaints:read', 'customer-quality:complaints:write', 'customer-quality:complaints:reassign'];
const saved: components['schemas']['CustomerLedgerItemDto'] = { ...record, version: 8, qualityEngineerId: candidate.userId, qualityEngineerAssignmentId: candidate.assignmentId, warnings: [] };
const defaults = (): ComponentProps<typeof CustomerLedgerHandoff> => ({ record, candidates: [candidate], permissions, organizationId: org, onDenied: vi.fn(), onSaved: vi.fn(), refreshDetail: vi.fn().mockResolvedValue({ ...record, version: 8 }) });
function BackgroundSource({ pending }: { pending: boolean }) { useNavigationBusy(pending); return null; }
function show(props = defaults(), sourcePending = false) {
  const content = (next: typeof props, pending: boolean) => <ConfigProvider><LanguageProvider><MemoryRouter><UnsavedChangesProvider><BackgroundSource pending={pending} /><CustomerLedgerHandoff {...next} /></UnsavedChangesProvider></MemoryRouter></LanguageProvider></ConfigProvider>;
  const view = render(content(props, sourcePending));
  return { ...view, update: (next: typeof props, pending = false) => view.rerender(content(next, pending)) };
}
async function open() {
  fireEvent.click(screen.getByRole('button', { name: '交接失效跟进人' }));
  const dialog = await screen.findByRole('dialog', { name: '交接失效跟进人' });
  await waitFor(() => expect(within(dialog).getByLabelText('交接原因')).toBeVisible());
  return within(dialog);
}
function fill(dialog: ReturnType<typeof within>, reason = '原任职失效，交接处理') {
  fireEvent.change(dialog.getByRole('combobox', { name: '接任质量工程师' }), { target: { value: candidate.assignmentId } });
  fireEvent.change(dialog.getByLabelText('交接原因'), { target: { value: reason } });
}
beforeEach(() => {
  useWorkTabsStore.getState().bindSession(`INTERNAL:${org}:user`);
  vi.mocked(getSession).mockReset().mockResolvedValue({ userId: 'user', organizationId: org, accountType: 'INTERNAL', landingPath: '/app/workbench' });
  vi.mocked(csrfToken).mockReset().mockResolvedValue('csrf');
  vi.mocked(apiRequest).mockReset().mockResolvedValue(saved);
});

it('only offers stale assigned handoff with every effective permission and closed-edit where required', () => {
  const props = defaults(); const view = show(props);
  expect(screen.getByRole('button', { name: '交接失效跟进人' })).toBeEnabled();
  for (const missing of permissions) {
    view.update({ ...props, permissions: permissions.filter(value => value !== missing) });
    expect(screen.queryByRole('button', { name: '交接失效跟进人' })).not.toBeInTheDocument();
  }
  for (const next of [{ ...record, warnings: [] }, { ...record, qualityEngineerId: null }, { ...record, status: 'CLOSED' as const }]) {
    view.update({ ...props, record: next });
    expect(screen.queryByRole('button', { name: '交接失效跟进人' })).not.toBeInTheDocument();
  }
  view.update({ ...props, record: { ...record, status: 'CLOSED' }, permissions: [...permissions, 'customer-quality:complaints:closed-edit'] });
  expect(screen.getByRole('button', { name: '交接失效跟进人' })).toBeEnabled();
  view.update({ ...props, readOnly: true });
  expect(screen.queryByRole('button', { name: '交接失效跟进人' })).not.toBeInTheDocument();
  expect(apiRequest).not.toHaveBeenCalled();
});

it('requires an actual assignment and bounded nonblank reason, sending only handoff fields and CAS', async () => {
  const props = defaults(); show(props); const dialog = await open();
  const save = dialog.getByRole('button', { name: '确认交接' });
  expect(save).toBeDisabled();
  expect(dialog.getByRole('option', { name: /接任工程师.*质量.*项目质量/ })).toHaveValue(candidate.assignmentId);
  fill(dialog, '   '); expect(save).toBeDisabled();
  fill(dialog, '长'.repeat(10001)); expect(save).toBeDisabled();
  fill(dialog, '含\u0000字符'); expect(save).toBeDisabled();
  fill(dialog, '  保留原始原因  '); fireEvent.click(save); fireEvent.click(save);
  await waitFor(() => expect(props.onSaved).toHaveBeenCalledWith(saved));
  expect(apiRequest).toHaveBeenCalledTimes(1);
  const [path, init, options] = vi.mocked(apiRequest).mock.calls[0]!;
  expect(path).toBe(`/api/v1/customer-quality/ledger/${record.id}/reassign`);
  expect(init).toMatchObject({ method: 'POST', headers: { 'x-csrf-token': 'csrf', 'Idempotency-Key': expect.any(String) } });
  expect(JSON.parse(String(init?.body))).toEqual({ organizationId: org, expectedVersion: 7, qualityEngineerAssignmentId: candidate.assignmentId, reason: '  保留原始原因  ' });
  expect(options).toEqual({ replayAfterReauthentication: false });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('freezes an unknown request through a CSRF failure and retries the same private body and key', async () => {
  show(); const dialog = await open(); fill(dialog);
  vi.mocked(apiRequest).mockRejectedValueOnce(new TypeError('lost response'));
  fireEvent.click(dialog.getByRole('button', { name: '确认交接' }));
  const retry = await dialog.findByRole('button', { name: '核对并重试原请求' });
  await waitFor(() => expect(dialog.getByLabelText('交接原因')).toBeDisabled());
  const first = vi.mocked(apiRequest).mock.calls[0]!;
  vi.mocked(csrfToken).mockRejectedValueOnce(new ApiError({ code: 'RATE_LIMITED', message: '' }, 429));
  fireEvent.click(retry);
  await waitFor(() => expect(csrfToken).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(retry).toBeEnabled());
  expect(apiRequest).toHaveBeenCalledTimes(1);
  expect(dialog.getByLabelText('交接原因')).toBeDisabled();
  fireEvent.click(retry);
  await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(2));
  expect(vi.mocked(apiRequest).mock.calls[1]).toEqual(first);
});

it('rechecks live source and session predicates after CSRF and aborts when its scope unmounts', async () => {
  let pending = false; let resolve!: (token: string) => void;
  const props = { ...defaults(), canDispatch: () => !pending };
  const view = show(props); const dialog = await open(); fill(dialog);
  vi.mocked(csrfToken).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  fireEvent.click(dialog.getByRole('button', { name: '确认交接' }));
  await waitFor(() => expect(csrfToken).toHaveBeenCalledTimes(1));
  pending = true; await act(async () => { resolve('late'); });
  await waitFor(() => expect(dialog.getByRole('button', { name: '确认交接' })).toBeEnabled());
  expect(apiRequest).not.toHaveBeenCalled();
  expect(dialog.getByLabelText('交接原因')).toHaveValue('原任职失效，交接处理');
  pending = false;
  vi.mocked(csrfToken).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  fireEvent.click(dialog.getByRole('button', { name: '确认交接' }));
  await waitFor(() => expect(csrfToken).toHaveBeenCalledTimes(2));
  view.unmount(); useWorkTabsStore.getState().bindSession(`INTERNAL:${org}:other`);
  await act(async () => { resolve('stale'); });
  expect(apiRequest).not.toHaveBeenCalled(); expect(props.onSaved).not.toHaveBeenCalled();
});

it.each([401, 403])('clears all modal state and reports denial on %s even without a parent unmount', async status => {
  const props = defaults(); show(props); const dialog = await open(); fill(dialog, '敏感交接原因');
  const denied = new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: '' }, status);
  vi.mocked(apiRequest).mockRejectedValueOnce(denied);
  fireEvent.click(dialog.getByRole('button', { name: '确认交接' }));
  await waitFor(() => expect(props.onDenied).toHaveBeenCalledWith(denied));
  await waitFor(() => expect(screen.queryByDisplayValue('敏感交接原因')).not.toBeInTheDocument());
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  const fresh = await open(); expect(fresh.getByLabelText('交接原因')).toHaveValue('');
  expect(fresh.getByRole('combobox')).toHaveValue('');
});

it('retains the 409 draft and requires explicit reload and changed-baseline confirmation before version advance', async () => {
  const latest = { ...record, version: 9, qualityEngineerAssignmentId: '55555555-5555-4555-8555-555555555555' };
  const props = { ...defaults(), refreshDetail: vi.fn().mockResolvedValue(latest) }; show(props);
  const dialog = await open(); fill(dialog, '冲突仍保留原因');
  vi.mocked(apiRequest).mockRejectedValueOnce(new ApiError({ code: 'CONCURRENCY_CONFLICT', message: '' }, 409));
  fireEvent.click(dialog.getByRole('button', { name: '确认交接' }));
  const reload = await dialog.findByRole('button', { name: '读取最新记录' });
  expect(props.refreshDetail).not.toHaveBeenCalled();
  expect(dialog.getByLabelText('交接原因')).toHaveValue('冲突仍保留原因');
  expect(dialog.getByRole('button', { name: '确认交接' })).toBeDisabled();
  fireEvent.click(reload);
  const confirm = await dialog.findByRole('checkbox', { name: '确认基于最新记录继续交接' });
  await waitFor(() => expect(dialog.getByText(/服务器版本：9/)).toBeVisible());
  expect(dialog.getByText(new RegExp(latest.qualityEngineerAssignmentId))).toBeVisible();
  expect(dialog.getByRole('button', { name: '确认交接' })).toBeDisabled();
  fireEvent.click(confirm); fireEvent.click(dialog.getByRole('button', { name: '确认交接' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(2));
  expect(JSON.parse(String(vi.mocked(apiRequest).mock.calls[1]?.[1]?.body))).toMatchObject({ expectedVersion: 9, reason: '冲突仍保留原因', qualityEngineerAssignmentId: candidate.assignmentId });
  expect(vi.mocked(apiRequest).mock.calls[1]?.[1]?.headers).not.toEqual(vi.mocked(apiRequest).mock.calls[0]?.[1]?.headers);
});

it('guards dirty cancel locally, clears discarded state and never cancels or waits for sibling source uploads', async () => {
  // rc-dialog uses the same test-id for both modal titles; scope by the actual title element.
  async function discardDialog() {
    const title = await screen.findByText('放弃交接修改？', { selector: '.ant-modal-title' });
    const modal = title.closest('[role="dialog"]');
    await waitFor(() => expect(modal).toBeVisible());
    return within(modal as HTMLElement);
  }
  const props = defaults(); const view = show(props); let dialog = await open(); fill(dialog);
  fireEvent.click(dialog.getByRole('button', { name: '取消' }));
  let guard = await discardDialog();
  fireEvent.click(guard.getByRole('button', { name: '继续编辑' }));
  expect(dialog.getByLabelText('交接原因')).toHaveValue('原任职失效，交接处理');
  view.update(props, true);
  fireEvent.click(dialog.getByRole('button', { name: '取消' }));
  guard = await discardDialog();
  fireEvent.click(guard.getByRole('button', { name: '放弃修改并关闭' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  view.update(props, false); dialog = await open();
  expect(dialog.getByLabelText('交接原因')).toHaveValue('');
  fireEvent.click(dialog.getByRole('button', { name: '取消' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(apiRequest).not.toHaveBeenCalled();
});

it('checks the live sourcePending prop before preparation and again after CSRF without an extra predicate', async () => {
  let resolve!: (token: string) => void;
  const props = defaults(); const view = show({ ...props, sourcePending: true });
  const dialog = await open(); fill(dialog);
  expect(dialog.getByRole('button', { name: '确认交接' })).toBeDisabled();
  fireEvent.click(dialog.getByRole('button', { name: '确认交接' }));
  expect(csrfToken).not.toHaveBeenCalled();
  view.update(props);
  vi.mocked(csrfToken).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  fireEvent.click(dialog.getByRole('button', { name: '确认交接' }));
  await waitFor(() => expect(csrfToken).toHaveBeenCalledTimes(1));
  view.update({ ...props, sourcePending: true });
  await act(async () => { resolve('late'); });
  expect(apiRequest).not.toHaveBeenCalled();
  expect(dialog.getByLabelText('交接原因')).toHaveValue('原任职失效，交接处理');
  view.update(props);
  fireEvent.click(dialog.getByRole('button', { name: '确认交接' }));
  await waitFor(() => expect(props.onSaved).toHaveBeenCalledWith(saved));
});

it.each([401, 403])('clears the private draft when explicit conflict reload is denied with %s', async status => {
  const denied = new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: '' }, status);
  const props = { ...defaults(), refreshDetail: vi.fn().mockRejectedValue(denied) }; show(props);
  const dialog = await open(); fill(dialog, '读取被拒绝时清除');
  vi.mocked(apiRequest).mockRejectedValueOnce(new ApiError({ code: 'CONCURRENCY_CONFLICT', message: '' }, 409));
  fireEvent.click(dialog.getByRole('button', { name: '确认交接' }));
  fireEvent.click(await dialog.findByRole('button', { name: '读取最新记录' }));
  await waitFor(() => expect(props.onDenied).toHaveBeenCalledWith(denied));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  const fresh = await open();
  expect(fresh.getByLabelText('交接原因')).toHaveValue('');
  expect(fresh.getByRole('combobox')).toHaveValue('');
});
