import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { InternalLayout } from './InternalLayout';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';

vi.mock('../features/supplier-quality/SupplierQualityPage', () => ({ SupplierQualityPage: () => <h1>Supplier problem page</h1> }));
vi.mock('../features/supplier-quality-targets/SupplierQualityTargetsPage', () => ({ SupplierQualityTargetsPage: () => <h1>Supplier target page</h1> }));
vi.mock('../features/process-quality/ProcessDefectLedgerPage', () => ({ ProcessDefectLedgerPage: () => <h1>Process ledger page</h1> }));
vi.mock('../features/process-quality/ProcessShipmentReportPanel', () => ({ ProcessShipmentReportPanel: () => <h1>Shipment report page</h1> }));
vi.mock('../features/problem-center/ProblemCenterPage', () => ({ ProblemCenterPage: ({ processQuality }: { processQuality?: boolean }) => <h1>{processQuality ? 'Process follow-up page' : 'Problem center page'}</h1> }));
afterEach(() => vi.unstubAllGlobals());

it('renders only the intended page when a sibling route shares its name prefix', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [], permissions: [], unreadMustReadCount: 0 }), { headers: { 'content-type': 'application/json' } })));
  render(<MemoryRouter initialEntries={['/app/supplier-quality-targets']}><InternalLayout /></MemoryRouter>);
  expect(screen.getByRole('heading', { name: 'Supplier target page' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Supplier problem page' })).not.toBeInTheDocument();
});

it.each([
  ['/app/process-quality', 'Process ledger page', '不良品台账'],
  ['/app/process-quality/problems', 'Process follow-up page', '制程问题跟进'],
  ['/app/process-quality/shipment-reports', 'Shipment report page', '出货报告'],
])('mounts only the intended process page and work tab at %s', async (path, heading, title) => {
  useWorkTabsStore.getState().reset();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [], permissions: [], unreadMustReadCount: 0 }), { headers: { 'content-type': 'application/json' } })));
  render(<MemoryRouter initialEntries={[`${path}?organizationId=org-1`]}><InternalLayout /></MemoryRouter>);
  expect(screen.getByRole('heading', { name: heading })).toBeVisible();
  for (const other of ['Process ledger page', 'Process follow-up page', 'Shipment report page'].filter(value => value !== heading)) {
    expect(screen.queryByRole('heading', { name: other })).not.toBeInTheDocument();
  }
  expect(screen.getByRole('link', { name: title, current: 'page' })).toHaveAttribute('href', path);
  expect(useWorkTabsStore.getState().tabs).toEqual([expect.objectContaining({ id: path, path: `${path}?organizationId=org-1`, title })]);
});
