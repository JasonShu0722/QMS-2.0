import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { registerReauthentication } from '../../api/client';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import type { AdminOrganization } from '../admin/admin';
import { AdministrativeProblemReconfiguration, isCompleteResponsibilityRecoveryReceipt } from './AdministrativeProblemReconfiguration';

type Internal = components['schemas']['InternalEightDAdministrativePendingItemDto'];
type Supplier = components['schemas']['SupplierEightDAdministrativeItemDto'];
type Assignment = components['schemas']['AdministrativeProblemAssignmentDto'];
const org: AdminOrganization = { id: 'home', name: '管理公司', code: 'HOME', type: 'INTERNAL', permissions: ['organization:reconfigure'] };
const internal: Internal = { problemId: 'problem', originalOrganizationId: 'original', domainCode: 'process-quality', reportNumber: '8D-0031', version: 7, problemVersion: 4, professionalUserId: 'old-professional', ownerUserId: 'old-owner', responsibleSectionDepartmentId: 'section', status: 'PROCESSING', requiredConfiguration: ['professionalAssignmentId', 'ownerAssignmentId'] };
const supplier: Supplier = { supplierProblemId: 'supplier-problem', problemId: 'problem', originalOrganizationId: 'original', reportNumber: 'S8D-0031', version: 8, sqeUserId: 'old-sqe', sqeAssignmentId: 'existing-sqe-assignment', responsibleSectionDepartmentId: 'section', internalResponderId: 'old-responder', status: 'PROCESSING', requiredConfiguration: ['sqeAssignmentId', 'internalResponderAssignmentId'] };
const candidate = (duty: string): Assignment => ({ assignmentId: `${duty}-assignment`, userId: `${duty}-user`, username: duty, fullName: `${duty}姓名`, positionName: '质量岗位', departmentId: 'section', departmentName: '质量科' });
type Call = { path: string; init?: RequestInit };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function server(item: Internal | Supplier = internal, intercept?: (call: Call) => Response | Promise<Response> | undefined) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { path: String(input), init }; calls.push(call);
    const response = intercept?.(call); if (response) return response;
    if (call.path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (init?.method === 'POST') return json({ ...item, ...('supplierProblemId' in item ? { sqeAssignmentId: JSON.parse(init.body as string).sqeAssignmentId } : {}), version: item.version + 1, problemVersion: 5 });
    const query = new URL(call.path, 'http://localhost').searchParams;
    if (call.path.includes('/assignments?')) return json({ items: [candidate(query.get('duty')!)], total: 1 });
    if (call.path.includes('/problem-reconfiguration/')) return json({ items: [item], pageSize: 20, offset: Number(query.get('offset')), nextOffset: null });
    throw new Error(`Unexpected request ${call.path}`);
  }));
  return calls;
}
function scene(organization = org, callbacks = {}) {
  return <MemoryRouter><UnsavedChangesProvider><AdministrativeProblemReconfiguration organization={organization} {...callbacks} /></UnsavedChangesProvider></MemoryRouter>;
}

it('keeps the recovery section heading accessible while retaining the visible report heading and scope', async () => {
  server();
  render(scene());
  await edit();
  const heading = screen.getByRole('heading', { name: '问题责任恢复', level: 5 });
  expect(heading).toHaveClass('sr-only');
  expect(heading.parentElement).toBe(screen.getByRole('region', { name: '问题责任恢复' }));
  expect(screen.getByRole('heading', { name: `恢复责任 · ${internal.reportNumber}`, level: 5 })).not.toHaveClass('sr-only');
  expect(screen.getByText('仅恢复失效的当前责任，不代替业务人员审批；原业务归属和已批准历史保持不变。')).toBeVisible();
  expect(screen.getByText('只选择当前失效职责的有效任职；仍有效的责任不覆盖，不授予额外业务权限。')).toBeVisible();
});

let editor: HTMLElement | undefined;
async function choose(label: string, text: string, keyboard = false) {
  const field = label === '问题领域' || !editor?.isConnected ? document.body : within(editor).getByText(label, { selector: 'label' }).closest('.ant-form-item');
  if (!(field instanceof HTMLElement)) throw new Error(`Missing field for ${label}`);
  const input = within(field).getByLabelText(label, { selector: 'input' });
  if (!(input instanceof HTMLInputElement)) throw new Error(`Missing input for ${label}`);
  if (keyboard) {
    act(() => input.focus());
    fireEvent.keyDown(input, { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40 });
    fireEvent.keyUp(input, { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40 });
  }
  else await userEvent.click(input);
  const popup = await waitFor(() => {
    const element = document.getElementById(input.getAttribute('aria-controls') ?? '')?.closest('.ant-select-dropdown');
    if (!(element instanceof HTMLElement)) throw new Error(`Missing popup for ${label}`);
    return element;
  });
  const option = await within(popup).findByText(text, { selector: '.ant-select-item-option-content' });
  await waitFor(() => {
    expect(option).toBeVisible(); expect(window.getComputedStyle(option).pointerEvents).not.toBe('none');
  }, { container: popup });
  if (keyboard) {
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 });
    fireEvent.keyUp(input, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 });
  }
  else await userEvent.click(option);
  const control = input.closest('.ant-select');
  if (!(control instanceof HTMLElement)) throw new Error('Assignment control is not an HTML element');
  await waitFor(() => expect(input).toHaveAttribute('aria-expanded', 'false'), { container: control });
}
function button(name: string) {
  const controls = ['确认恢复责任', '重试原责任恢复请求', '重新读取并重选责任', '关闭编辑', '重试专业责任任职'];
  const query = controls.includes(name) && editor?.isConnected ? within(editor) : screen;
  const element = query.getByText(name, { selector: 'button > span' }).closest('button');
  if (!(element instanceof HTMLButtonElement)) throw new Error(`Missing button ${name}`);
  return element;
}
async function edit(report = '8D-0031') {
  fireEvent.click(await screen.findByLabelText(`恢复责任 · ${report}`, { selector: 'button' }));
  editor = screen.getByLabelText(`恢复责任 · ${report}`, { selector: 'section' });
}
const label = (duty: string) => `${duty}姓名 · 质量科 · 质量岗位 · ${duty}`;
async function fillInternal() { await choose('专业责任任职', label('PROFESSIONAL')); await choose('负责人任职', label('OWNER')); }
async function save() { const element = button('确认恢复责任'); expect(element).toBeVisible(); expect(element).toBeEnabled(); fireEvent.click(element); }
const posts = (calls: Call[]) => calls.filter(call => call.init?.method === 'POST');
beforeEach(() => { editor = undefined; localStorage.clear(); sessionStorage.clear(); useWorkTabsStore.getState().bindSession('INTERNAL:home:actor'); });
afterEach(() => { vi.unstubAllGlobals(); act(() => useWorkTabsStore.getState().reset()); });

it.each([['PROCESS', 'process-quality'], ['CUSTOMER', 'customer-quality'], ['NEW_PRODUCT', 'new-product-quality']])('submits generated internal assignment projection for %s, not user IDs', async (domain, domainCode) => {
  const calls = server({ ...internal, domainCode }); const onChanged = vi.fn(); render(scene(org, { onChanged }));
  if (domain !== 'PROCESS') await choose('问题领域', domain === 'CUSTOMER' ? '客户质量' : '新产品质量');
  await edit(); expect(screen.getByText(/不代替业务人员审批/)).toBeVisible(); expect(screen.getByText(/已批准历史保持不变/)).toBeVisible();
  expect(screen.getAllByText('original').length).toBeGreaterThan(0);
  await fillInternal(); await save(); await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(screen.getByText(/责任恢复成功/)).toBeVisible(); expect(screen.queryByText(/响应无法核对/)).not.toBeInTheDocument();
  expect(posts(calls)[0].path).toBe(`/api/v1/admin/problem-reconfiguration/${domain}/problem`);
  expect(JSON.parse(posts(calls)[0].init!.body as string)).toEqual({ expectedVersion: 7, professionalAssignmentId: 'PROFESSIONAL-assignment', ownerAssignmentId: 'OWNER-assignment' });
  expect(calls.filter(call => call.path.includes('/assignments?')).every(call => new URL(call.path, 'http://localhost').searchParams.get('organizationId') === 'original')).toBe(true);
});

it.each([[['sqeAssignmentId', 'internalResponderAssignmentId']], [['internalResponderAssignmentId']]])('restores only invalid supplier duties %j and preserves the valid SQE assignment', async required => {
  const calls = server({ ...supplier, requiredConfiguration: required }); render(scene()); await choose('问题领域', '供应商质量'); await edit('S8D-0031');
  if (required.includes('sqeAssignmentId')) await choose('SQE 任职', label('PROFESSIONAL'));
  else expect(screen.queryByLabelText('SQE 任职')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('负责人任职')).not.toBeInTheDocument();
  await choose('内部答复人任职', label('RESPONDER')); await save(); await screen.findByText(/责任恢复成功/);
  expect(posts(calls)[0].path).toBe('/api/v1/admin/problem-reconfiguration/SUPPLIER/supplier-problem');
  expect(JSON.parse(posts(calls)[0].init!.body as string)).toEqual({ expectedVersion: 8, sqeAssignmentId: required.includes('sqeAssignmentId') ? 'PROFESSIONAL-assignment' : supplier.sqeAssignmentId, internalResponderAssignmentId: 'RESPONDER-assignment' });
});

it('does not render or overwrite valid internal duties', async () => {
  const calls = server({ ...internal, requiredConfiguration: ['ownerAssignmentId'] }); render(scene()); await edit();
  expect(screen.queryByLabelText('专业责任任职')).not.toBeInTheDocument(); await choose('负责人任职', label('OWNER')); await save();
  await screen.findByText(/责任恢复成功/); expect(JSON.parse(posts(calls)[0].init!.body as string)).toEqual({ expectedVersion: 7, ownerAssignmentId: 'OWNER-assignment' });
});

it('uses scan nextOffset even for an empty window, without total or per-record reads', async () => {
  const calls = server(internal, call => {
    if (call.path.includes('/PROCESS?')) { const offset = new URL(call.path, 'http://localhost').searchParams.get('offset'); return json({ items: offset === '0' ? [] : [internal], offset: Number(offset), pageSize: 20, nextOffset: offset === '0' ? 93 : null }); }
  });
  render(scene()); expect(await screen.findByText(/当前扫描窗口无待配置问题/)).toBeVisible();
  expect(calls).toHaveLength(1); fireEvent.click(button('下一扫描页')); await edit();
  expect(calls.some(call => call.path.includes('/PROCESS?offset=93&pageSize=20'))).toBe(true);
  expect(button('下一扫描页')).toBeDisabled();
});

it.each([{ ...org, permissions: ['organization:read'] }, { ...org, type: 'SUPPLIER' as const }])('gates exact permission and internal context before any read', async organization => {
  const calls = server(); render(scene(organization)); expect(screen.getByText(/无责任恢复管理权限/)).toBeVisible(); expect(calls).toHaveLength(0);
});

it('retains the frozen path/body/key across unknown writes and retry errors', async () => {
  let count = 0; const calls = server(internal, call => {
    if (call.init?.method === 'POST' && ++count === 1) return Promise.reject(new TypeError('lost'));
    if (call.init?.method === 'POST' && count === 2) return json({ code: 'RATE_LIMITED', message: 'later' }, 429);
  });
  render(scene()); await edit(); await fillInternal(); await save(); await screen.findByText(/结果尚未确认/);
  expect(screen.getByLabelText('专业责任任职')).toBeDisabled(); expect(screen.getByLabelText('问题领域')).toBeDisabled();
  for (const total of [2, 3]) { const retryButton = button('重试原责任恢复请求'); await waitFor(() => expect(retryButton).toBeEnabled()); fireEvent.click(retryButton); await waitFor(() => expect(posts(calls)).toHaveLength(total)); }
  await screen.findByText(/责任恢复成功/); expect(new Set(posts(calls).map(call => call.init!.body)).size).toBe(1);
  expect(new Set(posts(calls).map(call => (call.init!.headers as Record<string, string>)['Idempotency-Key'])).size).toBe(1);
});

it('retains the draft on 409 but requires explicit reload and reselects a fresh baseline', async () => {
  let version = 7; const calls = server(internal, call => {
    if (call.init?.method === 'POST' && version === 7) { version = 9; return json({ code: 'CONFLICT', message: 'conflict' }, 409); }
    if (call.init?.method === 'POST') return json({ ...internal, version: version + 1, problemVersion: 5 });
    if (call.path.includes('/PROCESS?')) return json({ items: [{ ...internal, version }], pageSize: 20, offset: 0, nextOffset: null });
  });
  render(scene()); await edit(); await choose('专业责任任职', label('PROFESSIONAL'), true); await choose('负责人任职', label('OWNER'), true); await save(); await screen.findByText(/版本已变化/);
  expect(button('确认恢复责任')).toBeDisabled();
  expect(within(screen.getByLabelText('负责人任职').closest('.ant-select')!).getByTitle(label('OWNER'))).toBeVisible();
  fireEvent.click(button('重新读取并重选责任'));
  const abandon = (await screen.findByText('放弃修改', { selector: 'button > span' })).closest('button')!;
  const dialog = abandon.closest<HTMLElement>('[role="dialog"]')!;
  expect(dialog).not.toBeNull(); await waitFor(() => expect(dialog).toBeVisible(), { container: dialog }); await userEvent.click(abandon);
  await waitFor(() => expect(screen.queryByLabelText('负责人任职')).not.toBeInTheDocument()); await edit();
  expect(button('确认恢复责任')).toBeDisabled();
  await choose('专业责任任职', label('PROFESSIONAL'), true); await choose('负责人任职', label('OWNER'), true); await save();
  await screen.findByText(/责任恢复成功/); expect(posts(calls)).toHaveLength(2); expect(JSON.parse(posts(calls)[1].init!.body as string).expectedVersion).toBe(9);
});

it.each([401, 403])('clears sensitive state and calls the parent on denial %s', async status => {
  const calls = server(internal, call => call.init?.method === 'POST' ? json({ code: 'DENIED', message: 'denied' }, status) : undefined);
  const onDenied = vi.fn(); render(scene(org, { onDenied })); await edit(); await fillInternal(); await save();
  await waitFor(() => expect(onDenied).toHaveBeenCalledWith(expect.objectContaining({ status })));
  expect(screen.queryByText('8D-0031')).not.toBeInTheDocument(); expect(screen.queryByLabelText('负责人任职')).not.toBeInTheDocument(); expect(posts(calls)).toHaveLength(1);
});

it('does not auto-replay after reauthentication', async () => {
  let count = 0; const calls = server(internal, call => call.init?.method === 'POST' && ++count === 1 ? json({ code: 'AUTH_REAUTHENTICATION_REQUIRED', message: 'reauth' }, 403) : undefined);
  const reauth = vi.fn(async () => {}); const unregister = registerReauthentication(reauth);
  try { render(scene()); await edit(); await fillInternal(); await save(); await waitFor(() => expect(reauth).toHaveBeenCalledTimes(1));
    await screen.findByText(/结果尚未确认/); expect(posts(calls)).toHaveLength(1); fireEvent.click(button('重试原责任恢复请求')); await screen.findByText(/责任恢复成功/);
    expect(posts(calls)).toHaveLength(2);
  } finally { unregister(); }
});

it('invalidates an ABA principal change synchronously during CSRF wait', async () => {
  let release!: (response: Response) => void; const calls = server(internal, call => call.path.endsWith('/csrf') ? new Promise(resolve => { release = resolve; }) : undefined);
  const onChanged = vi.fn(); render(scene(org, { onChanged })); await edit(); await fillInternal(); await save(); await waitFor(() => expect(release).toBeTypeOf('function'));
  act(() => { useWorkTabsStore.getState().bindSession('INTERNAL:other:actor'); useWorkTabsStore.getState().bindSession('INTERNAL:home:actor'); });
  await act(async () => release(json({ csrfToken: 'late' }))); expect(posts(calls)).toHaveLength(0); expect(onChanged).not.toHaveBeenCalled(); expect(screen.queryByLabelText('负责人任职')).not.toBeInTheDocument();
});

it('guards unsaved record/domain changes and keyboard submit, and blocks duplicate writes while busy', async () => {
  let release!: (response: Response) => void; const calls = server(internal, call => call.init?.method === 'POST' ? new Promise(resolve => { release = resolve; }) : undefined);
  render(scene()); await edit(); await fillInternal(); await choose('问题领域', '客户质量');
  const resume = (await screen.findByText('继续编辑', { selector: 'button > span' })).closest('button')!;
  const dialog = resume.closest<HTMLElement>('[role="dialog"]')!;
  expect(dialog).not.toBeNull(); await waitFor(() => expect(dialog).toBeVisible(), { container: dialog }); await userEvent.click(resume);
  expect(screen.getByLabelText('负责人任职')).toBeInTheDocument();
  fireEvent.submit(button('确认恢复责任').closest('form')!);
  await waitFor(() => expect(posts(calls)).toHaveLength(1)); expect(screen.getByLabelText('问题领域')).toBeDisabled();
  fireEvent.submit(button('确认恢复责任').closest('form')!); expect(posts(calls)).toHaveLength(1);
  await act(async () => release(json({ ...internal, version: 8 })));
});

it('bounds candidate paging and searches actual assignments without scanning all departments', async () => {
  const calls = server(internal, call => {
    if (!call.path.includes('/assignments?')) return;
    const query = new URL(call.path, 'http://localhost').searchParams;
    return json({ items: [candidate(query.get('offset') === '0' ? query.get('duty')! : 'NEXT')], total: 41 });
  });
  render(scene()); await edit();
  await waitFor(() => expect(screen.getByLabelText('专业责任任职下一页')).toBeEnabled());
  fireEvent.click(screen.getByLabelText('专业责任任职下一页'));
  await waitFor(() => expect(calls.some(call => call.path.includes('duty=PROFESSIONAL') && call.path.includes('offset=20'))).toBe(true));
  const input = screen.getByLabelText('专业责任任职'); fireEvent.mouseDown(input); fireEvent.change(input, { target: { value: '张' } });
  await waitFor(() => expect(calls.some(call => { const query = new URL(call.path, 'http://localhost').searchParams; return query.get('search') === '张' && query.get('offset') === '0'; })).toBe(true));
  expect(calls.every(call => !call.path.includes('/departments'))).toBe(true);
});

it.each(['list', 'candidate'])('clears sensitive content after denied %s reads', async stage => {
  const onDenied = vi.fn(); server(internal, call => ((stage === 'list' && call.path.includes('/PROCESS?')) || (stage === 'candidate' && call.path.includes('/assignments?'))) ? json({ code: 'DENIED', message: 'denied' }, 403) : undefined);
  render(scene(org, { onDenied })); if (stage === 'candidate') await edit();
  await waitFor(() => expect(onDenied).toHaveBeenCalledTimes(1));
  expect(screen.queryByText('8D-0031')).not.toBeInTheDocument(); expect(screen.queryByLabelText('负责人任职')).not.toBeInTheDocument();
});

it('discards old organization reads and old POST success callbacks', async () => {
  let release!: (response: Response) => void; server(internal, call => call.init?.method === 'POST' ? new Promise(resolve => { release = resolve; }) : undefined);
  const onChanged = vi.fn(); const view = render(scene(org, { onChanged })); await edit(); await fillInternal(); await save(); await waitFor(() => expect(release).toBeTypeOf('function'));
  view.rerender(scene({ ...org, id: 'other' }, { onChanged }));
  await act(async () => release(json({ ...internal, version: 8 })));
  expect(onChanged).not.toHaveBeenCalled(); expect(screen.queryByText(/责任恢复成功/)).not.toBeInTheDocument();
});

it('rejects a successful receipt from another historical scope instead of replaying with a new key', async () => {
  const calls = server(internal, call => call.init?.method === 'POST' ? json({ ...internal, originalOrganizationId: 'foreign', version: 8 }) : undefined);
  const onChanged = vi.fn(); render(scene(org, { onChanged })); await edit(); await fillInternal(); await save();
  await screen.findByText(/响应无法核对/); expect(onChanged).not.toHaveBeenCalled(); expect(posts(calls)).toHaveLength(1);
  expect(screen.queryByRole('button', { name: '重试原责任恢复请求' })).not.toBeInTheDocument(); expect(button('确认恢复责任')).toBeDisabled();
});

it.each([
  ['professionalUserId', undefined], ['professionalUserId', null], ['professionalUserId', ' '],
  ['ownerUserId', undefined], ['ownerUserId', null], ['ownerUserId', 42],
  ['responsibleSectionDepartmentId', undefined], ['responsibleSectionDepartmentId', ''],
  ['problemVersion', undefined], ['problemVersion', '5'], ['problemVersion', null],
  ['reportNumber', undefined], ['reportNumber', 42], ['reportNumber', ' '],
  ['status', undefined], ['status', 'APPROVED'],
] as const)('rejects incomplete internal receipt %s=%s', (field, value) => {
  const receipt = { ...internal, version: 8, problemVersion: 5, [field]: value };
  expect(isCompleteResponsibilityRecoveryReceipt(receipt, internal, { expectedVersion: 7, professionalAssignmentId: 'PROFESSIONAL-assignment', ownerAssignmentId: 'OWNER-assignment' }, 'PROCESS')).toBe(false);
});

it('retains an incomplete internal receipt draft for explicit reconciliation without a fresh-key retry', async () => {
  const calls = server(internal, call => call.init?.method === 'POST' ? json({ problemId: internal.problemId, originalOrganizationId: internal.originalOrganizationId, domainCode: internal.domainCode, version: 8 }, 201) : undefined);
  const onChanged = vi.fn(); render(scene(org, { onChanged })); await edit(); await fillInternal(); await save();
  expect(await screen.findByText(/响应无法核对/)).toBeVisible(); expect(onChanged).not.toHaveBeenCalled();
  expect(screen.queryByText(/责任恢复成功/)).not.toBeInTheDocument();
  expect(within(screen.getByLabelText('负责人任职').closest('.ant-select')!).getByTitle(label('OWNER'))).toBeVisible();
  expect(button('确认恢复责任')).toBeDisabled(); expect(button('重新读取并重选责任')).toBeEnabled();
  expect(screen.queryByText('重试原责任恢复请求')).not.toBeInTheDocument();
  fireEvent.submit(button('确认恢复责任').closest('form')!);
  expect(posts(calls)).toHaveLength(1); expect(calls.filter(call => call.path.includes('/PROCESS?'))).toHaveLength(1);
});

it.each([
  ['sqeUserId', undefined], ['sqeUserId', null], ['sqeUserId', ' '],
  ['sqeAssignmentId', undefined], ['sqeAssignmentId', 'different-assignment'],
  ['responsibleSectionDepartmentId', undefined], ['responsibleSectionDepartmentId', 42],
  ['internalResponderId', undefined], ['internalResponderId', null], ['internalResponderId', ''],
  ['problemVersion', undefined], ['problemVersion', '5'],
  ['reportNumber', undefined], ['reportNumber', ''],
  ['status', undefined], ['status', 42],
] as const)('rejects incomplete supplier receipt %s=%s', (field, value) => {
  const receipt = { ...supplier, version: 9, problemVersion: 5, sqeAssignmentId: 'PROFESSIONAL-assignment', [field]: value };
  expect(isCompleteResponsibilityRecoveryReceipt(receipt, supplier, { expectedVersion: 8, sqeAssignmentId: 'PROFESSIONAL-assignment', internalResponderAssignmentId: 'RESPONDER-assignment' }, 'SUPPLIER')).toBe(false);
});

it('retains an incomplete supplier receipt draft for explicit reconciliation without a fresh-key retry', async () => {
  const calls = server(supplier, call => call.init?.method === 'POST' ? json({ supplierProblemId: supplier.supplierProblemId, problemId: supplier.problemId, originalOrganizationId: supplier.originalOrganizationId, version: 9 }, 201) : undefined);
  const onChanged = vi.fn(); render(scene(org, { onChanged })); await choose('问题领域', '供应商质量'); await edit('S8D-0031');
  await choose('SQE 任职', label('PROFESSIONAL')); await choose('内部答复人任职', label('RESPONDER')); await save();
  expect(await screen.findByText(/响应无法核对/)).toBeVisible(); expect(onChanged).not.toHaveBeenCalled();
  expect(screen.queryByText(/责任恢复成功/)).not.toBeInTheDocument();
  expect(within(screen.getByLabelText('内部答复人任职').closest('.ant-select')!).getByTitle(label('RESPONDER'))).toBeVisible();
  expect(button('确认恢复责任')).toBeDisabled(); expect(button('重新读取并重选责任')).toBeEnabled();
  expect(screen.queryByText('重试原责任恢复请求')).not.toBeInTheDocument();
  fireEvent.submit(button('确认恢复责任').closest('form')!);
  expect(posts(calls)).toHaveLength(1); expect(calls.filter(call => call.path.includes('/SUPPLIER?'))).toHaveLength(1);
});

it('accepts a nullable internal owner when only the professional duty is recovered', async () => {
  const item = { ...internal, ownerUserId: null, requiredConfiguration: ['professionalAssignmentId'] as Internal['requiredConfiguration'] };
  const calls = server(item); const onChanged = vi.fn(); render(scene(org, { onChanged })); await edit();
  await choose('专业责任任职', label('PROFESSIONAL')); await save();
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1)); expect(screen.getByText(/责任恢复成功/)).toBeVisible(); expect(posts(calls)).toHaveLength(1);
});

it('accepts a nullable external supplier responder when only the SQE duty is recovered', async () => {
  const calls = server({ ...supplier, internalResponderId: null, requiredConfiguration: ['sqeAssignmentId'] });
  const onChanged = vi.fn(); render(scene(org, { onChanged })); await choose('问题领域', '供应商质量'); await edit('S8D-0031');
  await choose('SQE 任职', label('PROFESSIONAL')); await save();
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1)); expect(screen.getByText(/责任恢复成功/)).toBeVisible(); expect(posts(calls)).toHaveLength(1);
});

it('retains the original body and helper key after a CSRF-stage failure and does not create a replacement write', async () => {
  let csrf = 0; const calls = server(internal, call => {
    if (call.path.endsWith('/csrf') && ++csrf === 1) return Promise.reject(new TypeError('csrf lost'));
  });
  render(scene()); await edit(); await fillInternal(); await save(); await screen.findByText(/结果尚未确认/);
  expect(posts(calls)).toHaveLength(0); expect(button('关闭编辑')).toBeDisabled();
  expect(button('刷新问题责任')).toBeDisabled();
  fireEvent.click(button('重试原责任恢复请求')); await screen.findByText(/责任恢复成功/);
  expect(posts(calls)).toHaveLength(1); expect(JSON.parse(posts(calls)[0].init!.body as string)).toEqual({ expectedVersion: 7, professionalAssignmentId: 'PROFESSIONAL-assignment', ownerAssignmentId: 'OWNER-assignment' });
});

it('exposes candidate read failure and a bounded retry without a UUID fallback', async () => {
  let failed = false; const calls = server(internal, call => {
    if (call.path.includes('/assignments?') && call.path.includes('duty=PROFESSIONAL') && !failed) { failed = true; return Promise.reject(new TypeError('candidate read lost')); }
  });
  render(scene()); await edit(); const retry = await waitFor(() => button('重试专业责任任职'));
  expect(retry).toHaveAccessibleName('重试专业责任任职');
  expect(button('确认恢复责任')).toBeDisabled(); fireEvent.click(retry);
  await fillInternal(); await save(); await screen.findByText(/责任恢复成功/); expect(posts(calls)).toHaveLength(1);
});

it('fails closed for unsupported supplier requirements', async () => {
  server({ ...supplier, requiredConfiguration: ['ownerAssignmentId'] }); render(scene()); await choose('问题领域', '供应商质量'); await edit('S8D-0031');
  expect(screen.getByText(/配置要求暂不支持/)).toBeVisible(); expect(button('确认恢复责任')).toBeDisabled();
  expect(screen.queryByLabelText('负责人任职')).not.toBeInTheDocument();
});

it('does not backfill a previous domain when a late list read ignores abort', async () => {
  let release!: (response: Response) => void; server(internal, call => call.path.includes('/PROCESS?') ? new Promise(resolve => { release = resolve; }) : undefined);
  render(scene()); await waitFor(() => expect(release).toBeTypeOf('function')); await choose('问题领域', '客户质量');
  await screen.findByText('8D-0031');
  await act(async () => release(json({ items: [{ ...internal, reportNumber: 'OLD-PROCESS' }], offset: 0, pageSize: 20, nextOffset: null })));
  expect(screen.queryByText('OLD-PROCESS')).not.toBeInTheDocument(); expect(screen.getByText('8D-0031')).toBeVisible();
});
