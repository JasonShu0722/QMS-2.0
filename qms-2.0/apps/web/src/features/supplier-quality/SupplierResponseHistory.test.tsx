import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { SupplierResponseHistory } from './SupplierResponseHistory';
import type { SupplierProblem } from './supplierQuality';

afterEach(() => vi.unstubAllGlobals());

it('keeps immutable revisions visible when a new supplier draft becomes editable', () => {
  const record = { id: '11111111-1111-4111-8111-111111111111', canEditResponse: true,
    currentVerification: { status: 'INVALIDATED' }, responseHistory: { page: 1, pageSize: 10, total: 2, items: [
      { id: 'revision-2', revision: 2, content: { rootCause: '第二次原因' }, submittedAt: '2026-09-23T10:00:00Z', evidence: [] },
      { id: 'revision-1', revision: 1, content: { rootCause: '首次原因' }, submittedAt: '2026-09-22T10:00:00Z', evidence: [] },
    ] } } as unknown as SupplierProblem;
  render(<LanguageProvider><SupplierResponseHistory record={record} page={1} changePage={vi.fn()} /></LanguageProvider>);
  expect(screen.getByText('第 2 次提交')).toBeInTheDocument();
  expect(screen.getByText('第 1 次提交')).toBeInTheDocument();
  expect(screen.getByText('第二次原因')).toBeInTheDocument();
  expect(screen.getByText('首次原因')).toBeInTheDocument();
  expect(screen.getByText('既有验证已失效')).toBeInTheDocument();
});

it('shows retained evidence status without claiming a scan or download succeeded', async () => {
  const fileId = '55555555-5555-4555-8555-555555555555';
  const record = { id: '11111111-1111-4111-8111-111111111111', responseHistory: { page: 1, pageSize: 10, total: 1, items: [
    { id: 'revision-1', revision: 1, content: { rootCause: '原因' }, submittedAt: '2026-09-23T10:00:00Z', evidence: [{ fileId, originalName: 'report.pdf', purpose: 'RESPONSE', status: 'QUARANTINED', scanStatus: 'PENDING', downloadable: false }] },
  ] } } as unknown as SupplierProblem;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: fileId, resourceType: 'supplier-quality', resourceId: record.id, originalName: 'report.pdf', sizeBytes: 8, status: 'QUARANTINED', scanStatus: 'PENDING', version: 2 }), { headers: { 'content-type': 'application/json' } })));
  render(<LanguageProvider><SupplierResponseHistory record={record} page={1} changePage={vi.fn()} /></LanguageProvider>);
  expect(screen.getByText('等待安全扫描')).toBeInTheDocument();
  expect(await screen.findByText('report.pdf', { selector: '.ant-card-head-title' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '下载附件' })).not.toBeInTheDocument();
});
