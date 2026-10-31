import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { AttachmentPanel } from '../attachments/AttachmentPanel';
import { SupplierQualityPage } from './SupplierQualityPage';

type AttachmentProps = Parameters<typeof AttachmentPanel>[0];
type Attachment = Parameters<NonNullable<AttachmentProps['onReady']>>[0];
const file = { id: 'file-1', originalName: 'evidence.txt', status: 'AVAILABLE', scanStatus: 'CLEAN', version: 1 } as Attachment;
vi.mock('../attachments/AttachmentPanel', () => ({
  AttachmentPanel: ({ onLocalPendingChange, onReady, onRemoved }: AttachmentProps) => <div>
    <button onClick={() => onLocalPendingChange?.(true)}>测试本地附件在途</button>
    <button onClick={() => onLocalPendingChange?.(false)}>测试本地附件结束</button>
    <button onClick={() => onReady?.(file)}>测试接收CLEAN附件</button>
    <button onClick={() => onRemoved?.(file.id)}>测试移除本地附件</button>
  </div>,
}));
const record = { id: '11111111-1111-4111-8111-111111111111', version: 3, supplierName: '供应商甲', title: '当前问题', materialCode: 'MAT', defectDescription: '氧化', defectQuantity: 2, severity: 'HIGH', responseForm: 'BRIEF', replyMode: 'INTERNAL', stage: 'ISSUED', problemStatus: 'OPEN', canEditFacts: false, canEditResponse: true, availableActions: ['SUBMIT'], responseDraft: {}, responseHistory: { items: [], total: 0, page: 1, pageSize: 10 } };
function mount(portal = false) {
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(record), { headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetcher);
  render(<LanguageProvider><MemoryRouter initialEntries={[`${portal ? '/supplier/corrections' : '/app/supplier-quality'}/problems/${record.id}`]}><UnsavedChangesProvider><SupplierQualityPage portal={portal} /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>);
  return fetcher;
}
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

it.each([false, true])('C SPEC response introduction respects its host and submit context (portal=%s)', async portal => {
  const requests = mount(portal);
  const submit = await screen.findByRole('button', { name: '正式提交回复' });
  expect(screen.queryByText(/可分次保存草稿/) !== null).toBe(portal);
  if (portal) expect(screen.getByText(/未提交附件在离开或刷新页面后不能自动恢复/)).toBeVisible();
  else expect(within(submit.closest('.ant-space')!).getByText('正式提交后当前修订不可编辑。')).toBeVisible();
  expect(requests.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
});

it('C SPEC internal reply warning follows actual pending and selected local evidence', async () => {
  mount(); await screen.findByRole('button', { name: '正式提交回复' });
  expect(screen.getByText(/已选 0 个可提交证据/)).toBeVisible();
  expect(screen.queryByText(/未提交附件在离开或刷新页面后不能自动恢复/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '测试本地附件在途' }));
  expect(screen.getByText(/未提交附件在离开或刷新页面后不能自动恢复/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '测试本地附件结束' }));
  expect(screen.queryByText(/未提交附件在离开或刷新页面后不能自动恢复/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '测试接收CLEAN附件' }));
  expect(screen.getByText(/已选 1 个可提交证据/)).toBeVisible();
  expect(screen.getByText(/未提交附件在离开或刷新页面后不能自动恢复/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '测试移除本地附件' }));
  expect(screen.getByText(/已选 0 个可提交证据/)).toBeVisible();
  expect(screen.queryByText(/未提交附件在离开或刷新页面后不能自动恢复/)).not.toBeInTheDocument();
});
