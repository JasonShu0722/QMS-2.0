import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiRequest } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { AttachmentPanel } from '../attachments/AttachmentPanel';
import { SupplierPpapPage } from '../supplier-ppap/SupplierPpapPage';
import { SupplierQualityPage } from './SupplierQualityPage';

vi.mock('../../api/client', async () => ({ ...await vi.importActual<typeof import('../../api/client')>('../../api/client'), apiRequest: vi.fn(), csrfToken: vi.fn().mockResolvedValue('csrf') }));
vi.mock('../attachments/AttachmentPanel', () => ({ AttachmentPanel: vi.fn(() => null) }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function view(page: ReactElement, path = '/') {
  return render(<LanguageProvider><ConfigProvider theme={{ token: { motion: false } }}><MemoryRouter initialEntries={[path]}><UnsavedChangesProvider>{page}</UnsavedChangesProvider></MemoryRouter></ConfigProvider></LanguageProvider>);
}
function blockedUnload() {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development');
  localStorage.setItem('qms:locale:v1', 'zh-CN');
  vi.mocked(apiRequest).mockReset();
  vi.mocked(AttachmentPanel).mockImplementation(({ resource, fileIds, onReady, readOnly }) => <div>
    <output aria-label={`证据 ${resource.resourceId}`}>{fileIds?.join(',')}</output>
    <button disabled={readOnly} onClick={() => onReady?.({ id: `f-${resource.resourceId}`, status: 'AVAILABLE', scanStatus: 'CLEAN' } as Parameters<NonNullable<typeof onReady>>[0])}>选择 {resource.resourceId}</button>
  </div>);
});
afterEach(() => vi.unstubAllEnvs());

const pack = { id: 'p1', title: '控制计划', partNumber: 'M-1', level: 3, status: 'DRAFT', version: 1, items: ['i1', 'i2'].map(id => ({ id, packageId: 'p1', itemCode: id, title: id, required: true, status: 'PENDING', evidenceFileIds: [] as string[], version: 1 })) };

it('F2 keeps the sibling PPAP selection during and after one item is bound, with separate saved baselines', async () => {
  const reload = deferred<typeof pack>();
  let reads = 0;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (init?.method === 'POST') return {} as never;
    if (String(path).includes('my-permissions')) return { permissions: ['supplier-ppap:write'] } as never;
    if (String(path).includes('profiles')) return { items: [] } as never;
    if (String(path).endsWith('/p1')) return (++reads === 1 ? pack : reload.promise) as never;
    return { items: [pack] } as never;
  });
  view(<SupplierPpapPage />);
  const open = await screen.findByText('查看与审核', { selector: 'button span' });
  expect(open.closest('button')).toHaveAccessibleName('查看与审核');
  fireEvent.click(open);
  const firstRow = within((await screen.findByLabelText('证据 i1')).closest('tr')!);
  const secondRow = within(screen.getByLabelText('证据 i2').closest('tr')!);
  fireEvent.click(firstRow.getByRole('button', { name: '选择 i1' }));
  fireEvent.click(secondRow.getByRole('button', { name: '选择 i2' }));
  fireEvent.click(firstRow.getByRole('button', { name: '绑定扫描证据' }));
  await waitFor(() => expect(reads).toBe(2));
  expect(screen.getByLabelText('证据 i2')).toHaveTextContent('f-i2');
  await act(async () => reload.resolve({ ...pack, version: 2, items: pack.items.map(item => ({ ...item, version: 2, evidenceFileIds: item.id === 'i1' ? ['f-i1'] : [], status: item.id === 'i1' ? 'PROVIDED' : 'PENDING' })) }));
  expect(screen.getByLabelText('证据 i2')).toHaveTextContent('f-i2');
  const refreshedFirstRow = within(screen.getByLabelText('证据 i1').closest('tr')!);
  const refreshedSecondRow = within(screen.getByLabelText('证据 i2').closest('tr')!);
  expect(refreshedFirstRow.getByRole('button', { name: '绑定扫描证据' })).toBeDisabled();
  expect(refreshedSecondRow.getByRole('button', { name: '绑定扫描证据' })).toBeEnabled();
  expect(blockedUnload()).toBe(true);
  fireEvent.click(refreshedSecondRow.getByRole('button', { name: '绑定扫描证据' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/supplier-ppap/p1/items/i2/evidence', expect.objectContaining({ body: JSON.stringify({ expectedVersion: 2, evidenceFileIds: ['f-i2'] }) })));
  await waitFor(() => expect(blockedUnload()).toBe(false));
});
const problem = { id: '11111111-1111-4111-8111-111111111111', version: 3, supplierName: '企业', title: '来料问题', materialCode: 'MAT', defectDescription: '氧化', defectQuantity: 2, severity: 'HIGH', responseForm: 'BRIEF', replyMode: 'SUPPLIER', stage: 'ISSUED', problemStatus: 'OPEN', canEditFacts: false, canEditResponse: true, availableActions: ['SUBMIT'], responseDraft: {} };

it('F3 saves response content without losing selected evidence, then submits it with the refreshed version', async () => {
  const reload = deferred<typeof problem>();
  let reads = 0;
  let submitted = false;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (init?.method === 'PUT') return { ...problem, version: 4, responseDraft: { rootCause: '原因', correctiveAction: '措施' } } as never;
    if (init?.method === 'POST') { submitted = true; return { ...problem, version: 5, canEditResponse: false } as never; }
    if (submitted) return { ...problem, version: 5, canEditResponse: false } as never;
    return (++reads === 1 ? problem : reload.promise) as never;
  });
  view(<SupplierQualityPage portal />, `/supplier/corrections/problems/${problem.id}`);
  fireEvent.change(await screen.findByLabelText('根本原因'), { target: { value: '原因' } });
  fireEvent.change(screen.getByLabelText('纠正措施'), { target: { value: '措施' } });
  fireEvent.change(screen.getByLabelText('完成时间'), { target: { value: '2026-10-21T10:00' } });
  fireEvent.click(screen.getByRole('button', { name: `选择 ${problem.id}` }));
  fireEvent.click(screen.getByRole('button', { name: '保存回复草稿' }));
  await waitFor(() => expect(reads).toBe(2));
  expect(screen.getByLabelText(`证据 ${problem.id}`)).toHaveTextContent(`f-${problem.id}`);
  await act(async () => reload.resolve({ ...problem, version: 4 }));
  expect(screen.getByLabelText(`证据 ${problem.id}`)).toHaveTextContent(`f-${problem.id}`);
  expect(screen.getByLabelText('根本原因')).toHaveValue('原因');
  expect(blockedUnload()).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '正式提交回复' }));
  await waitFor(() => expect(submitted).toBe(true));
  const request = vi.mocked(apiRequest).mock.calls.find(([path]) => String(path).endsWith('/actions'));
  expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({ expectedContentVersion: 4, evidenceFileIds: [`f-${problem.id}`] });
  await waitFor(() => expect(blockedUnload()).toBe(false));
});
