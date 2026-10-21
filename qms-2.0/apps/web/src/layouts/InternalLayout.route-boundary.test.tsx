import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { InternalLayout } from './InternalLayout';

vi.mock('../features/supplier-quality/SupplierQualityPage', () => ({ SupplierQualityPage: () => <h1>Supplier problem page</h1> }));
vi.mock('../features/supplier-quality-targets/SupplierQualityTargetsPage', () => ({ SupplierQualityTargetsPage: () => <h1>Supplier target page</h1> }));
afterEach(() => vi.unstubAllGlobals());

it('renders only the intended page when a sibling route shares its name prefix', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [], permissions: [], unreadMustReadCount: 0 }), { headers: { 'content-type': 'application/json' } })));
  render(<MemoryRouter initialEntries={['/app/supplier-quality-targets']}><InternalLayout /></MemoryRouter>);
  expect(screen.getByRole('heading', { name: 'Supplier target page' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Supplier problem page' })).not.toBeInTheDocument();
});
