import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SupplierProfilesPage } from './SupplierProfilesPage';

afterEach(() => vi.unstubAllGlobals());

it('gives the create and edit forms distinct labels and field IDs', async () => {
  const profile = { id: 'profile-one', version: 1, supplierOrganizationId: 'supplier-one', businessCode: 'SQ-001', displayName: '供应商甲', contactName: '原联系人' };
  vi.stubGlobal('fetch', vi.fn(async (path: string) => new Response(JSON.stringify(path.includes('supplier-options') ? { items: [], total: 0 } : { items: [profile], total: 1, canManage: true }), { headers: { 'content-type': 'application/json' } })));
  render(<SupplierProfilesPage />);
  fireEvent.click(await screen.findByText('编辑资料'));
  const title = await screen.findByText('编辑供应商资料');
  const editor = within(title.closest('[role="dialog"]') as HTMLElement);
  expect(editor.getByLabelText('联系人', { exact: true })).toHaveValue('原联系人');
  const fields = [...document.querySelectorAll('input[id]')].map((field) => field.id);
  expect(new Set(fields).size).toBe(fields.length);
});
