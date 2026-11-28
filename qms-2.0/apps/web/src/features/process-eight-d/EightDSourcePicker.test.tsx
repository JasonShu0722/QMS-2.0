import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { LanguageProvider } from '../../i18n/Language';
import { EightDSourcePicker } from './EightDSourcePicker';

it('searches only on submission and keeps selected process sources without version labels', async () => {
  const report = { organizationId: 'org', problemId: 'problem', version: 1, sources: [{ defectId: 'current', primary: true, snapshot: { description: '既有来源' } }] } as unknown as components['schemas']['ProcessEightDReportDto'];
  const read = vi.fn().mockResolvedValueOnce({ items: [{ id: 'candidate', description: '台账划伤', traceCode: 'TRACE-1', version: 6 }], total: 1 })
    .mockResolvedValueOnce({ items: [], total: 0 }).mockResolvedValueOnce([{ defectId: 'candidate', relatedProblems: [], hasHiddenRelations: false }]);
  const onChange = vi.fn();
  render(<LanguageProvider><EightDSourcePicker report={report} read={read} disabled={false} onChange={onChange} /></LanguageProvider>);
  expect(read).not.toHaveBeenCalled();
  const input = screen.getByLabelText('搜索来源台账');
  fireEvent.change(input, { target: { value: ' 划伤 ' } });
  expect(read).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '搜索' }));
  const candidate = await screen.findByRole('checkbox', { name: '台账划伤 · TRACE-1' });
  fireEvent.click(candidate);
  fireEvent.change(input, { target: { value: '其他' } });
  fireEvent.click(screen.getByRole('button', { name: '搜索' }));
  await screen.findByText('无匹配台账');
  expect(screen.queryByText(/v6/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '移除待补来源' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '预览并核对来源关联' }));
  await screen.findByText('未发现其他关联');
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ add: [{ defectId: 'candidate', expectedVersion: 6 }] }));
});
