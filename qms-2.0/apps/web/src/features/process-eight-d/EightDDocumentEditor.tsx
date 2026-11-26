import { Button, Modal, Popconfirm, Space } from 'antd';
import type { components } from '@qms/contracts';
import { Fragment, useId, useRef, useState, type ReactNode } from 'react';
import { EightDEvidenceSection } from './EightDEvidence';
import type { FileResource } from '../attachments/attachments';
import { eightDDomain, type InternalEightDDomain } from '../internal-eight-d/domain';
import { useEightDText, type EightDDocument, type EightDRead } from './eight-d';
import styles from './eight-d.module.css';

type Props = {
  problemId: string; portal?: boolean; domain?: InternalEightDDomain; resource?: FileResource; anchorId?: string;
  document: EightDDocument; disabled: boolean; removalBlocked?: boolean; read: EightDRead; overview?: ReactNode; sourceSummary?: ReactNode;
  teamContext?: { ownerName?: string | null; responsibleSectionName?: string | null }; chapterTarget?: { section: string; row?: string };
  onChange: (change: (current: EightDDocument) => EightDDocument) => void;
};
const containmentPositions = [
  ['PCBA', '在制品'], ['PCBA', '智新库存'],
  ['成品', '客户端'], ['成品', '运输中'], ['成品', '智新库存'], ['成品', '在制品'], ['成品', 'VMI 仓'],
  ['物料', '供应商'], ['物料', '公司内'],
];
function hasEntryContent(fields: object) {
  return Object.values(fields).some(value => typeof value === 'string' ? value.trim() !== '' : Array.isArray(value) ? value.length > 0 : value != null);
}

export function EightDField({ label, children }: { label: string; children: ReactNode }) {
  return <label className={styles.field}><span>{label}</span>{children}</label>;
}

export function EightDDocumentEditor({ problemId, domain = 'process', portal = false, resource, anchorId = problemId, document: doc, disabled, removalBlocked = false, read, overview, sourceSummary, teamContext, chapterTarget, onChange }: Props) {
  const text = useEightDText();
  const process = domain === 'process' && !portal && (!resource || resource.resourceType === 'process-eight-d');
  const chapterView = overview !== undefined;
  const [selection, setSelection] = useState<{ chapter: string; target?: { section: string } }>();
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [dismissedTarget, setDismissedTarget] = useState<Props['chapterTarget']>();
  const [dismissedSuggestions, setDismissedSuggestions] = useState<string[]>([]);
  const [pendingRemoval, setPendingRemoval] = useState<{ change: () => void; hasFiles: boolean }>();
  const editorId = useId();
  const teamNames = process && !disabled ? [...new Set((doc.team ?? []).map(member => member.name.trim()).filter(Boolean))] : [];
  const ownerList = teamNames.length ? `${editorId}-team` : undefined;
  const chapter = selection && selection.target === chapterTarget ? selection.chapter : chapterTarget?.section ?? 'D2';
  const chapters = [
    ['input', text('问题输入与风险评估', 'Problem input and risk assessment')],
    ['D1', text('团队建立', 'Team establishment')], ['D2', text('问题描述', 'Problem description')],
    ['D3', text('临时措施与围堵', 'Temporary measures and containment')], ['D4', text('根因分析', 'Root cause analysis')],
    ['D5', text('制定永久纠正措施', 'Permanent corrective actions')], ['D6', text('实施与验证', 'Implementation and verification')],
    ['D7', text('横向展开与标准化', 'Horizontal deployment and standardization')], ['D8', text('结案总结', 'Closure summary')],
  ];
  const savedDocumentNames = useRef(new Set(doc.standardization.map(row => row.id)));
  const update = <K extends keyof EightDDocument>(key: K, value: EightDDocument[K] | ((current: EightDDocument[K]) => EightDDocument[K])) => { if (!disabled) onChange(current => ({ ...current, [key]: typeof value === 'function' ? value(current[key]) : value })); };
  const area = (label: string, value: string, change: (value: string) => void) => <EightDField label={label}><textarea aria-label={label} disabled={disabled} value={value} onChange={event => change(event.target.value)} /></EightDField>;
  const input = (label: string, value: string | null, change: (value: string) => void, type = 'text', list?: string) => <EightDField label={label}><input type={type} list={list} aria-label={label} disabled={disabled} value={type === 'date' ? value?.slice(0, 10) ?? '' : value ?? ''} onChange={event => change(event.target.value)} /></EightDField>;
  const quantity = (label: string, value: number | null, change: (value: number | null) => void) => <EightDField label={label}><input type="number" min={0} step={1} aria-label={label} disabled={disabled} value={value ?? ''} onChange={event => change(event.target.value === '' ? null : Number(event.target.value))} /></EightDField>;
  // Merge each receipt against current state, including multiple CLEAN callbacks in one render.
  const evidence = (label: string, ids: string[], change: (apply: (current: string[]) => string[]) => void) => <EightDEvidenceSection label={label} problemId={problemId} resource={resource ?? { resourceType: eightDDomain(domain).resourceType, resourceId: problemId }} fileIds={ids} readOnly={disabled} read={read} onChange={next => change(current => [...current.filter(id => !ids.includes(id) || next.includes(id)), ...next.filter(id => !current.includes(id))])} />;
  const remove = (label: string, change: () => void) => !disabled && <Popconfirm title={label} description={text('仅修改当前草稿，保存后才生效。', 'Only changes the current draft; takes effect after saving.')} okText={text('确认移除', 'Confirm removal')} cancelText={text('取消', 'Cancel')} onConfirm={() => { if (!disabled && !removalBlocked) change(); }}><Button danger disabled={removalBlocked} aria-label={label}>{label}</Button></Popconfirm>;
  const requestRemoval = (change: () => void, hasContent: boolean, hasFiles = false) => {
    if (disabled || removalBlocked) return;
    if (hasContent || hasFiles) setPendingRemoval({ change, hasFiles });
    else change();
  };
  const removeEntry = (label: string, change: () => void, hasContent: boolean, hasFiles = false) => !disabled &&
    <Button danger type="text" disabled={removalBlocked} aria-label={label} onClick={() => requestRemoval(change, hasContent, hasFiles)}>{text('移除', 'Remove')}</Button>;
  const entryTable = (title: string, columns: string[], rows: ReactNode, className = styles.scroll) => <div className={className} role="region" aria-label={title} tabIndex={0}>
    <table className={`${styles.table} ${styles.entryTable}`}><thead><tr>{columns.map(name => <th key={name} scope="col">{name}</th>)}<th scope="col">{text('操作', 'Actions')}</th></tr></thead><tbody>{rows}</tbody></table>
  </div>;
  const entry = (key: string, path: string | undefined, label: string, cells: ReactNode[], details: ReactNode, removal: ReactNode, detailsChapter?: string) => {
    const targeted = path !== undefined && chapterTarget?.row === path && chapterTarget !== dismissedTarget && (!detailsChapter || chapterTarget.section === detailsChapter);
    const expanded = targeted || expandedRows[key] === true;
    const detailsId = `${editorId}-${key}`;
    return <Fragment key={key}>
      <tr tabIndex={-1} data-eight-d-path={detailsChapter ? undefined : path}>
        {cells.map((cell, index) => <td key={index}>{cell}</td>)}
        <td><div className={styles.entryActions}>
          <Button type="text" aria-label={`${text('详情', 'Details')} ${label}`} aria-expanded={expanded} aria-controls={detailsId} onClick={() => {
            if (targeted) setDismissedTarget(chapterTarget);
            setExpandedRows(current => ({ ...current, [key]: !expanded }));
          }}>{expanded ? text('收起', 'Collapse') : text('详情', 'Details')}</Button>
          {removal}
        </div></td>
      </tr>
      <tr hidden={!expanded} className={styles.entryDetails} id={detailsId}><td colSpan={cells.length + 1}>
        {detailsChapter ? <section className={styles.correctiveDetails} aria-label={label} data-eight-d-path={path} tabIndex={-1}>{details}</section> : details}
      </td></tr>
    </Fragment>;
  };
  const section = (id: string, title: string, children: ReactNode) => <section hidden={chapterView && id !== chapter} className={styles.section} tabIndex={-1} id={`eight-d-${anchorId}-${id}`}><h3>{id === 'input' ? title : `${id} · ${title}`}</h3>{children}</section>;
  const containment = (key: 'containment' | 'optionalAffectedContainment', title: string) => {
    // Display optional positions without adding untouched suggestions to the saved document.
    if (process) {
      const emptyPosition = { group: '', location: '', quantity: null, measure: '', owner: '', plannedAt: null, completion: '', ngQuantity: null };
      const suggestions = containmentPositions.map(([group, location], index) => ({ ...emptyPosition, id: `${key}-suggestion-${index}`, group, location }));
      const suggestionIds = new Set(suggestions.map(suggestion => suggestion.id));
      const positions = suggestions.map(suggestion => {
        const row = doc[key].find(item => item.id === suggestion.id) ?? doc[key].find(item => !suggestionIds.has(item.id) && item.group === suggestion.group && item.location === suggestion.location);
        return { row: row ?? suggestion, suggestion, selected: !!row };
      });
      const extra = doc[key].filter(row => !positions.some(position => position.selected && position.row.id === row.id));
      const rows = [...positions.filter(position => position.selected || (!disabled && !dismissedSuggestions.includes(position.suggestion.id))), ...extra.map(row => ({ row, suggestion: undefined, selected: true }))];
      const columns = [text('分组', 'Group'), text('位置', 'Location'), text('数量', 'Quantity'), text('措施', 'Measure'), text('责任人', 'Owner'), text('完成情况', 'Completion'), text('不良数量', 'NG quantity')];
      return <><h4>{title}</h4>{entryTable(title, columns, rows.map(({ row, suggestion, selected }, index) => {
        const prefix = `${title} ${index + 1}`;
        const path = selected ? `${key}[${doc[key].findIndex(item => item.id === row.id)}]` : undefined;
        const change = (patch: Partial<components['schemas']['ProcessEightDContainmentDto']>) => update(key, current =>
          current.some(item => item.id === row.id) ? current.map(item => item.id === row.id ? { ...item, ...patch } : item) : [...current, { ...row, ...patch }]);
        const removeRow = () => {
          if (suggestion) setDismissedSuggestions(current => [...current, suggestion.id]);
          if (selected) update(key, current => current.filter(item => item.id !== row.id));
        };
        const { id: _id, group, location, ...values } = row;
        const isDefaultPosition = !!suggestion && group === suggestion.group && location === suggestion.location;
        const hasContent = selected && (hasEntryContent(values) || (!isDefaultPosition && hasEntryContent({ group, location })));
        return entry(`${key}-${row.id}`, path, prefix, [
          <div className={styles.positionGroup}>
            {!disabled && <input type="checkbox" aria-label={`${title} ${group} ${location}`} checked={selected} disabled={selected && removalBlocked} onChange={event => event.target.checked ? change({}) : requestRemoval(removeRow, hasContent)} />}
            {input(`${prefix} ${columns[0]}`, group, group => change({ group }))}
          </div>,
          input(`${prefix} ${columns[1]}`, location, location => change({ location })),
          quantity(`${prefix} ${columns[2]}`, row.quantity, quantity => change({ quantity })),
          <span className={styles.entryPreview}>{row.measure || '—'}</span>,
          input(`${prefix} ${columns[4]}`, row.owner, owner => change({ owner }), 'text', ownerList),
          input(`${prefix} ${columns[5]}`, row.completion, completion => change({ completion })),
          quantity(`${prefix} ${columns[6]}`, row.ngQuantity, ngQuantity => change({ ngQuantity })),
        ], <div className={styles.fields}>
          {area(`${prefix} ${columns[3]}`, row.measure, measure => change({ measure }))}
          {input(text('计划日期', 'Planned date'), row.plannedAt, plannedAt => change({ plannedAt: plannedAt || null }), 'date')}
        </div>, removeEntry(`${text('移除', 'Remove ')}${prefix}`, removeRow, hasContent));
      }))}{!disabled && <Button onClick={() => update(key, rows => [...rows, { ...emptyPosition, id: crypto.randomUUID() }])}>{text('增加围堵位置', 'Add containment location')} · {title}</Button>}</>;
    }
    const positions = containmentPositions.map(([group, location], index) => doc[key].find(row => row.group === group && row.location === location) ?? { id: `${key}-suggestion-${index}`, group, location, quantity: null, measure: '', owner: '', plannedAt: null, completion: '', ngQuantity: null });
    const rows = [...positions, ...doc[key].filter(row => !positions.some(position => position.id === row.id))];
    return <><h4>{title}</h4><div className={styles.scroll} role="region" aria-label={title} tabIndex={0}><table className={styles.table}><thead><tr>{[text('分组', 'Group'), text('位置', 'Location'), text('数量（可空）', 'Quantity (optional)'), text('措施', 'Measure'), text('责任人', 'Owner'), text('计划日期', 'Planned date'), text('完成情况', 'Completion'), text('不良数量（可空）', 'NG quantity (optional)')].map(name => <th key={name}>{name}</th>)}</tr></thead><tbody>{rows.map((row, index) => {
    const selected = doc[key].some(item => item.id === row.id);
    const change = (patch: Partial<components['schemas']['ProcessEightDContainmentDto']>) => update(key, selected ? doc[key].map(item => item.id === row.id ? { ...item, ...patch } : item) : [...doc[key], { ...row, id: crypto.randomUUID(), ...patch }]);
    const prefix = `${title} ${index + 1}`;
    return <tr key={index < positions.length ? `position-${index}` : row.id} tabIndex={-1} data-eight-d-path={selected ? `${key}[${doc[key].findIndex(item => item.id === row.id)}]` : undefined}><td><input type="checkbox" aria-label={`${title} ${row.group} ${row.location}`} disabled={disabled} checked={selected} onChange={event => event.target.checked ? change({}) : update(key, doc[key].filter(item => item.id !== row.id))} />{input(`${prefix} ${text('分组', 'Group')}`, row.group, group => change({ group }))}</td><td>{input(`${prefix} ${text('位置', 'Location')}`, row.location, location => change({ location }))}</td><td>{quantity(`${prefix} ${text('数量', 'Quantity')}`, row.quantity, quantity => change({ quantity }))}</td><td>{area(`${prefix} ${text('措施', 'Measure')}`, row.measure, measure => change({ measure }))}</td><td>{input(`${prefix} ${text('责任人', 'Owner')}`, row.owner, owner => change({ owner }))}</td><td>{input(`${prefix} ${text('计划日期', 'Planned date')}`, row.plannedAt, plannedAt => change({ plannedAt: plannedAt || null }), 'date')}</td><td>{input(`${prefix} ${text('完成情况', 'Completion')}`, row.completion, completion => change({ completion }))}</td><td>{quantity(`${prefix} ${text('不良数量', 'NG quantity')}`, row.ngQuantity, ngQuantity => change({ ngQuantity }))}</td></tr>;
  })}</tbody></table></div>{!disabled && <Button onClick={() => update(key, [...doc[key], { id: crypto.randomUUID(), group: '', location: '', quantity: null, measure: '', owner: '', plannedAt: null, completion: '', ngQuantity: null }])}>{text('增加围堵位置', 'Add containment location')} · {title}</Button>}</>;
  };
  return <div className={chapterView ? styles.chapterLayout : undefined}>
    {chapterView ? <aside className={styles.chapterDirectory}>
      <button className={styles.chapterToggle} type="button" aria-expanded={directoryOpen} aria-controls={`eight-d-${anchorId}-chapters`} onClick={() => setDirectoryOpen(current => !current)}>{text('章节目录', 'Chapter directory')}</button>
      <nav className={styles.chapterNav} id={`eight-d-${anchorId}-chapters`} data-open={directoryOpen} aria-label={text('8D 内容分区', '8D content sections')}>
        {chapters.map(([id, label]) => <button key={id} type="button" aria-current={id === chapter ? 'step' : undefined} onClick={() => {
          setSelection({ chapter: id, target: chapterTarget }); setDirectoryOpen(false);
          requestAnimationFrame(() => document.getElementById(`eight-d-${anchorId}-${id}`)?.focus());
        }}>{id === 'input' ? label : `${id} · ${label}`}</button>)}
      </nav>
    </aside> : <nav className={styles.anchors} aria-label={text('8D 内容分区', '8D content sections')}>{['D2', 'D3', 'D4', 'D5-D6', 'D7', 'D8'].map(id => <a key={id} href={`#eight-d-${anchorId}-${id}`}>{id}</a>)}</nav>}
    <div className={styles.chapterContent}>
    {ownerList && <datalist id={ownerList}>{teamNames.map(name => <option key={name} value={name} />)}</datalist>}
    {process && <Modal open={!!pendingRemoval} destroyOnHidden title={text('此条目已有内容，确定删除？', 'This entry has content. Remove it?')}
      okText={text('确认移除', 'Confirm removal')} cancelText={text('取消', 'Cancel')} cancelButtonProps={{ autoInsertSpace: false }}
      okButtonProps={{ danger: true, disabled: disabled || removalBlocked }}
      onCancel={() => setPendingRemoval(undefined)} onOk={() => {
        if (disabled || removalBlocked) return;
        pendingRemoval?.change();
        setPendingRemoval(undefined);
      }}>
      {pendingRemoval?.hasFiles && <p>{text('保存后将从当前报告移除该条目的附件关联。', 'Saving removes this entry’s attachment links from the current report.')}</p>}
      {!pendingRemoval?.hasFiles && <p>{text('仅修改当前草稿，保存后才生效。', 'Only changes the current draft; takes effect after saving.')}</p>}
    </Modal>}
    {chapterView && section('input', chapters[0][1], <>{overview}{area(text('风险判定依据', 'Risk assessment rationale'), doc.riskAssessment ?? '', riskAssessment => update('riskAssessment', riskAssessment))}</>)}
    {chapterView && section('D1', chapters[1][1], <>
      <dl className={styles.fields}>
        <div><dt>{text('单据负责人', 'Report owner')}</dt><dd>{teamContext?.ownerName ?? text('名称未记录', 'Name unavailable')}</dd></div>
        <div><dt>{text('责任科室', 'Responsible section')}</dt><dd>{teamContext?.responsibleSectionName ?? text('名称未记录', 'Name unavailable')}</dd></div>
      </dl>
      {(doc.team ?? []).map((row, index) => {
        type Row = components['schemas']['ProcessEightDTeamMemberDto'];
        const change = (patch: Partial<Row>) => update('team', rows => rows?.map(item => item.id === row.id ? { ...item, ...patch } : item));
        const prefix = `${text('团队成员', 'Team member')} ${index + 1}`;
        return <section key={row.id} className={styles.row} tabIndex={-1} data-eight-d-path={`team[${index}]`}>
          <h4>{prefix}</h4>
          <div className={styles.fields}>
            {input(`${prefix} ${text('姓名', 'Name')}`, row.name, name => change({ name }))}
            {input(`${prefix} ${text('部门', 'Department')}`, row.department, department => change({ department }))}
            {area(`${prefix} ${text('职责分工', 'Responsibility')}`, row.responsibility, responsibility => change({ responsibility }))}
            {area(`${prefix} ${text('协作范围', 'Collaboration scope')}`, row.collaborationScope, collaborationScope => change({ collaborationScope }))}
          </div>
          <div>{remove(`${text('移除团队成员', 'Remove team member')} ${index + 1}`, () => update('team', rows => rows?.filter(item => item.id !== row.id)))}</div>
        </section>;
      })}
      {!disabled && <Button disabled={(doc.team?.length ?? 0) >= 100} onClick={() => update('team', rows => [...rows ?? [], { id: crypto.randomUUID(), name: '', department: '', responsibility: '', collaborationScope: '' }])}>{text('增加团队成员', 'Add team member')}</Button>}
    </>)}
    {section('D2', text('问题描述', 'Problem description'), <>{process && sourceSummary}{area(text('D2 问题描述', 'D2 Description'), doc.description, value => update('description', value))}{evidence(text('OK 附件（可选）', 'OK evidence (optional)'), doc.okFileIds, value => update('okFileIds', value))}{evidence(text('NG 附件（可选）', 'NG evidence (optional)'), doc.ngFileIds, value => update('ngFileIds', value))}</>)}
    {section('D3', text('临时措施与围堵', 'Temporary measures and containment'), <>
      {(() => {
        const title = text('临时措施', 'Temporary measures');
        const columns = [text('措施', 'Measure'), text('责任部门 / 人', 'Department / owner'), text('导入日期', 'Introduction date')];
        const rows = doc.temporaryMeasures.map((row, index) => {
        type Row = components['schemas']['ProcessEightDTemporaryMeasureDto'];
        const change = (patch: Partial<Row> | ((current: Row) => Partial<Row>)) => update('temporaryMeasures', rows => rows.map(item => item.id === row.id ? { ...item, ...(typeof patch === 'function' ? patch(item) : patch) } : item));
        if (process) {
          const label = `${text('临时措施', 'Temporary measure')} ${index + 1}`;
          const { id, fileIds, ...values } = row;
          return entry(`temporaryMeasures-${id}`, `temporaryMeasures[${index}]`, label, [
            <span className={styles.entryPreview}>{row.description || '—'}</span>,
            input(text('临时措施责任部门 / 人', 'Temporary measure department / owner'), row.departmentOwner, departmentOwner => change({ departmentOwner }), 'text', ownerList),
            input(columns[2], row.introducedAt, introducedAt => change({ introducedAt: introducedAt || null }), 'date'),
          ], <>
            {area(label, row.description, description => change({ description }))}
            {evidence(text('临时措施附件', 'Temporary measure evidence'), fileIds, apply => change(current => ({ fileIds: apply(current.fileIds) })))}
          </>, removeEntry(`${text('移除临时措施', 'Remove temporary measure')} ${index + 1}`, () => update('temporaryMeasures', rows => rows.filter(item => item.id !== id)), hasEntryContent(values), fileIds.length > 0));
        }
        return <div key={row.id} className={styles.row} tabIndex={-1} data-eight-d-path={`temporaryMeasures[${index}]`}><div className={styles.fields}>{area(`${text('临时措施', 'Temporary measure')} ${index + 1}`, row.description, description => change({ description }))}{input(text('临时措施责任部门 / 人', 'Temporary measure department / owner'), row.departmentOwner, departmentOwner => change({ departmentOwner }))}{input(text('导入日期', 'Introduction date'), row.introducedAt, introducedAt => change({ introducedAt: introducedAt || null }), 'date')}</div>{evidence(text('临时措施附件', 'Temporary measure evidence'), row.fileIds, fileIds => change(current => ({ fileIds: fileIds(current.fileIds) })))}{remove(`${text('移除临时措施', 'Remove temporary measure')} ${index + 1}`, () => update('temporaryMeasures', doc.temporaryMeasures.filter(item => item.id !== row.id)))}</div>;
        });
        return process && rows.length > 0 ? entryTable(title, columns, rows) : rows;
      })()}
      {!disabled && <Button onClick={() => update('temporaryMeasures', [...doc.temporaryMeasures, { id: crypto.randomUUID(), description: '', departmentOwner: '', introducedAt: null, fileIds: [] }])}>{text('增加临时措施', 'Add temporary measure')}</Button>}
      {containment('containment', text('本次问题围堵', 'Current problem containment'))}
      {containment('optionalAffectedContainment', text('潜在影响围堵（可选）', 'Potential impact containment (optional)'))}
    </>)}
    {section('D4', text('根因分析', 'Root cause analysis'), <>
      {area(text('D4 分析过程', 'D4 Analysis process'), doc.analysisProcess, value => update('analysisProcess', value))}
      {evidence(text('D4 分析过程附件', 'D4 Analysis evidence'), doc.analysisFileIds, value => update('analysisFileIds', value))}
      <div className={styles.fields}>{area(text('发生因', 'Occurrence cause'), doc.occurrenceCause, value => update('occurrenceCause', value))}{area(text('流出因', 'Escape cause'), doc.escapeCause, value => update('escapeCause', value))}{area(text('系统因（可选）', 'System cause (optional)'), doc.systemCause, value => update('systemCause', value))}</div>
    </>)}
    {(['plan', 'verification'] as const).filter(phase => chapterView || phase === 'plan').map(phase => {
      const planning = phase === 'plan';
      const plan = !chapterView || planning;
      const verify = !chapterView || !planning;
      const phaseChapter = planning ? 'D5' : 'D6';
      const useList = process && chapterView;
      const listTitle = planning ? text('措施计划清单', 'Corrective action plans') : text('措施实绩清单', 'Corrective action results');
      const listColumns = planning
        ? [text('对策', 'Countermeasure'), text('原因类型', 'Cause type'), text('责任人', 'Owner'), text('计划完成日期', 'Planned completion date')]
        : [text('对策', 'Countermeasure'), text('实施人', 'Implementer'), text('验证人', 'Verifier'), text('实施日期', 'Implementation date'), text('有效性结论', 'Effectiveness decision')];
      const actionRows = doc.correctiveActions.map((row, index) => {
        type Row = components['schemas']['ProcessEightDCorrectiveActionDto'];
        const change = (patch: Partial<Row> | ((current: Row) => Partial<Row>)) => update('correctiveActions', rows => rows.map(item => item.id === row.id ? { ...item, ...(typeof patch === 'function' ? patch(item) : patch) } : item));
        const prefix = `${text('措施', 'Action')} ${index + 1}`;
        const path = `correctiveActions[${index}]`;
        const { id, causeKind, fileIds, verificationFileIds, ...values } = row;
        const removalLabel = `${text('移除措施', 'Remove action')} ${index + 1}`;
        const removeRow = () => update('correctiveActions', rows => rows.filter(item => item.id !== id));
        const removal = plan && (process
          ? removeEntry(removalLabel, removeRow, causeKind !== 'OCCURRENCE' || hasEntryContent(values), fileIds.length + verificationFileIds.length > 0)
          : remove(removalLabel, removeRow));
        const causeLabel = text('原因类型', 'Cause type');
        const causeLabels = { OCCURRENCE: text('发生因', 'Occurrence'), ESCAPE: text('流出因', 'Escape'), SYSTEM: text('系统因', 'System') };
        const cause = <EightDField label={causeLabel}><select aria-label={useList ? `${prefix} ${causeLabel}` : undefined} disabled={disabled} value={causeKind} onChange={event => change({ causeKind: event.target.value as Row['causeKind'] })}>
          {Object.entries(causeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></EightDField>;
        const actionText = area(`${prefix} ${text('对策', 'Countermeasure')}`, row.action, action => change({ action }));
        const owner = input(`${prefix} ${text('责任人', 'Owner')}`, row.owner, owner => change({ owner }), 'text', ownerList);
        const plannedAt = input(`${prefix} ${text('计划日期', 'Planned date')}`, row.plannedAt, plannedAt => change({ plannedAt: plannedAt || null }), 'date');
        const planDetails = <>
          {area(`${prefix} ${text('验证方法', 'Verification method')}`, row.verificationMethod, verificationMethod => change({ verificationMethod }))}
          {chapterView && area(`${prefix} ${text('选择依据', 'Selection rationale')}`, row.selectionReason ?? '', selectionReason => change({ selectionReason }))}
        </>;
        const implementer = input(`${prefix} ${text('实施人', 'Implementer')}`, row.implementer ?? '', implementer => change({ implementer }));
        const verifier = input(`${prefix} ${text('验证人', 'Verifier')}`, row.verifier ?? '', verifier => change({ verifier }));
        const implementedAt = input(`${prefix} ${text('实施日期', 'Implementation date')}`, row.implementationAt, implementationAt => change({ implementationAt: implementationAt || null }), 'date');
        const result = area(`${prefix} ${text('实施结果', 'Implementation result')}`, row.result, result => change({ result }));
        const before = area(`${prefix} ${text('改善前', 'Before improvement')}`, row.beforeState, beforeState => change({ beforeState }));
        const after = area(`${prefix} ${text('改善后', 'After improvement')}`, row.afterState, afterState => change({ afterState }));
        const followUp = <>
          {input(`${prefix} ${text('实际首批断点', 'Actual first batch')}`, row.firstBatch, firstBatch => change({ firstBatch }))}
          {quantity(`${prefix} ${text('后续批数', 'Follow-up batch count')}`, row.followUpBatchCount, followUpBatchCount => change({ followUpBatchCount }))}
          {input(`${prefix} ${text('跟踪时长', 'Follow-up duration')}`, row.followUpDuration, followUpDuration => change({ followUpDuration }))}
          {area(`${prefix} ${text('验证记录', 'Verification record')}`, row.verificationRecord, verificationRecord => change({ verificationRecord }))}
        </>;
        const effectivenessLabel = `${prefix} ${text('人工有效性结论', 'Human effectiveness decision')}`;
        const effectivenessLabels = { '': text('尚未判断', 'Not assessed'), true: text('有效', 'Effective'), false: text('无效', 'Ineffective') };
        const effectivenessValue = row.effective == null ? '' : row.effective ? 'true' : 'false';
        const effectiveness = <EightDField label={effectivenessLabel}><select aria-label={effectivenessLabel} disabled={disabled} value={effectivenessValue} onChange={event => change({ effective: event.target.value === '' ? null : event.target.value === 'true' })}>
          {Object.entries(effectivenessLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></EightDField>;
        const planEvidence = plan && evidence(text('措施附件', 'Action evidence'), fileIds, apply => change(current => ({ fileIds: apply(current.fileIds) })));
        const verificationEvidence = verify && evidence(text('验证附件', 'Verification evidence'), verificationFileIds, apply => change(current => ({ verificationFileIds: apply(current.verificationFileIds) })));

        if (useList) {
          const required = planning ? [
            [row.action, text('对策', 'Countermeasure')], [row.owner, text('责任人', 'Owner')],
            [row.plannedAt, text('计划完成日期', 'Planned completion date')], [row.verificationMethod, text('验证方法', 'Verification method')],
          ] : [
            [row.implementationAt, text('实施日期', 'Implementation date')], [row.result, text('实施结果', 'Implementation result')],
            [row.beforeState, text('改善前', 'Before improvement')], [row.afterState, text('改善后', 'After improvement')],
            [row.firstBatch, text('实际首批断点', 'Actual first batch')],
            [(row.followUpBatchCount ?? 0) > 0 ? String(row.followUpBatchCount) : row.followUpDuration, text('后续批数或跟踪时长', 'Follow-up batches or duration')],
            [verificationFileIds.length ? String(verificationFileIds.length) : row.verificationRecord, text('验证记录或附件', 'Verification record or evidence')],
          ];
          const missing = disabled || causeKind === 'SYSTEM' ? [] : required.flatMap(([value, label]) => value?.trim() ? [] : [label]);
          const summary = <>
            <h4 className={styles.entryPreview}>{prefix}{row.action && ` · ${row.action}`}</h4>
            {missing.length > 0 && <small className={styles.correctivePending}>{text('待填写', 'Required')}{text('：', ': ')}{missing.join(text('、', ', '))}</small>}
          </>;
          const cellText = (value?: string | null) => <span>{value?.trim() || '—'}</span>;
          const cells = planning
            ? [summary, causeLabels[causeKind], cellText(row.owner), cellText(row.plannedAt?.slice(0, 10))]
            : [summary, cellText(row.implementer), cellText(row.verifier), cellText(row.implementationAt?.slice(0, 10)), effectivenessLabels[effectivenessValue]];
          const details = planning ? <>
            <div className={styles.fields}>{cause}{owner}{plannedAt}{actionText}{planDetails}</div>
            {planEvidence}
          </> : <>
            {row.action && <p className={styles.correctiveActionText}>{row.action}</p>}
            <div className={styles.fields}>{implementer}{verifier}{implementedAt}{effectiveness}{result}{followUp}</div>
            <fieldset className={styles.improvementPair}>
              <legend>{text('改善前后对照', 'Before and after comparison')}</legend>
              {before}{after}
            </fieldset>
            {verificationEvidence}
          </>;
          return entry(`corrective-${phase}-${id}`, path, prefix, cells, details, removal, phaseChapter);
        }

        return <section key={id} className={styles.row} aria-label={prefix} tabIndex={-1} data-eight-d-path={path}>
          <h4>{prefix}{!plan && row.action ? ` · ${row.action}` : ''}</h4>
          <div className={styles.fields}>
            {plan && <>{cause}{actionText}{owner}{plannedAt}{planDetails}</>}
            {verify && <>{chapterView && <>{implementer}{verifier}</>}{implementedAt}{result}{before}{after}{followUp}{effectiveness}</>}
          </div>
          <Space wrap>{planEvidence}{verificationEvidence}{removal}</Space>
        </section>;
      });
      return <div key={phase}>{section(chapterView ? phaseChapter : 'D5-D6', chapterView ? planning ? chapters[5][1] : chapters[6][1] : text('永久措施、实施与有效性验证', 'Corrective actions, implementation and effectiveness'), <>
        {portal && <p>{text('D5 与 D6 使用同一措施；有效性由人工明确判断，附件或日期不代表有效。后续批数或时长选填其一。', 'D5 and D6 use the same action. Effectiveness requires an explicit human decision, not a file or date. Supply follow-up batches or duration.')}</p>}
        {useList ? entryTable(listTitle, listColumns, actionRows, `${styles.scroll} ${styles.correctiveList}`) : actionRows}
        {!disabled && plan && <Button onClick={() => {
          const id = crypto.randomUUID();
          update('correctiveActions', rows => [...rows, { id, causeKind: 'OCCURRENCE', action: '', owner: '', plannedAt: null, verificationMethod: '', fileIds: [], implementationAt: null, result: '', beforeState: '', afterState: '', firstBatch: '', followUpBatchCount: null, followUpDuration: '', verificationRecord: '', verificationFileIds: [], effective: null }]);
          if (useList) setExpandedRows(current => ({ ...current, [`corrective-${phase}-${id}`]: true }));
        }}>{text('增加永久措施', 'Add corrective action')}</Button>}
      </>)}</div>;
    })}
    {section('D7', text('横向展开与标准化', 'Horizontal deployment and standardization'), <>
      {(() => {
        const title = text('横向展开', 'Horizontal deployment');
        const columns = [text('展开范围', 'Deployment scope'), text('展开责任人', 'Deployment owner'), text('展开完成情况', 'Deployment completion')];
        const rows = doc.horizontalDeployment.map((row, index) => {
        type Row = components['schemas']['ProcessEightDHorizontalDeploymentDto'];
        const change = (patch: Partial<Row> | ((current: Row) => Partial<Row>)) => update('horizontalDeployment', rows => rows.map(item => item.id === row.id ? { ...item, ...(typeof patch === 'function' ? patch(item) : patch) } : item));
        if (process) {
          const { id, fileIds, ...values } = row;
          return entry(`horizontalDeployment-${id}`, `horizontalDeployment[${index}]`, `${title} ${index + 1}`, [
            input(columns[0], row.scope, scope => change({ scope })),
            input(columns[1], row.owner, owner => change({ owner })),
            input(columns[2], row.completion, completion => change({ completion })),
          ], <>
            <div className={styles.fields}>
              {area(text('排查结果', 'Inspection result'), row.inspectionResult, inspectionResult => change({ inspectionResult }))}
              {area(text('展开措施', 'Deployment action'), row.action, action => change({ action }))}
            </div>
            {evidence(text('展开附件', 'Deployment evidence'), fileIds, apply => change(current => ({ fileIds: apply(current.fileIds) })))}
          </>, removeEntry(`${text('移除横向展开', 'Remove horizontal deployment')} ${index + 1}`, () => update('horizontalDeployment', rows => rows.filter(item => item.id !== id)), hasEntryContent(values), fileIds.length > 0));
        }
        return <div key={row.id} className={styles.row} tabIndex={-1} data-eight-d-path={`horizontalDeployment[${index}]`}><h4>{text('横向展开', 'Horizontal deployment')} {index + 1}</h4><div className={styles.fields}>{input(text('展开范围', 'Deployment scope'), row.scope, scope => change({ scope }))}{area(text('排查结果', 'Inspection result'), row.inspectionResult, inspectionResult => change({ inspectionResult }))}{area(text('展开措施', 'Deployment action'), row.action, action => change({ action }))}{input(text('展开责任人', 'Deployment owner'), row.owner, owner => change({ owner }))}{input(text('展开完成情况', 'Deployment completion'), row.completion, completion => change({ completion }))}</div>{evidence(text('展开附件', 'Deployment evidence'), row.fileIds, fileIds => change(current => ({ fileIds: fileIds(current.fileIds) })))}</div>;
        });
        return process && rows.length > 0 ? entryTable(title, columns, rows) : rows;
      })()}
      {!disabled && <Button onClick={() => update('horizontalDeployment', [...doc.horizontalDeployment, { id: crypto.randomUUID(), scope: '', inspectionResult: '', action: '', owner: '', completion: '', fileIds: [] }])}>{text('增加横向展开', 'Add horizontal deployment')}</Button>}
      {(() => {
        const columns = [text('序号', 'No.'), text('相关文件', 'Related document'), text('是否需更新', 'Update needed'), text('部门 / 主导者', 'Department / lead'), text('计划完成日期', 'Planned completion date'), text('实际完成日期', 'Actual completion date'), text('状态', 'Status')];
        const rows = doc.standardization.map((row, index) => {
          const change = (patch: Partial<components['schemas']['ProcessEightDStandardizationDto']>) => update('standardization', rows => rows.map(item => item.id === row.id ? { ...item, ...patch } : item));
          const prefix = row.documentName || `${text('新增文件', 'New document')} ${index + 1}`;
          const path = `standardization[${index}]`;
          const status = <select aria-label={`${prefix} ${columns[6]}`} disabled={disabled} value={row.status} onChange={event => change({ status: event.target.value })}>
            <option value="">{text('待确认', 'Unconfirmed')}</option><option value="PENDING">{text('待处理', 'Pending')}</option>
            <option value="COMPLETED">{text('已完成', 'Completed')}</option><option value="NOT_APPLICABLE">{text('不适用', 'Not applicable')}</option>
            {row.status && !['PENDING', 'COMPLETED', 'NOT_APPLICABLE'].includes(row.status) && <option value={row.status}>{row.status}</option>}
          </select>;
          const reason = area(`${prefix} ${text('理由', 'Reason')}`, row.reason, reason => change({ reason }));
          const cells = [index + 1,
            savedDocumentNames.current.has(row.id) ? <span>{row.documentName}</span> : input(`${prefix} ${text('文件名称', 'Document name')}`, row.documentName, documentName => change({ documentName })),
            <select aria-label={`${prefix} ${text('是否更新', 'Update needed')}`} disabled={disabled} value={row.needsUpdate === null ? '' : String(row.needsUpdate)} onChange={event => change({ needsUpdate: event.target.value === '' ? null : event.target.value === 'true' })}>
              <option value="">{text('待确认', 'Unconfirmed')}</option><option value="true">{text('需要', 'Required')}</option><option value="false">{text('不需要', 'Not required')}</option>
            </select>,
            input(`${prefix} ${text('责任部门 / 人', 'Department / owner')}`, row.departmentOwner, departmentOwner => change({ departmentOwner })),
            input(`${prefix} ${text('计划日期', 'Planned date')}`, row.plannedAt, plannedAt => change({ plannedAt: plannedAt || null }), 'date'),
            input(`${prefix} ${text('完成日期', 'Completion date')}`, row.completedAt, completedAt => change({ completedAt: completedAt || null }), 'date'),
          ];
          if (process) {
            const { id, key, documentName, ...values } = row;
            const hasContent = hasEntryContent(values) || (id !== key && documentName.trim() !== '');
            return entry(`standardization-${id}`, path, prefix, [...cells, status], reason,
              removeEntry(`${text('移除标准化文件', 'Remove standardization document')} ${index + 1}`, () => update('standardization', rows => rows.filter(item => item.id !== id)), hasContent));
          }
          return <tr key={row.id} tabIndex={-1} data-eight-d-path={path}>{cells.map((cell, index) => <td key={index}>{cell}</td>)}<td>{status}{reason}</td></tr>;
        });
        if (process) return entryTable(text('标准化文件', 'Standardization documents'), columns, rows);
        return <div className={styles.scroll} role="region" aria-label={text('标准化七列表', 'Seven-column standardization table')} tabIndex={0}>
          <table className={styles.table}><thead><tr>{columns.map(name => <th key={name}>{name}</th>)}</tr></thead><tbody>{rows}</tbody></table>
        </div>;
      })()}
      {!disabled && <Button onClick={() => update('standardization', [...doc.standardization, { id: crypto.randomUUID(), key: `custom-${crypto.randomUUID()}`, documentName: '', needsUpdate: null, departmentOwner: '', plannedAt: null, completedAt: null, status: '', reason: '' }])}>{text('增加标准化文件', 'Add standardization document')}</Button>}
    </>)}
    {section('D8', text('结案总结', 'Closure summary'), area(text('D8 结案总结', 'D8 Closure summary'), doc.closureSummary, value => update('closureSummary', value)))}
    </div>
  </div>;
}
