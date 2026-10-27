import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { InternalEightDSourcePicker } from './InternalEightDSourcePicker';
import type { InternalEightDSourcePickerProps } from './source-picker';

const source = { sourceId: 'existing', primary: true, snapshot: { description: '原来源', projectId: 'project' } };
const report = { organizationId: 'org', problemId: 'problem', version: 1, sources: [source], closedRevisionId: null } as unknown as InternalEightDSourcePickerProps['report'];
let read: ReturnType<typeof vi.fn>;
beforeEach(() => {
  read = vi.fn(async path => path.includes('preview') ? [{ sourceId: 'new-selection', relatedSetToken: 'token', hasHiddenRelations: true, relatedProblems: [] }]
    : path.includes('customer-quality/ledger') ? { items: [{ id: 'new-selection', version: 4, complaintNumber: 'CQ-2', normalized: { defectDescription: '新来源' } }], total: 1 }
      : [{ id: 'new-selection', defect_id: 'never-process-source', source_version: 4, source_snapshot: { description: '新来源' } }]);
});
it.each(['customer', 'new-product'] as const)('builds %s source changes with source identities and explicit hidden-relationship confirmation', async domain => {
  const onChange = vi.fn();
  render(<LanguageProvider><InternalEightDSourcePicker domain={domain} report={report} read={read} disabled={false} onChange={onChange} /></LanguageProvider>);
  if (domain === 'new-product') expect(screen.getByText(/仅展示本报告已关联项目.*不代表允许跨项目合单/)).toBeVisible();
  fireEvent.click(await screen.findByRole('checkbox', { name: /新来源/ }));
  fireEvent.click(screen.getByRole('button', { name: '预览并核对来源关联' }));
  await screen.findByText(/另有不可见关联/);
  fireEvent.change(screen.getByLabelText('复发关联结论 new-selection'), { target: { value: 'RECURRENCE' } });
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ add: [{ sourceId: 'new-selection', expectedVersion: 4 }], removeSourceIds: [], primarySourceId: 'existing', sourceConfirmations: [{ sourceId: 'new-selection', relatedSetToken: 'token', relatedProblemIds: [], recurrence: 'RECURRENCE' }] })));
  expect(read.mock.calls.map(call => JSON.stringify(call)).join()).not.toContain('never-process-source');
});
it('allows only additive source changes after closure and leaves the approved primary untouched', async () => {
  const onChange = vi.fn(); read.mockResolvedValueOnce({ items: [], total: 0 });
  render(<LanguageProvider><InternalEightDSourcePicker domain="customer" report={{ ...report, closedRevisionId: 'approved' }} read={read} disabled={false} onChange={onChange} /></LanguageProvider>);
  expect(screen.getByRole('checkbox', { name: '原来源' })).toBeDisabled();
  expect(screen.getByRole('radio', { name: '主来源 existing' })).toBeDisabled();
});
