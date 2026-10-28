import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { ApiError } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider, useNavigationBusy, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { SupplierQualityPage } from './SupplierQualityPage';

vi.mock('../supplier-eight-d/SupplierEightDWorkspace', () => ({ SupplierEightDWorkspace: ({ supplierProblemId, portal, onDenied }: { supplierProblemId: string; portal: boolean; onDenied: (cause: unknown) => void }) => {
  const [pending, setPending] = useState('');
  const [dirty, setDirty] = useState(false);
  useNavigationBusy(!!pending);
  useUnsavedChanges(dirty);
  return <section><p>完整供应商工作区 · {supplierProblemId} · {portal ? '门户' : '内部'}</p>
    {pending && <p>{pending}仍被保留</p>}{dirty && <p>未保存的供应商草稿</p>}
    <button onClick={() => setPending('未知写入')}>模拟未知写入</button><button onClick={() => setPending('附件在途')}>模拟附件在途</button>
    <button onClick={() => setDirty(true)}>模拟编辑草稿</button>
    <button onClick={() => onDenied(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'denied' }, 403))}>模拟当前工作区失权</button></section>;
} }));
vi.mock('./SupplierEightDIssueButton', () => ({ SupplierEightDIssueButton: ({ onIssued }: { onIssued: () => void }) => <button onClick={onIssued}>完整8D新发单入口</button> }));
vi.mock('./SupplierWorkflowActions', () => ({ SupplierWorkflowActions: () => <p>legacy workflow actions</p> }));
vi.mock('./SupplierResponseHistory', () => ({ SupplierResponseHistory: () => <p>legacy response history</p> }));
const id = '11111111-1111-4111-8111-111111111111';
function fixture(overrides: Record<string, unknown> = {}) {
  return { id, version: 1, profileId: 'profile', supplierName: '供应商', title: '供应商测试机密标题', materialCode: 'PART', defectDescription: '不良描述',
    defectQuantity: 1, severity: 'HIGH', responseForm: 'EIGHT_D', replyMode: 'SUPPLIER', stage: 'ISSUED', canEditFacts: false, canEditResponse: false,
    controlledEightD: true, responseDraft: {}, updatedAt: new Date().toISOString(), ...overrides };
}
function scene(record: ReturnType<typeof fixture>, portal = false) {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => new Response(JSON.stringify(path.includes('reference-options') ? { items: [], total: 0 } : record), { headers: { 'content-type': 'application/json' } })));
  return render(<LanguageProvider><MemoryRouter initialEntries={[`${portal ? '/supplier/corrections' : '/app/supplier-quality'}/problems/${id}`]}><UnsavedChangesProvider><SupplierQualityPage portal={portal} /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>);
}
afterEach(() => vi.unstubAllGlobals());

it('mounts the complete issued workspace and never the legacy response/history actions', async () => {
  scene(fixture());
  expect(await screen.findByText(/完整供应商工作区/)).toHaveTextContent('内部');
  expect(screen.queryByText('legacy workflow actions')).not.toBeInTheDocument();
  expect(screen.queryByText('legacy response history')).not.toBeInTheDocument();
});

it('keeps a controlled draft on facts plus the new issue path rather than the legacy issue button', async () => {
  scene(fixture({ stage: 'DRAFT', canEditFacts: true }));
  expect(await screen.findByText('完整8D新发单入口')).toBeVisible();
  expect(screen.queryByText('正式发单', { selector: 'button span' })).not.toBeInTheDocument();
  expect(screen.queryByText(/完整供应商工作区/)).not.toBeInTheDocument();
});

it('preserves legacy issued history/actions when the controlled marker is absent', async () => {
  scene(fixture({ controlledEightD: undefined }));
  expect(await screen.findByText('legacy response history')).toBeVisible();
  expect(screen.getByText('legacy workflow actions')).toBeVisible();
  expect(screen.queryByText(/完整供应商工作区/)).not.toBeInTheDocument();
});

it('uses the real portal workspace and clears the parent facts when that scope loses access', async () => {
  scene(fixture(), true);
  expect(await screen.findByText(/完整供应商工作区/)).toHaveTextContent('门户');
  expect(screen.getByText('供应商测试机密标题')).toBeVisible();
  fireEvent.click(screen.getByText('模拟当前工作区失权'));
  expect(screen.queryByText('供应商测试机密标题')).not.toBeInTheDocument();
  expect(screen.queryByText(/完整供应商工作区/)).not.toBeInTheDocument();
});

it('exposes the independently authorized issue path even when draft fact editing is unavailable', async () => {
  scene(fixture({ stage: 'DRAFT', canEditFacts: false }));
  expect(await screen.findByText('完整8D新发单入口')).toBeVisible();
  expect(screen.queryByText('保存问题草稿')).not.toBeInTheDocument();
});

it.each(['未知写入', '附件在途'])('does not unmount the workspace or refetch while %s is pending', async pending => {
  scene(fixture());
  await screen.findByText(/完整供应商工作区/);
  fireEvent.click(screen.getByText(`模拟${pending}`));
  const calls = vi.mocked(fetch).mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
  expect(screen.getByText(`${pending}仍被保留`)).toBeVisible();
  expect(vi.mocked(fetch).mock.calls).toHaveLength(calls);
});

it('confirms parent refresh and retains the child draft when discard is cancelled', async () => {
  scene(fixture());
  await screen.findByText(/完整供应商工作区/);
  fireEvent.click(screen.getByText('模拟编辑草稿'));
  const calls = vi.mocked(fetch).mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
  await waitFor(() => expect(screen.getByText('当前草稿尚未保存，继续将放弃修改。')).toBeVisible());
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByText('未保存的供应商草稿')).toBeVisible();
  expect(vi.mocked(fetch).mock.calls).toHaveLength(calls);
});
