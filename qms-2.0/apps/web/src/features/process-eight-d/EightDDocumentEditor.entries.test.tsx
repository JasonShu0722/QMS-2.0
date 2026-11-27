import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState, type ComponentProps } from 'react';
import { expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { EightDDocumentEditor } from './EightDDocumentEditor';
import type { EightDDocument } from './eight-d';

const containment = { id: 'position', group: 'PCBA', location: '在制品', quantity: null, measure: '', owner: '', plannedAt: null, completion: '', ngQuantity: null };
const standard = { id: 'SOP', key: 'SOP', documentName: 'SOP 标准作业指导书', needsUpdate: null, departmentOwner: '', plannedAt: null, completedAt: null, status: '', reason: '' };
const deployment = { id: 'deployment', scope: '', owner: '', completion: '', action: '', inspectionResult: '', fileIds: ['deployment-file'] };
const action = { id: 'action', causeKind: 'OCCURRENCE' as const, action: '', owner: '', plannedAt: null, verificationMethod: '', fileIds: [], implementationAt: null, result: '', beforeState: '', afterState: '', firstBatch: '', followUpBatchCount: null, followUpDuration: '', verificationRecord: '', verificationFileIds: [], effective: null };
const empty: EightDDocument = {
  description: '', okFileIds: [], ngFileIds: [], temporaryMeasures: [], containment: [], optionalAffectedContainment: [],
  analysisProcess: '', analysisFileIds: [], occurrenceCause: '', escapeCause: '', systemCause: '', correctiveActions: [],
  horizontalDeployment: [], standardization: [], closureSummary: '',
};

function mount(document: Partial<EightDDocument>, props: Partial<ComponentProps<typeof EightDDocumentEditor>> = {}) {
  const changed = vi.fn();
  function Draft() {
    const [draft, setDraft] = useState({ ...empty, ...document });
    return <EightDDocumentEditor problemId="entry-test" document={draft} disabled={false} read={vi.fn()} overview={null}
      onChange={change => { changed(); setDraft(change); }} {...props} />;
  }
  render(<LanguageProvider><Draft /></LanguageProvider>);
  return changed;
}

function chapter(id: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${id} ·`) }));
}

function button(name: string | RegExp) {
  return screen.getByRole('button', { name });
}

it('renders the injected process source summary before D2 description and evidence', () => {
  mount({}, { sourceSummary: <p>来源事实</p> });
  const source = screen.getByText('来源事实');
  const description = screen.getByLabelText('D2 问题描述');
  expect(source.compareDocumentPosition(description)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  expect(source.closest('section')).toContainElement(screen.getByLabelText('OK 图片说明'));
});

it('edits targeted D3 containment in its row without expanding details', () => {
  mount({ containment: [{ ...containment, quantity: 0, measure: '批次隔离', owner: '值班员', completion: '已隔离' }] }, { chapterTarget: { section: 'D3', row: 'containment[0]' } });
  const list = screen.getByRole('region', { name: '本次问题围堵' });
  const row = within(list).getByRole('textbox', { name: '本次问题围堵 1 措施' }).closest('tr')!;
  expect(within(row).getByDisplayValue('0')).toBeVisible();
  expect(within(row).getByDisplayValue('批次隔离')).toBeVisible();
  expect(within(row).getByDisplayValue('值班员')).toBeVisible();
  expect(within(row).getByDisplayValue('已隔离')).toBeVisible();
  expect(within(list).getByRole('textbox', { name: '本次问题围堵 1 措施' })).toBeVisible();
  expect(within(list).queryByRole('button', { name: /详情/ })).not.toBeInTheDocument();
});

it('removes a default-only containment row and dismisses an unselected suggestion without saving it', () => {
  const changed = mount({ containment: [containment] });
  chapter('D3');
  const list = within(screen.getByRole('region', { name: '本次问题围堵' }));
  fireEvent.click(list.getByRole('button', { name: '移除本次问题围堵 1' }));
  expect(changed).toHaveBeenCalledTimes(1);
  expect(list.queryByRole('checkbox', { name: '本次问题围堵 PCBA 在制品' })).not.toBeInTheDocument();
  fireEvent.click(list.getByRole('button', { name: '移除本次问题围堵 1' }));
  expect(changed).toHaveBeenCalledTimes(1);
  expect(list.queryByRole('checkbox', { name: '本次问题围堵 PCBA 智新库存' })).not.toBeInTheDocument();
  expect(screen.queryByText('此条目已有内容，确定删除？')).not.toBeInTheDocument();
});

it('keeps zero as containment content and guards removal through the selection checkbox', async () => {
  const changed = mount({ optionalAffectedContainment: [{ ...containment, quantity: 0 }] });
  chapter('D3');
  const disclosure = screen.getByText('潜在影响围堵（可选）').closest('details')!;
  expect(disclosure).not.toHaveAttribute('open');
  fireEvent.click(within(disclosure).getByText('潜在影响围堵（可选）'));
  const selection = screen.getByRole('checkbox', { name: '潜在影响围堵 PCBA 在制品' });
  fireEvent.click(selection);
  await screen.findByText('此条目已有内容，确定删除？');
  fireEvent.click(button('取消'));
  expect(changed).not.toHaveBeenCalled();
  expect(selection).toBeChecked();
});

it('suggests current team names in D3 and D5 without overwriting previous owner text', () => {
  const changed = mount({
    team: [{ id: 'member', name: '林工', department: '制程', responsibility: '', collaborationScope: '' }],
    containment: [{ ...containment, owner: '原责任人' }],
    correctiveActions: [{ ...action, owner: '原措施责任人' }],
  });
  chapter('D3');
  const containmentOwner = screen.getByLabelText('本次问题围堵 1 责任人') as HTMLInputElement;
  expect(containmentOwner.value).toBe('原责任人');
  expect(containmentOwner.list?.options[0]?.value).toBe('林工');
  chapter('D5');
  const actionOwner = screen.getByLabelText('措施 1 责任人') as HTMLInputElement;
  expect(actionOwner.value).toBe('原措施责任人');
  expect(actionOwner.list?.options[0]?.value).toBe('林工');
  fireEvent.change(actionOwner, { target: { value: '林工' } });
  expect(actionOwner).toHaveValue('林工');
  expect(changed).toHaveBeenCalledTimes(1);
});

it('removes an unchanged D5 action directly and confirms an explicit D6 conclusion', async () => {
  const changed = mount({ correctiveActions: [action, { ...action, id: 'verified', effective: false }] });
  chapter('D5');
  fireEvent.click(button('移除措施 1'));
  expect(changed).toHaveBeenCalledTimes(1);
  fireEvent.click(button('移除措施 1'));
  await screen.findByText('此条目已有内容，确定删除？');
  fireEvent.click(button('取消'));
  expect(changed).toHaveBeenCalledTimes(1);
  chapter('D6');
  expect(screen.getByLabelText('措施 1 人工有效性结论')).toHaveValue('false');
});

it('compares D5 plans and D6 results by action, and opens only the selected comparison and evidence', () => {
  mount({ correctiveActions: [
    { ...action, action: '校验治具', owner: '计划负责人', fileIds: ['plan-file'], beforeState: '10 / 100', afterState: '1 / 100', verificationFileIds: ['actual-file'] },
    { ...action, id: 'second', action: '复查批次', owner: '批次负责人', effective: false },
  ] });
  chapter('D5');
  const plans = within(screen.getByRole('region', { name: '措施计划清单' }));
  expect(plans.getByRole('columnheader', { name: '计划完成日期' })).toBeVisible();
  expect(plans.getByRole('textbox', { name: '措施 1 责任人' })).toHaveValue('计划负责人');
  expect(plans.getByRole('textbox', { name: '措施 2 责任人' })).toHaveValue('批次负责人');
  expect(plans.queryByText(/验证方法|选择依据|措施附件/)).not.toBeInTheDocument();
  expect(plans.queryByRole('button', { name: /详情/ })).not.toBeInTheDocument();
  fireEvent.change(plans.getByRole('textbox', { name: '措施 1 对策' }), { target: { value: '更换治具' } });
  expect(plans.getByRole('textbox', { name: '措施 2 对策' })).toHaveValue('复查批次');

  chapter('D6');
  const results = within(screen.getByRole('region', { name: '措施实绩清单' }));
  expect(results.getByRole('columnheader', { name: '有效性结论' })).toBeVisible();
  expect(results.getByRole('heading', { name: '措施 1 · 更换治具' })).toBeVisible();
  expect(results.getByRole('combobox', { name: '措施 2 人工有效性结论' })).toHaveValue('false');
  const secondResult = within(results.getByRole('button', { name: '详情 措施 2' }).closest('tr')!);
  expect(secondResult.getByText(/待填写：.*实施结果.*改善前.*改善后.*实际首批断点/)).toBeVisible();
  expect(results.getByText('验证附件 (1)')).not.toBeVisible();
  expect(results.queryByRole('button', { name: '移除措施 1' })).not.toBeInTheDocument();
  fireEvent.click(results.getByRole('button', { name: '详情 措施 1' }));
  const comparison = within(results.getByRole('group', { name: '改善前后对照' }));
  expect(comparison.getByRole('textbox', { name: '措施 1 改善前' })).toHaveValue('10 / 100');
  expect(comparison.getByRole('textbox', { name: '措施 1 改善后' })).toHaveValue('1 / 100');
  expect(results.getByText('验证附件 (1)')).toBeVisible();
  expect(results.queryByText('措施附件 (1)')).not.toBeInTheDocument();
});

it('opens a targeted D6 detail and keeps historical comparison and row evidence read-only', () => {
  const changed = mount({ correctiveActions: [
    { ...action, action: '批准时的对策', beforeState: '历史改善前', afterState: '历史改善后', firstBatch: '历史批次', verificationFileIds: ['history-file'], effective: false },
  ] }, { disabled: true, chapterTarget: { section: 'D6', row: 'correctiveActions[0]' } });
  const results = within(screen.getByRole('region', { name: '措施实绩清单' }));
  expect(results.getByRole('heading', { name: '措施 1 · 批准时的对策' })).toBeVisible();
  expect(results.getByDisplayValue('历史批次')).toBeVisible();
  expect(results.getByDisplayValue('历史改善前')).toBeDisabled();
  expect(results.getByDisplayValue('历史改善后')).toBeDisabled();
  expect(results.getByRole('cell', { name: '无效' })).toBeVisible();
  expect(results.queryByRole('combobox', { name: '措施 1 人工有效性结论' })).not.toBeInTheDocument();
  expect(results.getByText('验证附件 (1)')).toBeVisible();
  expect(screen.queryByRole('button', { name: /移除措施|增加永久措施/ })).not.toBeInTheDocument();
  expect(changed).not.toHaveBeenCalled();
});

it('shows D7 evidence in each row without detail or reason and only unlinks after confirmation', async () => {
  const changed = mount({ standardization: [standard], horizontalDeployment: [deployment] });
  chapter('D7');
  expect(screen.queryByRole('textbox', { name: /理由/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /详情/ })).not.toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: '标准化文件' })).getByText('标准化附件 (0)')).toBeVisible();
  expect(within(screen.getByRole('region', { name: '横向展开' })).getByText('展开附件 (1)')).toBeVisible();
  fireEvent.click(button('移除标准化文件 1'));
  expect(changed).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(standard.documentName)).not.toBeInTheDocument();
  expect(screen.getByText('展开附件 (1)')).toBeVisible();
  fireEvent.click(button('移除横向展开 1'));
  await screen.findByText(/从当前报告移除该条目的附件关联/);
  fireEvent.click(button('取消'));
  expect(changed).toHaveBeenCalledTimes(1);
  expect(screen.getByText('展开附件 (1)')).toBeVisible();
  fireEvent.click(button('移除横向展开 1'));
  fireEvent.click(await screen.findByRole('button', { name: '确认移除' }));
  expect(changed).toHaveBeenCalledTimes(2);
  expect(screen.queryByText('展开附件 (1)')).not.toBeInTheDocument();
});

it('presents historical D7 rows and evidence without editing or removing records', () => {
  const changed = mount({ horizontalDeployment: [{ ...deployment, inspectionResult: '历史排查' }] }, { disabled: true });
  chapter('D7');
  expect(screen.getByDisplayValue('历史排查')).toBeDisabled();
  expect(screen.getByText('展开附件 (1)')).toBeVisible();
  expect(screen.queryByRole('button', { name: /移除|增加/ })).not.toBeInTheDocument();
  expect(changed).not.toHaveBeenCalled();
});

it.each([
  { domain: 'customer' as const },
  { domain: 'new-product' as const },
  { portal: true, resource: { resourceType: 'supplier-quality', resourceId: 'entry-test' } },
  { resource: { resourceType: 'supplier-eight-d-supplement', resourceId: 'entry-test' } },
])('shares the chapter layouts but does not use process-specific owner suggestions for %j', props => {
  mount({
    team: [{ id: 'member', name: '林工', department: '', responsibility: '', collaborationScope: '' }],
    correctiveActions: [action],
    horizontalDeployment: [deployment],
    standardization: [standard],
  }, { ...props, mode: 'workspace', sourceSummary: <p>制程来源事实</p> });
  expect(screen.queryByText('制程来源事实')).not.toBeInTheDocument();
  chapter('D5');
  expect(screen.getByLabelText('措施 1 责任人')).not.toHaveAttribute('list');
  chapter('D7');
  const table = within(screen.getByRole('region', { name: '标准化文件' }));
  expect(table.getByRole('columnheader', { name: '附件' })).toBeVisible();
  expect(table.queryByRole('textbox', { name: /理由/ })).not.toBeInTheDocument();
  expect(screen.getByText('展开附件 (1)')).toBeVisible();
  expect(button('移除横向展开 1')).toBeVisible();
  expect(button('移除标准化文件 1')).toBeVisible();
});
