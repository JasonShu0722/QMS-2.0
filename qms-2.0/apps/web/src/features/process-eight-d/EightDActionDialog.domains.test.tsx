import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { LanguageProvider } from '../../i18n/Language';
import { EightDActionDialog } from './EightDActionDialog';
import type { EightDWrite } from './eight-d';
import type { InternalEightDSourcePickerProps } from '../internal-eight-d/source-picker';

const document: components['schemas']['ProcessEightDDocumentDto'] = {
  description: '', okFileIds: [], ngFileIds: [], temporaryMeasures: [], containment: [], optionalAffectedContainment: [], analysisProcess: '', analysisFileIds: [], occurrenceCause: '', escapeCause: '', systemCause: '', correctiveActions: [], horizontalDeployment: [], standardization: [], closureSummary: '',
};
const report: components['schemas']['CustomerEightDReportDto'] = {
  problemId: 'p1', reportNumber: '8D-001', organizationId: 'org1', instanceId: 'i1', workflowVersionId: 'w1', instanceVersion: 3, problemVersion: 2,
  version: 7, contentVersion: 4, status: 'PROCESSING', severity: 'MEDIUM', ownerUserId: 'owner', professionalUserId: 'reviewer', responsibleSectionDepartmentId: 'section', collaboratorUserIds: [], document,
  analysisCompletedAt: null, analysisDueAt: null, submissionDueAt: null, closureDueAt: null, submittedAt: null, closedRevisionId: null, allowedActions: ['sources'], sources: [], revisions: [],
};
const change = { add: [{ sourceId: 'source2', expectedVersion: 3 }], removeSourceIds: [], primarySourceId: 'source2', sourceConfirmations: [] };

it.each(['customer', 'new-product'] as const)('%s rejects stale source callbacks after baseline refresh, freezing and unmount', async domain => {
  const calls: InternalEightDSourcePickerProps[] = [];
  const dirty = vi.fn(); const write = vi.fn<EightDWrite>(async () => true);
  const picker = (props: InternalEightDSourcePickerProps) => { calls.push(props); return <p>Explicit source picker</p>; };
  const content = (version: number, frozen = false) => <LanguageProvider><EightDActionDialog domain={domain} action="sources" report={{ ...report, version }} read={vi.fn()} write={write} frozen={frozen} busy={false} onClose={vi.fn()} onDirty={dirty} renderSourcePicker={picker} /></LanguageProvider>;
  const view = render(content(7)); await screen.findByText('Explicit source picker');
  const original = calls.at(-1)!;
  act(() => original.onChange(change));
  expect(dirty).toHaveBeenCalledTimes(1);
  view.rerender(content(8));
  await waitFor(() => expect(screen.getByRole('button', { name: '确认提交' })).toBeDisabled());
  act(() => original.onChange(change));
  expect(screen.getByRole('button', { name: '确认提交' })).toBeDisabled();
  const refreshed = calls.at(-1)!;
  view.rerender(content(8, true)); act(() => refreshed.onChange(change));
  view.rerender(content(8));
  expect(screen.getByRole('button', { name: '确认提交' })).toBeDisabled();
  view.unmount(); act(() => calls.at(-1)!.onChange(change));
  expect(dirty).toHaveBeenCalledTimes(1); expect(write).not.toHaveBeenCalled();
});

it.each(['customer', 'new-product'] as const)('%s requires explicit whole-round cancellation and never rewrites a closed primary', async domain => {
  let props!: InternalEightDSourcePickerProps;
  const write = vi.fn<EightDWrite>(async () => true);
  const picker = (value: InternalEightDSourcePickerProps) => { props = value; return <p>Explicit source picker</p>; };
  const content = (status: string, closedRevisionId: string | null) => <LanguageProvider><EightDActionDialog domain={domain} action="sources" report={{ ...report, status, closedRevisionId }} read={vi.fn()} write={write} frozen={false} busy={false} onClose={vi.fn()} onDirty={vi.fn()} renderSourcePicker={picker} /></LanguageProvider>;
  const view = render(content('IN_REVIEW', null)); await screen.findByText('Explicit source picker');
  act(() => props.onChange(change));
  fireEvent.change(screen.getByLabelText('变更 / 申请理由'), { target: { value: 'Confirmed change' } });
  expect(screen.getByRole('button', { name: '确认提交' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: '我确认取消当前整轮审批后变更' }));
  fireEvent.click(screen.getByRole('button', { name: '确认提交' }));
  await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  expect(write.mock.calls[0][2]).toMatchObject({ confirmCancelApproval: true });
  view.unmount(); write.mockClear();
  render(content('CLOSED', 'revision1')); await screen.findByText('Explicit source picker');
  expect(props.report.closedRevisionId).toBe('revision1');
  act(() => props.onChange({ ...change, primarySourceId: undefined }));
  fireEvent.change(screen.getByLabelText('变更 / 申请理由'), { target: { value: 'Post-closure supplement' } });
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认提交' }));
  await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  expect(write.mock.calls[0][2]).toMatchObject({ add: change.add, removeSourceIds: [], confirmCancelApproval: false });
  expect(JSON.stringify(write.mock.calls[0][2])).not.toContain('primarySourceId');
});
