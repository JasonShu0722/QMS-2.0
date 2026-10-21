import { useEffect, useId, useRef, useState, type Key } from 'react';
import {
  Alert, Button, Checkbox, Dropdown, Form, Input, Modal, Radio,
  Segmented, Select, Switch, Table, Tabs, Tag, Tooltip,
} from 'antd';
import { ArrowLeft, Copy, Ellipsis, HelpCircle, Plus, Save, Search, Trash2 } from 'lucide-react';

type ReviewMode = 'unified' | 'individual';
type SampleRecord = { title: string; owner: string; description: string };

export function BasicExamples({ english }: { english: boolean }) {
  const pick = (zh: string, en: string) => english ? en : zh;
  const fieldId = useId();
  const [saveFails, setSaveFails] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error' | 'success'>('idle');
  const [action, setAction] = useState('');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    if (modalTimer.current !== null) clearTimeout(modalTimer.current);
  }, []);

  const [instant, setInstant] = useState(true);
  const [reviewDraft, setReviewDraft] = useState<ReviewMode>('unified');
  const [reviewApplied, setReviewApplied] = useState<ReviewMode>('unified');
  const [remindDraft, setRemindDraft] = useState(true);
  const [remindApplied, setRemindApplied] = useState(true);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [view, setView] = useState('list');
  const [query, setQuery] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);
  const [assignedCount, setAssignedCount] = useState(0);

  const initialRecord: SampleRecord = {
    title: pick('来料尺寸偏差', 'Incoming dimension deviation'), owner: 'lin', description: '',
  };
  const [savedRecord, setSavedRecord] = useState<SampleRecord | null>(null);
  const [draft, setDraft] = useState<SampleRecord | null>(null);
  const [editBaseline, setEditBaseline] = useState<SampleRecord | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [modalFails, setModalFails] = useState(false);
  const [modalConflicts, setModalConflicts] = useState(false);
  const [modalState, setModalState] = useState<'idle' | 'saving' | 'invalid' | 'error' | 'conflict' | 'success'>('idle');
  const [invalidField, setInvalidField] = useState<'title' | 'owner' | null>(null);
  const dirty = draft !== null && editBaseline !== null && (
    draft.title !== editBaseline.title || draft.owner !== editBaseline.owner || draft.description !== editBaseline.description
  );
  const modalBusy = modalState === 'saving';
  const settingsDirty = reviewDraft !== reviewApplied || remindDraft !== remindApplied;
  const reviewName = (mode: ReviewMode) => mode === 'unified'
    ? pick('统一审核', 'Unified review') : pick('逐项审核', 'Individual review');
  const rows = [
    { key: 'sample-001', number: 'DEMO-001', title: pick('来料尺寸偏差', 'Incoming dimension deviation'), status: pick('待分析', 'Awaiting analysis') },
    { key: 'sample-002', number: 'DEMO-002', title: pick('包装标签缺失', 'Missing packaging label'), status: pick('待补充', 'Needs information') },
    { key: 'sample-003', number: 'DEMO-003', title: pick('装配间隙异常', 'Assembly gap deviation'), status: pick('处理中', 'In progress') },
  ];
  const filteredRows = rows.filter(row => `${row.number} ${row.title} ${row.status}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const visibleSelectedKeys = selectedKeys.filter(key => filteredRows.some(row => row.key === key));
  const actionMessages: Record<string, string> = {
    create: pick('已在当前页面演示新建入口，未创建业务记录。', 'Create action previewed on this page; no business record was created.'),
    cancel: pick('已取消当前动作样例。', 'The sample action was cancelled.'),
    back: pick('返回动作样例：此独立页面没有业务导航历史。', 'Back action preview: this standalone page has no business navigation history.'),
    help: pick('图标动作样例：用于相邻操作的补充帮助。', 'Icon action preview: show contextual help for nearby actions.'),
    remove: pick('危险动作样例：未删除任何记录。', 'Danger action preview: no records were deleted.'),
    copy: pick('复制动作样例：未写入剪贴板或导出数据。', 'Copy action preview: no clipboard writes or data exports occurred.'),
    long: pick('长文案动作已触发，仅演示反馈与自然换行。', 'Long-label action triggered; this only demonstrates feedback and wrapping.'),
  };

  function saveSample() {
    if (saveTimer.current !== null) return;
    setSaveState('saving');
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      setSaveState(saveFails ? 'error' : 'success');
    }, 400);
  }

  function requestClose() {
    if (modalTimer.current !== null || discardOpen) return;
    if (dirty) setDiscardOpen(true);
    else setDraft(null);
  }

  function saveModal() {
    if (!draft || modalTimer.current !== null || discardOpen) return;
    if (!draft.title.trim() || !draft.owner) {
      const field = !draft.title.trim() ? 'title' : 'owner';
      setInvalidField(field);
      setModalState('invalid');
      document.getElementById(`${fieldId}-${field}`)?.focus();
      return;
    }
    setInvalidField(null);
    setModalState('saving');
    const pendingRecord = { ...draft, title: draft.title.trim() };
    modalTimer.current = setTimeout(() => {
      modalTimer.current = null;
      if (modalConflicts || modalFails) {
        setModalState(modalConflicts ? 'conflict' : 'error');
        return;
      }
      setSavedRecord(pendingRecord);
      setModalState('success');
      setDraft(null);
    }, 400);
  }

  return <>
    <section id="sample-01" className="preview-section" aria-label={pick('S01 按钮与动作层级', 'S01 Buttons and action hierarchy')}>
      <div className="preview-section-heading"><div>
        <h2>{pick('S01 按钮与动作层级', 'S01 Buttons and action hierarchy')}</h2>
        <p>{pick('一个操作区突出一个完成动作，次要、危险与低频动作保留清晰边界。', 'Emphasize one completion action per area, with clear secondary, danger and infrequent actions.')}</p>
      </div></div>
      <div className="preview-split">
        <div className="preview-example">
          <h3>{pick('动作层级与更多菜单', 'Action hierarchy and overflow menu')}</h3>
          <p className="preview-note">{pick('新建是当前主动作；取消、返回与帮助使用较轻层级。危险动作只演示意图。', 'Create is primary; cancel, back and help have less emphasis. The danger action only previews intent.')}</p>
          <div className="preview-actions">
            <Button type="primary" icon={<Plus size={16} aria-hidden="true" />} onClick={() => setAction('create')}>{pick('新建样例', 'Create sample')}</Button>
            <Button onClick={() => setAction('cancel')}>{pick('取消动作', 'Cancel action')}</Button>
            <Button type="text" icon={<ArrowLeft size={16} aria-hidden="true" />} onClick={() => setAction('back')}>{pick('返回', 'Back')}</Button>
            <Button danger icon={<Trash2 size={16} aria-hidden="true" />} onClick={() => setAction('remove')}>{pick('删除样例演示', 'Preview sample deletion')}</Button>
            <Tooltip title={pick('查看样例帮助', 'View sample help')}>
              <Button aria-label={pick('查看样例帮助', 'View sample help')} icon={<HelpCircle size={16} aria-hidden="true" />} onClick={() => setAction('help')} />
            </Tooltip>
            <Dropdown trigger={['click']} menu={{
              items: [
                { key: 'copy', label: pick('复制样例演示', 'Preview sample copy'), icon: <Copy size={16} aria-hidden="true" /> },
                { key: 'remove', label: pick('删除样例演示', 'Preview sample deletion'), danger: true, icon: <Trash2 size={16} aria-hidden="true" /> },
              ],
              onClick: ({ key }) => setAction(key),
            }}>
              <Button icon={<Ellipsis size={16} aria-hidden="true" />}>{pick('更多动作', 'More actions')}</Button>
            </Dropdown>
          </div>
          <div role="status" aria-live="polite">{action ? <p className="preview-note">{actionMessages[action]}</p> : null}</div>
          <p className="preview-note">{pick('行内操作适合当前记录，低频动作进入菜单；不要把唯一保存入口藏进“更多”。', 'Row actions target the current record; infrequent actions belong in the menu. Keep the only save action visible.')}</p>
        </div>
        <div className="preview-example">
          <h3>{pick('异步、禁用与长文案', 'Async, disabled and long labels')}</h3>
          <p className="preview-note">{pick('保存等待 400 ms；失败保留当前内容，取消模拟失败后可原地重试。', 'Saving waits 400 ms. Failure preserves page content; turn off simulated failure to retry here.')}</p>
          <div className="preview-actions">
            <Checkbox checked={saveFails} disabled={saveState === 'saving'} onChange={event => setSaveFails(event.target.checked)}>{pick('模拟保存失败', 'Simulate save failure')}</Checkbox>
            <Button type="primary" icon={<Save size={16} aria-hidden="true" />} loading={saveState === 'saving'} disabled={saveState === 'saving'} onClick={saveSample}>{pick('保存样例', 'Save sample')}</Button>
            <Button disabled aria-describedby={`${fieldId}-disabled-reason`}>{pick('提交业务记录', 'Submit business record')}</Button>
          </div>
          <p id={`${fieldId}-disabled-reason`} className="preview-note">{pick('禁用原因：独立样例不连接业务服务，不能提交真实记录。', 'Disabled: this standalone sample has no business service connection and cannot submit real records.')}</p>
          <Button style={{ height: 'auto', paddingBlock: 6, whiteSpace: 'normal', maxWidth: '100%' }} onClick={() => setAction('long')}>
            {pick('查看当前筛选范围内全部样例记录的处理说明', 'View processing guidance for all sample records in the current filter scope')}
          </Button>
          <div role="status" aria-live="polite" aria-busy={saveState === 'saving'}>
            {saveState === 'saving' && <p className="preview-note">{pick('正在保存本地样例，请稍候。', 'Saving the local sample, please wait.')}</p>}
            {saveState === 'error' && <Alert type="error" showIcon title={pick('样例保存失败，内容已保留。', 'Sample save failed. Content has been preserved.')} />}
            {saveState === 'success' && <Alert type="success" showIcon title={pick('样例保存完成，仅保存在当前页面。', 'Sample saved on this page only.')} />}
          </div>
        </div>
      </div>
    </section>

    <section id="sample-02" className="preview-section" aria-label={pick('S02 选择与切换', 'S02 Selection and switching')}>
      <div className="preview-section-heading"><div>
        <h2>{pick('S02 选择与切换', 'S02 Selection and switching')}</h2>
        <p>{pick('立即生效、保存后生效、视图切换和内容导航使用不同控件与反馈。', 'Immediate settings, saved choices, view switches and content navigation each use distinct controls and feedback.')}</p>
      </div></div>
      <div className="preview-split">
        <div className="preview-example">
          <h3>{pick('立即开关与待保存选择', 'Immediate switch and pending choices')}</h3>
          <p className="preview-note">{pick('Switch 立即改变本页显示；Radio 与 Checkbox 仅修改草稿，点击保存设置才生效。', 'The switch immediately changes this page. Radio and checkbox choices remain drafts until you save settings.')}</p>
          <div className="preview-actions">
            <Switch checked={instant} onChange={setInstant} aria-label={pick('立即显示样例提醒', 'Show sample reminders immediately')} />
            <span>{pick('立即显示样例提醒', 'Show sample reminders immediately')}</span>
            <Tag color={instant ? 'success' : 'default'}>{instant ? pick('本地已开启', 'Enabled locally') : pick('本地已关闭', 'Disabled locally')}</Tag>
          </div>
          <div role="status"><p className="preview-note">{instant ? pick('样例提醒现在可见；仅本页立即生效。', 'Sample reminders are visible now; this applies immediately on this page only.') : pick('样例提醒已隐藏；仅本页立即生效。', 'Sample reminders are hidden; this applies immediately on this page only.')}</p></div>
          <Radio.Group aria-label={pick('审核方式草稿', 'Draft review method')} value={reviewDraft} onChange={event => { setReviewDraft(event.target.value as ReviewMode); setSettingsSaved(false); }}>
            <Radio value="unified">{pick('统一审核', 'Unified review')}</Radio>
            <Radio value="individual">{pick('逐项审核', 'Individual review')}</Radio>
          </Radio.Group>
          <div className="preview-actions">
            <Checkbox checked={remindDraft} onChange={event => { setRemindDraft(event.target.checked); setSettingsSaved(false); }}>{pick('提醒我查看审核结果', 'Remind me to view review results')}</Checkbox>
            <Button type="primary" disabled={!settingsDirty} onClick={() => { setReviewApplied(reviewDraft); setRemindApplied(remindDraft); setSettingsSaved(true); }}>{pick('保存设置', 'Save settings')}</Button>
          </div>
          <div role="status" aria-live="polite">
            <p>{pick('当前生效：', 'Currently applied: ')}{reviewName(reviewApplied)}</p>
            <p className="preview-note">{remindApplied ? pick('结果提醒：开启', 'Result reminders: enabled') : pick('结果提醒：关闭', 'Result reminders: disabled')}</p>
            <p className="preview-note">{settingsDirty ? pick('存在待保存选择，当前生效值尚未改变。', 'Choices are pending; the applied settings have not changed.') : settingsSaved ? pick('样例设置已在当前页面生效，刷新后不保留。', 'Sample settings now apply on this page; they do not survive a refresh.') : pick('尚未修改设置；所有状态仅限当前页面。', 'No pending changes; all settings are limited to this page.')}</p>
          </div>
        </div>
        <div className="preview-example">
          <h3>{pick('视图切换与内容分区', 'View switching and content sections')}</h3>
          <p className="preview-note">{pick('Segmented 改变同一组记录的排布；Tabs 切换对象的不同内容，不产生保存请求。', 'Segmented changes the layout of the same records; tabs show different object content. Neither sends a save request.')}</p>
          <Segmented aria-label={pick('样例记录视图', 'Sample record view')} value={view} onChange={value => setView(String(value))} options={[
            { value: 'list', label: pick('列表视图', 'List view') },
            { value: 'cards', label: pick('卡片视图', 'Card view') },
          ]} />
          {view === 'list' ? <ul aria-label={pick('列表视图记录', 'List view records')}>
            {rows.map(row => <li key={row.key}><strong>{row.number}</strong> · {row.title} <Tag>{row.status}</Tag></li>)}
          </ul> : <div className="preview-split" aria-label={pick('卡片视图记录', 'Card view records')}>
            {rows.map(row => <article className="preview-example" key={row.key}><Tag>{row.number}</Tag><h4>{row.title}</h4><p>{row.status}</p></article>)}
          </div>}
          <Tabs items={[
            { key: 'facts', label: pick('问题事实', 'Problem facts'), children: <p>{pick('示例事实：首件抽检发现尺寸偏差，尚待分析原因。', 'Sample fact: a first-piece inspection found a dimensional deviation; the cause is awaiting analysis.')}</p> },
            { key: 'history', label: pick('处理记录', 'Processing history'), children: <p>{pick('示例记录：已登记问题，尚无已提交的处理结论。', 'Sample history: the problem has been recorded; no processing conclusion has been submitted.')}</p> },
          ]} />
        </div>
      </div>
    </section>

    <section id="sample-03" className="preview-section" aria-label={pick('S03 工具栏与批量操作', 'S03 Toolbar and bulk actions')}>
      <div className="preview-section-heading"><div>
        <h2>{pick('S03 工具栏与批量操作', 'S03 Toolbar and bulk actions')}</h2>
        <p>{pick('查询、结果数与选中范围同时可见；批量操作只针对当前页明确选中的样例。', 'Keep search, result count and selection scope visible. Bulk actions target only explicitly selected samples on this page.')}</p>
      </div></div>
      <div className="preview-example">
        <h3>{pick('筛选结果与当前页选择', 'Filtered results and current-page selection')}</h3>
        <p className="preview-note">{pick('共三条虚构问题；支持按编号、标题或状态查找。更改筛选会清除选择，避免误操作隐藏记录。', 'Three fictional problems: search by number, title or status. Changing the filter clears selection to avoid acting on hidden records.')}</p>
        <div className="preview-actions">
          <Input aria-label={pick('查找样例问题', 'Find sample problems')} placeholder={pick('编号、标题或状态', 'Number, title or status')} prefix={<Search size={16} aria-hidden="true" />} allowClear value={query} style={{ width: 320, maxWidth: '100%' }} onChange={event => { setQuery(event.target.value); setSelectedKeys([]); setAssignedCount(0); }} />
          <Button disabled={!query} onClick={() => { setQuery(''); setSelectedKeys([]); setAssignedCount(0); }}>{pick('清除筛选', 'Clear filters')}</Button>
          <Tag>{pick(`结果 ${filteredRows.length} / 3`, `Results ${filteredRows.length} / 3`)}</Tag>
        </div>
        <p className="preview-note">{query.trim() ? pick(`当前筛选：${query.trim()}`, `Current filter: ${query.trim()}`) : pick('当前筛选：全部三条样例', 'Current filter: all three samples')}</p>
        <div className="preview-actions">
          <span role="status" aria-live="polite">{pick(`已选当前页 ${visibleSelectedKeys.length} 条`, `${visibleSelectedKeys.length} selected on this page`)}</span>
          <Button disabled={visibleSelectedKeys.length === 0} onClick={() => setSelectedKeys([])}>{pick('清除选择', 'Clear selection')}</Button>
          <Button type="primary" disabled={visibleSelectedKeys.length === 0} onClick={() => { setAssignedCount(visibleSelectedKeys.length); setSelectedKeys([]); }}>{pick('批量分派样例', 'Preview bulk assignment')}</Button>
        </div>
        <Table rowKey="key" dataSource={filteredRows} pagination={false} scroll={{ x: 560 }}
          rowSelection={{
            selectedRowKeys: visibleSelectedKeys,
            onChange: keys => { setSelectedKeys(keys); setAssignedCount(0); },
            getCheckboxProps: row => ({ 'aria-label': pick(`选择样例 ${row.number}`, `Select sample ${row.number}`) }),
            getTitleCheckboxProps: () => ({ 'aria-label': pick('选择当前页全部样例', 'Select all samples on this page') }),
          }}
          columns={[
            { title: pick('样例编号', 'Sample number'), dataIndex: 'number', width: 130 },
            { title: pick('问题标题', 'Problem title'), dataIndex: 'title' },
            { title: pick('状态', 'Status'), dataIndex: 'status', width: 150, render: (status: string) => <Tag>{status}</Tag> },
          ]}
          locale={{ emptyText: pick('没有匹配样例，请清除或调整筛选。', 'No matching samples. Clear or adjust the filter.'), selectAll: pick('选择当前页全部样例', 'Select all samples on this page'), selectNone: pick('清除选择', 'Clear selection'), selectInvert: pick('反选当前页', 'Invert current-page selection') }} />
        <p className="preview-note">{pick('范围：仅当前页选中项，无跨页或全量选择；批量分派只演示结果，不创建任务、不发消息。', 'Scope: selected rows on this page only, with no cross-page or full-dataset selection. Assignment only previews a result; it creates no tasks or messages.')}</p>
        <div role="status" aria-live="polite">{assignedCount > 0 && <Alert type="info" showIcon title={pick(`已演示分派 ${assignedCount} 条样例，未创建真实任务。`, `Assignment previewed for ${assignedCount} samples. No real tasks were created.`)} />}</div>
      </div>
    </section>

    <section id="sample-04" className="preview-section" aria-label={pick('S04 表单与弹窗', 'S04 Forms and dialogs')}>
      <div className="preview-section-heading"><div>
        <h2>{pick('S04 表单与弹窗', 'S04 Forms and dialogs')}</h2>
        <p>{pick('字段先校验再保存；未保存关闭需要确认，失败或冲突保留原输入。', 'Validate fields before saving. Confirm before discarding changes, and preserve input after failures or conflicts.')}</p>
      </div></div>
      <div className="preview-example">
        <h3>{pick('编辑、关闭保护与保存反馈', 'Editing, close protection and save feedback')}</h3>
        <p className="preview-note">{pick('取消、遮罩、Esc 与右上角关闭采用同一保护；保存中的 400 ms 内不能关闭。关闭后焦点返回打开按钮。', 'Cancel, mask, Escape and the close button share one protection rule. Closing is blocked during the 400 ms save. Focus returns to the opening button afterwards.')}</p>
        <Button type="primary" onClick={() => { const record = savedRecord ?? initialRecord; setEditBaseline(record); setDraft({ ...record }); setModalState('idle'); setInvalidField(null); setDiscardOpen(false); setModalFails(false); setModalConflicts(false); }}>{pick('打开编辑弹窗', 'Open edit dialog')}</Button>
        <div role="status" aria-live="polite">{modalState === 'success' && <Alert type="success" showIcon title={pick('样例记录已保存，仅保存在当前页面。', 'Sample record saved on this page only.')} />}</div>
        <p className="preview-note">{pick('适用于短表单；复杂流程应保留完整处理空间。此处不连接 API，刷新会丢失本页样例状态。', 'Suitable for short forms; complex workflows need a full workspace. This sample has no API connection, and a refresh clears its state.')}</p>
      </div>
      <Modal rootClassName="preview-modal" open={draft !== null} title={pick('编辑示例记录', 'Edit sample record')} onCancel={requestClose}
        closable={{ disabled: modalBusy || discardOpen, 'aria-label': pick('关闭编辑弹窗', 'Close edit dialog') }}
        keyboard={!modalBusy && !discardOpen} mask={{ closable: !modalBusy && !discardOpen }}
        focusable={{ trap: !discardOpen, focusTriggerAfterClose: true }}
        footer={<div className="preview-actions">
          <Button disabled={modalBusy || discardOpen} onClick={requestClose}>{pick('取消', 'Cancel')}</Button>
          <Button type="primary" loading={modalBusy} disabled={modalBusy || discardOpen} icon={<Save size={16} aria-hidden="true" />} onClick={saveModal}>{pick('保存样例记录', 'Save sample record')}</Button>
        </div>}>
        {draft && <Form layout="vertical" onFinish={saveModal} aria-label={pick('示例记录表单', 'Sample record form')} aria-busy={modalBusy}>
          <p className="preview-note">{pick('示例编号 DEMO-001 · 只读；以下输入仅供当前页面演示。', 'Sample DEMO-001 · read-only identifier; the fields below are for this page only.')}</p>
          <Tag>{dirty ? pick('有未保存修改', 'Unsaved changes') : pick('尚未修改', 'No changes')}</Tag>
          <Form.Item label={pick('问题标题', 'Problem title')} htmlFor={`${fieldId}-title`} required validateStatus={invalidField === 'title' ? 'error' : undefined} help={invalidField === 'title' ? pick('请输入问题标题，不能仅包含空格。', 'Enter a problem title; spaces alone are not valid.') : undefined}>
            <Input id={`${fieldId}-title`} value={draft.title} maxLength={120} disabled={modalBusy || discardOpen} autoFocus aria-required="true" aria-invalid={invalidField === 'title'} onChange={event => { setDraft({ ...draft, title: event.target.value }); setInvalidField(null); setModalState('idle'); }} />
          </Form.Item>
          <Form.Item label={pick('责任人', 'Owner')} htmlFor={`${fieldId}-owner`} required validateStatus={invalidField === 'owner' ? 'error' : undefined} help={invalidField === 'owner' ? pick('请选择样例责任人。', 'Select a sample owner.') : undefined}>
            <Select id={`${fieldId}-owner`} value={draft.owner || undefined} allowClear disabled={modalBusy || discardOpen} aria-required="true" aria-invalid={invalidField === 'owner'} placeholder={pick('请选择样例责任人', 'Select a sample owner')} options={[
              { value: 'lin', label: pick('林工（样例）', 'Engineer Lin (sample)') },
              { value: 'chen', label: pick('陈工（样例）', 'Engineer Chen (sample)') },
            ]} onChange={value => { setDraft({ ...draft, owner: value ?? '' }); setInvalidField(null); setModalState('idle'); }} />
          </Form.Item>
          <Form.Item label={pick('说明', 'Description')} htmlFor={`${fieldId}-description`}>
            <Input.TextArea id={`${fieldId}-description`} value={draft.description} rows={3} maxLength={500} disabled={modalBusy || discardOpen} placeholder={pick('填写样例说明，不输入真实业务数据。', 'Add sample notes without real business data.')} onChange={event => { setDraft({ ...draft, description: event.target.value }); setModalState('idle'); }} />
          </Form.Item>
          <div className="preview-actions">
            <Checkbox checked={modalFails} disabled={modalBusy || discardOpen} onChange={event => setModalFails(event.target.checked)}>{pick('模拟记录保存失败', 'Simulate record save failure')}</Checkbox>
            <Checkbox checked={modalConflicts} disabled={modalBusy || discardOpen} onChange={event => setModalConflicts(event.target.checked)}>{pick('模拟版本冲突', 'Simulate version conflict')}</Checkbox>
          </div>
          <p className="preview-note">{pick('冲突优先于一般失败；取消模拟后可重试，不会覆盖真实记录。', 'Conflict takes precedence over general failure. Turn off simulation to retry; no real record is overwritten.')}</p>
          <div role="status" aria-live="polite">
            {modalBusy && <p>{pick('正在保存本页样例，暂时不能关闭或重复保存。', 'Saving this page’s sample; closing and duplicate saves are temporarily blocked.')}</p>}
            {modalState === 'invalid' && <Alert type="error" showIcon title={pick('请检查必填字段，输入内容已保留。', 'Check the required fields. Your input has been preserved.')} />}
            {modalState === 'error' && <Alert type="error" showIcon title={pick('样例记录保存失败，输入已保留，可重试。', 'Sample record save failed. Input has been preserved; you can retry.')} />}
            {modalState === 'conflict' && <Alert type="warning" showIcon title={pick('样例版本冲突，输入已保留，未覆盖任何记录。', 'Sample version conflict. Input has been preserved and no records were overwritten.')} />}
          </div>
        </Form>}
      </Modal>
      <Modal rootClassName="preview-modal" open={discardOpen} title={pick('放弃未保存的修改？', 'Discard unsaved changes?')}
        onCancel={() => setDiscardOpen(false)} mask={{ closable: false }}
        closable={{ 'aria-label': pick('继续编辑并关闭确认', 'Continue editing and close confirmation') }}
        footer={<div className="preview-actions">
          <Button type="primary" onClick={() => setDiscardOpen(false)}>{pick('继续编辑', 'Continue editing')}</Button>
          <Button danger onClick={() => { setDiscardOpen(false); setDraft(null); setModalState('idle'); setInvalidField(null); }}>{pick('放弃修改', 'Discard changes')}</Button>
        </div>}>
        <p>{pick('放弃后将丢失这次未保存的输入；继续编辑会完整保留。已保存的本页样例不受影响。', 'Discarding loses these unsaved edits; continuing preserves all input. The previously saved sample on this page is retained.')}</p>
      </Modal>
    </section>
  </>;
}
