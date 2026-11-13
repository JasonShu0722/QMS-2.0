import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { EightDAssignmentPicker } from './EightDAssignmentPicker';
import type { EightDRead, EightDReport } from './eight-d';

const report: EightDReport = {
  problemId: 'problem', reportNumber: '8D-001', organizationId: 'org', instanceId: 'instance', workflowVersionId: 'workflow', instanceVersion: 1, problemVersion: 1,
  version: 1, contentVersion: 1, status: 'PROCESSING', severity: 'MEDIUM', ownerUserId: 'owner', professionalUserId: 'professional', responsibleSectionDepartmentId: 'department', collaboratorUserIds: [],
  document: { description: '', okFileIds: [], ngFileIds: [], temporaryMeasures: [], containment: [], optionalAffectedContainment: [], analysisProcess: '', analysisFileIds: [], occurrenceCause: '', escapeCause: '', systemCause: '', correctiveActions: [], horizontalDeployment: [], standardization: [], closureSummary: '' },
  analysisCompletedAt: null, analysisDueAt: null, submissionDueAt: null, closureDueAt: null, submittedAt: null, closedRevisionId: null, allowedActions: ['reassign'], sources: [], revisions: [],
};
beforeEach(() => useWorkTabsStore.getState().bindSession('picker-session'));
afterEach(() => useWorkTabsStore.getState().reset());

it.each(['process', 'customer', 'new-product'] as const)('preserves the selected identity across pages and clears it on session ABA for %s', async domain => {
  const read = vi.fn<EightDRead>();
  read.mockImplementation(async <Result,>(path: string) => ({ departments: [], departmentTotal: 0,
    users: [path.includes('page=2') ? { id: 'other', username: 'D1411025', fullName: '李四', departmentName: '质量保证部' } : { id: 'person', username: 'D1411024', fullName: '张三', departmentName: '质量保证部' }], userTotal: 21, pageSize: 20 }) as Result);
  const request: EightDRead = async <Result,>(path: string) => await read(path) as Result;
  render(<LanguageProvider><EightDAssignmentPicker report={report} read={request} collaborators={false} disabled={false} section="" onSection={vi.fn()} selected={['person']} onSelect={vi.fn()} domain={domain} /></LanguageProvider>);
  await screen.findByRole('option', { name: '张三 / 质量保证部（D1411024）' });
  fireEvent.click(screen.getByTitle('2'));
  await waitFor(() => expect(read.mock.calls.some(([path]) => new URL(path, 'http://localhost').searchParams.get('page') === '2')).toBe(true));
  await waitFor(() => expect(screen.getByRole('combobox', { name: '新负责人' })).toHaveValue('person'));
  expect(screen.getByRole('option', { name: '张三 / 质量保证部（D1411024）', selected: true })).toHaveValue('person');
  act(() => { useWorkTabsStore.getState().bindSession('other'); useWorkTabsStore.getState().bindSession('picker-session'); });
  expect(screen.queryByRole('combobox', { name: '新负责人' })).not.toBeInTheDocument();
  expect(screen.getByText('会话已变化，请重新打开操作。')).toBeVisible();
});
