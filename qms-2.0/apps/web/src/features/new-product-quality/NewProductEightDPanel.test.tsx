import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiRequest, csrfToken, getSession, ApiError } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { NewProductEightDPanel } from './NewProductEightDPanel';

vi.mock('../../api/client', async original => ({ ...await original<typeof import('../../api/client')>(), apiRequest: vi.fn(), csrfToken: vi.fn(), getSession: vi.fn() }));
const org = '22222222-2222-4222-8222-222222222222';
const selection = { id: 'selection-id', organization_id: org, project_id: 'project', defect_id: 'process-defect-id', source_version: 7, source_snapshot: { description: '新品同源事实' }, selection_reason: null, selected_by_id: 'other-qe', selected_at: '2026-10-27T00:00:00Z' };
const permissions = ['new-product-quality:projects:read', 'new-product-quality:projects:write', 'process-quality:defects:read', 'new-product-quality:issues:issue'];
beforeEach(() => {
  vi.resetAllMocks(); useWorkTabsStore.getState().reset(); useWorkTabsStore.getState().bindSession(`INTERNAL:${org}:issuer`);
  vi.mocked(csrfToken).mockResolvedValue('csrf');
  vi.mocked(getSession).mockResolvedValue({ userId: 'issuer', organizationId: org, accountType: 'INTERNAL', landingPath: '/app/workbench' });
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (path.includes('/my-permissions')) return { permissions };
    if (path.includes('/defect-selections')) return init?.method ? selection : [selection];
    if (path.includes('/defects?')) return { items: [{ id: 'process-new', version: 2, description: '候选过程事实' }], total: 1 };
    if (path.includes('/sources/preview')) return [{ sourceId: selection.id, relatedProblems: [], hasHiddenRelations: false, relatedSetToken: 'token' }];
    if (path.includes('/assignment-options')) return { departments: [], users: [], departmentTotal: 0, userTotal: 0 };
    return [];
  });
});
function mount(active = true, onDenied = vi.fn(), projectContext?: { code: string; product_code: string }) {
  return render(<MemoryRouter><LanguageProvider><UnsavedChangesProvider><NewProductEightDPanel projectId="project" organizationId={org} projectContext={projectContext} active={active} onDenied={onDenied} /></UnsavedChangesProvider></LanguageProvider></MemoryRouter>);
}
it('opens supplier copy for an immutable selection with copy-only access without enabling new-product issue', async () => {
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (path.includes('/my-permissions')) return { permissions: ['new-product-quality:projects:read', 'process-quality:defects:read', 'supplier-quality:issues:copy'] };
    if (path.includes('/reference-options')) return { items: [{ id: org, label: '复制目标档案' }], total: 1 };
    if (path.endsWith('/source-copies/preview')) return { token: org, expiresAt: '2099-01-01T00:00:00Z', facts: [] };
    return read(path, init);
  });
  mount();
  const copy = await screen.findByRole('button', { name: '复制为供应商草稿' });
  expect(copy).toBeDisabled();
  fireEvent.click(await screen.findByLabelText('选择新品来源 selection-id'));
  await waitFor(() => expect(copy).toBeEnabled());
  fireEvent.click(copy);
  await waitFor(() => expect(screen.getByRole('dialog', { name: '受控复制为供应商草稿' })).toBeVisible());
  expect(screen.queryByRole('button', { name: '发起新品8D' })).not.toBeInTheDocument();
  fireEvent.mouseDown(screen.getByLabelText('目标供应商档案'));
  fireEvent.click(await screen.findByText('复制目标档案', { selector: '.ant-select-item-option-content' }));
  fireEvent.click(screen.getByRole('button', { name: '读取受控预览' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/supplier-quality/source-copies/preview', expect.objectContaining({ body: JSON.stringify({ organizationId: org, supplierProfileId: org, sources: [{ kind: 'NEW_PRODUCT_SELECTION', sourceId: selection.id, sourceVersion: selection.source_version }] }) }), { replayAfterReauthentication: false }));
  expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path.endsWith('/source-copies/drafts'))).toBe(false);
});

it('hides supplier copy without its real copy permission and in an archived project', async () => {
  mount(false); await screen.findByText('新品同源事实');
  expect(screen.queryByRole('button', { name: '复制为供应商草稿' })).not.toBeInTheDocument();
});
it('shows project and component clues separately from mapping eligibility, with explicit ledger filters', async () => {
  mount(true, vi.fn(), { code: 'NP-042', product_code: 'COMP-042' });
  const trigger = await screen.findByText('纳入过程事实', { selector: 'button span' });
  await act(async () => { fireEvent.click(trigger); });
  await waitFor(() => expect(screen.getByText(/NP-042.*COMP-042/)).toBeVisible());
  expect(screen.getByLabelText('候选项目代码')).toHaveValue('NP-042');
  expect(screen.getByLabelText('候选组件号')).toHaveValue('');
  await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path.includes('/defects?') && new URL(path, 'https://qms.invalid').searchParams.get('projectCode') === 'NP-042')).toBe(true));
  expect(screen.getByText(/台账字段筛选.*不代表.*映射/)).toBeVisible();
  fireEvent.change(screen.getByLabelText('候选组件号'), { target: { value: 'COMP-042' } });
  fireEvent.click(screen.getByText('筛选候选', { selector: 'button span' }));
  await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path.includes('/defects?') && new URL(path, 'https://qms.invalid').searchParams.get('productCode') === 'COMP-042')).toBe(true));
});
it('uses immutable selection id/version rather than its process defect identity to preview a new formal 8D', async () => {
  mount(); fireEvent.click(await screen.findByRole('checkbox', { name: '选择新品来源 selection-id' }));
  fireEvent.click(screen.getByRole('button', { name: '发起新品8D' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/new-product-quality/eight-d/sources/preview', expect.objectContaining({ body: JSON.stringify({ organizationId: org, sources: [{ sourceId: 'selection-id', expectedVersion: 7 }] }) })));
  expect(vi.mocked(apiRequest).mock.calls.filter(([path]) => path.includes('/sources/preview')).map(([, init]) => init?.body).join()).not.toContain('process-defect-id');
});
it('creates an explicit project inclusion through the real selection API before allowing formal issue', async () => {
  mount(); fireEvent.click(await screen.findByText('纳入过程事实', { selector: 'button span' }));
  fireEvent.change(screen.getByLabelText('纳入依据（可空）'), { target: { value: '发生时处于新品阶段，已核对映射' } });
  fireEvent.click(await screen.findByLabelText('纳入 候选过程事实'));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`/api/v1/new-product-quality/projects/project/defect-selections`, expect.objectContaining({ method: 'POST', body: JSON.stringify({ organizationId: org, defectId: 'process-new', expectedVersion: 2, reason: '发生时处于新品阶段，已核对映射' }) }), { replayAfterReauthentication: false }));
});
it('retains archived project selections as read-only history', async () => {
  mount(false); expect(await screen.findByText('新品同源事实')).toBeVisible();
  expect(screen.queryByRole('button', { name: '纳入过程事实' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '发起新品8D' })).not.toBeInTheDocument();
});
it('clears selected private facts and propagates access loss', async () => {
  const onDenied = vi.fn(); const read = vi.mocked(apiRequest).getMockImplementation()!;
  mount(true, onDenied); fireEvent.click(await screen.findByRole('checkbox', { name: '选择新品来源 selection-id' }));
  vi.mocked(apiRequest).mockImplementation(async (path, init) => { if (path.includes('/defect-selections')) throw new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: '' }, 403); return read(path, init); });
  fireEvent.click(screen.getByRole('button', { name: '刷新新品来源' }));
  await waitFor(() => expect(onDenied).toHaveBeenCalled());
  expect(screen.queryByText('新品同源事实')).not.toBeInTheDocument();
});

it('paginates immutable selections while retaining the selected source IDs', async () => {
  const rows = Array.from({ length: 21 }, (_, index) => ({ ...selection, id: `selection-${index}`, source_snapshot: { description: `来源 ${index}` } }));
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => path.includes('/defect-selections') ? rows : path.includes('/sources/preview') ? ['selection-0', 'selection-20'].map(sourceId => ({ sourceId, relatedProblems: [], hasHiddenRelations: false, relatedSetToken: sourceId })) : read(path, init));
  mount(); fireEvent.click(await screen.findByLabelText('选择新品来源 selection-0'));
  expect(screen.queryByLabelText('选择新品来源 selection-20')).not.toBeInTheDocument();
  fireEvent.click(screen.getByTitle('2'));
  fireEvent.click(await screen.findByLabelText('选择新品来源 selection-20'));
  fireEvent.click(screen.getByText('发起新品8D', { selector: 'button span' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/new-product-quality/eight-d/sources/preview', expect.objectContaining({ body: JSON.stringify({ organizationId: org, sources: [{ sourceId: 'selection-0', expectedVersion: 7 }, { sourceId: 'selection-20', expectedVersion: 7 }] }) })));
});

it('keeps rejected inclusion feedback inside its modal without losing the reason', async () => {
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (path.includes('/defect-selections') && init?.method === 'POST') throw new ApiError({ code: 'CONCURRENCY_CONFLICT', message: '' }, 409);
    return read(path, init);
  });
  mount(); fireEvent.click(await screen.findByText('纳入过程事实', { selector: 'button span' }));
  fireEvent.change(screen.getByLabelText('纳入依据（可空）'), { target: { value: '保留纳入依据' } });
  fireEvent.click(await screen.findByLabelText('纳入 候选过程事实'));
  await waitFor(() => expect(screen.getByRole('dialog', { name: '纳入过程事实' }).querySelector('[role="alert"]')).not.toBeNull());
  expect(screen.getByLabelText('纳入依据（可空）')).toHaveValue('保留纳入依据');
});
