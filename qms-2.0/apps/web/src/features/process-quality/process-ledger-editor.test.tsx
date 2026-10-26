import type { components } from '@qms/contracts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ApiError, apiRequest, csrfToken, getSession } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { ProcessDefectEditor } from './ProcessDefectEditor';
import { ProcessLedgerAction } from './ProcessLedgerAction';

vi.mock('../../api/client', async () => ({ ...(await vi.importActual<typeof import('../../api/client')>('../../api/client')), apiRequest: vi.fn(), csrfToken: vi.fn(), getSession: vi.fn() }));
vi.mock('../attachments/AttachmentPanel', () => ({ AttachmentPanel: ({ resource }: { resource: { resourceType: string; resourceId: string } }) => <div>附件资源 {resource.resourceType}:{resource.resourceId}</div> }));
const record: components['schemas']['ProcessDefectDto'] = {
  id: 'defect', organizationId: 'org', description: '原始线索', defectTypeCode: null, defectQuantity: null, occurredAt: null, responsibilityCategory: null, traceCode: 'TRACE', analysisProgress: null, ledgerStatus: 'FOLLOWING', closedAt: null, closedById: null,
  sourceKind: 'MANUAL', version: 2, materialVerificationHistory: [], ledgerHistory: [], classificationHistory: [], componentProject: null, duplicateCount: 0, issues: [], evidence: [], projectCode: 'MANUAL',
  materials: [{ id: 'material', organizationId: 'org', defectId: 'defect', position: 0, materialCode: 'MAT-1', materialName: '物料一', supplierProfileId: 'profile-a', supplierOrganizationId: 'supplier-a', materialBatch: 'BATCH-1', sqeUserId: 'sqe', notes: '原物料线索', verification: 'NOT_MATERIAL', verificationNotes: '历史结论', verifiedById: 'sqe', verifiedAt: null, verificationHistory: [] }],
};
const suppliers: components['schemas']['SupplierProfileDto'][] = [{ id: 'profile-a', version: 1, supplierOrganizationId: 'supplier-a', businessCode: 'A', displayName: '供应商甲' }, { id: 'profile-b', version: 1, supplierOrganizationId: 'supplier-b', businessCode: 'B', displayName: '供应商乙' }];
beforeEach(() => {
  vi.mocked(csrfToken).mockResolvedValue('csrf');
  vi.mocked(getSession).mockResolvedValue({ userId: 'user', organizationId: 'org', accountType: 'INTERNAL', landingPath: '/app/workbench' });
  vi.mocked(apiRequest).mockReset().mockImplementation(async (path, init) => init?.method ? { ...record, version: 3 } : path.includes('material-sqes') ? { items: [{ id: 'sqe', username: 'sqe', fullName: '有效SQE' }], total: 1, page: 1, pageSize: 100 } : []);
});
function editor(initial: typeof record | 'new' = record) {
  const onSaved = vi.fn();
  render(<LanguageProvider><MemoryRouter><UnsavedChangesProvider><ProcessDefectEditor record={initial === 'new' ? undefined : initial} suppliers={suppliers} canReadSuppliers onSaved={onSaved} onClose={vi.fn()} onDenied={vi.fn()} /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>);
  return onSaved;
}
it('starts a new registration with one optional material row and preserves appended partial facts while collapsed', async () => {
  const saved = editor('new');
  fireEvent.click(screen.getByText('多物料、供应商与SQE'));
  expect(await screen.findByLabelText('物料编码 1')).toHaveValue('');
  expect(screen.queryByLabelText('物料编码 2')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('添加物料'));
  fireEvent.change(screen.getByLabelText('物料说明 2'), { target: { value: '  仅补充物料线索  ' } });
  fireEvent.click(screen.getByText('添加物料'));
  expect(screen.getByLabelText('物料编码 3')).toHaveValue('');
  fireEvent.click(screen.getByText('多物料、供应商与SQE'));
  fireEvent.click(screen.getByText('保存登记'));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  const call = vi.mocked(apiRequest).mock.calls.find(([, init]) => init?.method === 'POST');
  expect(JSON.parse(String(call?.[1]?.body)).materials).toEqual([{ materialCode: null, materialName: null, materialBatch: null, notes: '仅补充物料线索', sqeUserId: null, supplierProfileId: null, supplierOrganizationId: null }]);
});
it('prunes blank added material rows without requiring material facts for a new registration', async () => {
  const saved = editor('new');
  fireEvent.click(screen.getByText('多物料、供应商与SQE'));
  fireEvent.click(screen.getByText('添加物料'));
  fireEvent.change(screen.getByLabelText('物料编码 1'), { target: { value: '   ' } });
  fireEvent.change(screen.getByLabelText('物料说明 1'), { target: { value: '   ' } });
  fireEvent.click(screen.getByText('保存登记'));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  const call = vi.mocked(apiRequest).mock.calls.find(([, init]) => init?.method === 'POST');
  expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ description: '', defectQuantity: null, occurredAt: null, responsibilityCategory: null, materials: [] });
});
it('preserves manual mapping, material identity, batch and SQE without sending read-only review fields', async () => {
  const saved = editor();
  fireEvent.click(screen.getByText('多物料、供应商与SQE'));
  fireEvent.mouseDown(await screen.findByLabelText('供应商 1'));
  fireEvent.click(await screen.findByText('供应商乙', { selector: '.ant-select-item-option-content' }));
  fireEvent.click(screen.getByText('保存登记'));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  const call = vi.mocked(apiRequest).mock.calls.find(([path, init]) => path.endsWith('/defect') && init?.method === 'PUT');
  const body = JSON.parse(String(call?.[1]?.body));
  expect(body).toMatchObject({ expectedVersion: 2, projectCode: 'MANUAL', defectQuantity: null, occurredAt: null, materials: [{ id: 'material', materialCode: 'MAT-1', materialBatch: 'BATCH-1', supplierProfileId: 'profile-b', supplierOrganizationId: 'supplier-b', sqeUserId: 'sqe' }] });
  expect(body.materials[0]).not.toHaveProperty('verification');
  expect(screen.getByText('附件资源 process-defect:defect')).toBeVisible();
});
it('keeps a manual edit intact after a real 409 instead of replacing it with fetched suggestions', async () => {
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (init?.method) throw new ApiError({ code: 'CONCURRENCY_CONFLICT', message: '' }, 409);
    return path.includes('material-sqes') ? { items: [], total: 0 } : [];
  });
  editor();
  fireEvent.change(screen.getByLabelText('失效现象'), { target: { value: '人工修改保留' } });
  fireEvent.click(screen.getByText('保存登记'));
  await screen.findByText('记录已被其他用户更新，请刷新后重试');
  expect(screen.getByLabelText('失效现象')).toHaveValue('人工修改保留');
});
it('preserves unexpanded clue and material fields when saving only the description', async () => {
  const saved = editor();
  fireEvent.change(screen.getByLabelText('失效现象'), { target: { value: '只补充现象' } });
  fireEvent.click(screen.getByText('保存登记'));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  const call = vi.mocked(apiRequest).mock.calls.find(([, init]) => init?.method === 'PUT');
  expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ description: '只补充现象', projectCode: 'MANUAL', traceCode: 'TRACE', materials: [{ id: 'material', materialCode: 'MAT-1', supplierProfileId: 'profile-a', sqeUserId: 'sqe' }] });
});
it('leaves retry available after an unknown save outcome and replays the exact create request', async () => {
  let attempts = 0;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (init?.method && ++attempts === 1) throw new TypeError('network lost');
    return init?.method ? record : path.includes('material-sqes') ? { items: [], total: 0 } : [];
  });
  const saved = editor();
  fireEvent.change(screen.getByLabelText('失效现象'), { target: { value: '原请求' } });
  fireEvent.click(screen.getByText('保存登记'));
  const retry = await screen.findByText('同请求重试保存');
  expect(screen.getByLabelText('失效现象')).toBeDisabled();
  expect(retry.closest('button')).toBeEnabled();
  fireEvent.click(retry);
  await waitFor(() => expect(saved).toHaveBeenCalled());
  const calls = vi.mocked(apiRequest).mock.calls.filter(([, init]) => init?.method === 'PUT');
  expect(calls).toHaveLength(2);
  expect(calls[0][1]?.body).toBe(calls[1][1]?.body);
  expect(new Headers(calls[0][1]?.headers).get('Idempotency-Key')).toBe(new Headers(calls[1][1]?.headers).get('Idempotency-Key'));
});
it('requires a nonblank reopen reason and preserves the draft after a rejected close capability', async () => {
  const saved = vi.fn();
  const denied = vi.fn();
  vi.mocked(apiRequest).mockRejectedValue(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: '' }, 403));
  render(<LanguageProvider><MemoryRouter><UnsavedChangesProvider><ProcessLedgerAction mode="reopen" record={{ ...record, ledgerStatus: 'CLOSED' }} onSaved={saved} onClose={vi.fn()} onDenied={denied} /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>);
  fireEvent.change(screen.getByLabelText('恢复原因'), { target: { value: '   ' } });
  fireEvent.click(screen.getByText('确认恢复跟进', { selector: 'button span' }));
  await screen.findByText('请说明恢复原因');
  expect(apiRequest).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('恢复原因'), { target: { value: '资料待补充' } });
  fireEvent.click(screen.getByText('确认恢复跟进', { selector: 'button span' }));
  await waitFor(() => expect(denied).toHaveBeenCalled());
  expect(saved).not.toHaveBeenCalled();
});
it.each(['不良属实', '非物料', '协商', '返厂解析'])('records %s as an explicit material verification, without creating tasks', async label => {
  const saved = vi.fn();
  render(<LanguageProvider><MemoryRouter><ProcessLedgerAction mode="verification" materialId="material" record={record} onSaved={saved} onClose={vi.fn()} onDenied={vi.fn()} /></MemoryRouter></LanguageProvider>);
  fireEvent.mouseDown(screen.getByLabelText('复核结论'));
  fireEvent.click(await screen.findByText(label, { selector: '.ant-select-item-option-content' }));
  fireEvent.click(screen.getByText('保存物料复核', { selector: 'button span' }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(apiRequest).toHaveBeenCalledWith('/api/v1/process-quality/defects/defect/materials/material/verification', expect.objectContaining({ method: 'PUT' }), { replayAfterReauthentication: false });
  expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path.includes('/tasks'))).toBe(false);
});
