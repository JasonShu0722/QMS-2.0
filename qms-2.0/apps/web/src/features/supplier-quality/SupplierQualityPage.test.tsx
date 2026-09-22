import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { SupplierQualityPage } from './SupplierQualityPage';

afterEach(() => vi.unstubAllGlobals());

it('shows an empty supplier inbox without offering internal draft creation', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], total: 0, canCreateDraft: false }), { headers: { 'content-type': 'application/json' } })));
  render(<MemoryRouter initialEntries={['/supplier/corrections']}><SupplierQualityPage portal /></MemoryRouter>);
  expect(await screen.findByText('尚未收到问题单')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '创建问题草稿' })).not.toBeInTheDocument();
});

it('reports authorization failure instead of displaying an empty successful ledger', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'FEATURE_PERMISSION_DENIED', message: 'denied' }), { status: 403, headers: { 'content-type': 'application/json' } })));
  render(<MemoryRouter initialEntries={['/app/supplier-quality']}><SupplierQualityPage /></MemoryRouter>);
  expect(await screen.findByText('无权执行此操作')).toBeInTheDocument();
  expect(screen.queryByText('暂无问题草稿')).not.toBeInTheDocument();
});

it('keeps an unsaved internal response when the separate problem form is saved', async () => {
  const record = { id: '11111111-1111-4111-8111-111111111111', version: 1, profileId: '22222222-2222-4222-8222-222222222222', supplierOrganizationId: '33333333-3333-4333-8333-333333333333', supplierName: '企业', title: '来料问题', materialCode: 'MAT', defectDescription: '氧化', defectQuantity: 2, severity: 'HIGH', responseForm: 'BRIEF', replyMode: 'INTERNAL', internalResponderId: '44444444-4444-4444-8444-444444444444', stage: 'DRAFT', updatedAt: new Date().toISOString(), canEditFacts: true, canEditResponse: true, responseDraft: {} };
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    let payload: unknown = record;
    if (path.endsWith('/csrf')) payload = { csrfToken: 'test' };
    else if (path.includes('reference-options')) payload = { items: [path.includes('responders') ? { id: record.internalResponderId, label: '回复人' } : { id: record.profileId, label: '供应商' }], total: 1 };
    else if (init?.method === 'PUT') payload = { ...record, version: 2, title: JSON.parse(String(init.body)).title };
    return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
  }));
  render(<MemoryRouter initialEntries={[`/app/supplier-quality/problems/${record.id}`]}><SupplierQualityPage /></MemoryRouter>);
  fireEvent.change(await screen.findByLabelText('根本原因'), { target: { value: '尚未保存的回复内容' } });
  fireEvent.change(screen.getByLabelText('问题标题'), { target: { value: '更新后的标题' } });
  const saveButton = screen.getByText('保存问题草稿').closest('button')!;
  expect(saveButton).not.toBeDisabled();
  fireEvent.click(saveButton);
  expect(await screen.findByText('草稿已保存')).toBeInTheDocument();
  expect(screen.getByLabelText('根本原因')).toHaveValue('尚未保存的回复内容');
});
