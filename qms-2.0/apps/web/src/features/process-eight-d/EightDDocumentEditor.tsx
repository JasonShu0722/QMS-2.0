import { Button, Popconfirm, Space } from 'antd';
import type { components } from '@qms/contracts';
import { useRef, type ReactNode } from 'react';
import { EightDEvidenceSection } from './EightDEvidence';
import type { FileResource } from '../attachments/attachments';
import { eightDDomain, type InternalEightDDomain } from '../internal-eight-d/domain';
import { useEightDText, type EightDDocument, type EightDRead } from './eight-d';
import styles from './eight-d.module.css';

type Props = { problemId: string; portal?: boolean; domain?: InternalEightDDomain; resource?: FileResource; anchorId?: string; document: EightDDocument; disabled: boolean; removalBlocked?: boolean; read: EightDRead; onChange: (change: (current: EightDDocument) => EightDDocument) => void };
const containmentPositions = [
  ['PCBA', '在制品'], ['PCBA', '智新库存'],
  ['成品', '客户端'], ['成品', '运输中'], ['成品', '智新库存'], ['成品', '在制品'], ['成品', 'VMI 仓'],
  ['物料', '供应商'], ['物料', '公司内'],
];
export function EightDField({ label, children }: { label: string; children: ReactNode }) {
  return <label className={styles.field}><span>{label}</span>{children}</label>;
}

export function EightDDocumentEditor({ problemId, domain = 'process', portal = false, resource, anchorId = problemId, document: doc, disabled, removalBlocked = false, read, onChange }: Props) {
  const text = useEightDText();
  const savedDocumentNames = useRef(new Set(doc.standardization.map(row => row.id)));
  const update = <K extends keyof EightDDocument>(key: K, value: EightDDocument[K] | ((current: EightDDocument[K]) => EightDDocument[K])) => { if (!disabled) onChange(current => ({ ...current, [key]: typeof value === 'function' ? value(current[key]) : value })); };
  const area = (label: string, value: string, change: (value: string) => void) => <EightDField label={label}><textarea aria-label={label} disabled={disabled} value={value} onChange={event => change(event.target.value)} /></EightDField>;
  const input = (label: string, value: string | null, change: (value: string) => void, type = 'text') => <EightDField label={label}><input type={type} aria-label={label} disabled={disabled} value={type === 'date' ? value?.slice(0, 10) ?? '' : value ?? ''} onChange={event => change(event.target.value)} /></EightDField>;
  const quantity = (label: string, value: number | null, change: (value: number | null) => void) => <EightDField label={label}><input type="number" min={0} step={1} aria-label={label} disabled={disabled} value={value ?? ''} onChange={event => change(event.target.value === '' ? null : Number(event.target.value))} /></EightDField>;
  // Merge each receipt against current state, including multiple CLEAN callbacks in one render.
  const evidence = (label: string, ids: string[], change: (apply: (current: string[]) => string[]) => void) => <EightDEvidenceSection label={label} problemId={problemId} resource={resource ?? { resourceType: eightDDomain(domain).resourceType, resourceId: problemId }} fileIds={ids} readOnly={disabled} read={read} onChange={next => change(current => [...current.filter(id => !ids.includes(id) || next.includes(id)), ...next.filter(id => !current.includes(id))])} />;
  const remove = (label: string, change: () => void) => !disabled && <Popconfirm title={label} description={text('仅修改当前草稿，保存后才生效。', 'Only changes the current draft; takes effect after saving.')} okText={text('确认移除', 'Confirm removal')} cancelText={text('取消', 'Cancel')} onConfirm={() => { if (!disabled && !removalBlocked) change(); }}><Button danger disabled={removalBlocked} aria-label={label}>{label}</Button></Popconfirm>;
  const section = (id: string, title: string, children: ReactNode) => <section className={styles.section} tabIndex={-1} id={`eight-d-${anchorId}-${id}`}><h3>{id} · {title}</h3>{children}</section>;
  const containment = (key: 'containment' | 'optionalAffectedContainment', title: string) => {
    // Display optional positions without adding untouched suggestions to the saved document.
    const positions = containmentPositions.map(([group, location], index) => doc[key].find(row => row.group === group && row.location === location) ?? { id: `${key}-suggestion-${index}`, group, location, quantity: null, measure: '', owner: '', plannedAt: null, completion: '', ngQuantity: null });
    const rows = [...positions, ...doc[key].filter(row => !positions.some(position => position.id === row.id))];
    return <><h4>{title}</h4><div className={styles.scroll} role="region" aria-label={title} tabIndex={0}><table className={styles.table}><thead><tr>{[text('分组', 'Group'), text('位置', 'Location'), text('数量（可空）', 'Quantity (optional)'), text('措施', 'Measure'), text('责任人', 'Owner'), text('计划日期', 'Planned date'), text('完成情况', 'Completion'), text('不良数量（可空）', 'NG quantity (optional)')].map(name => <th key={name}>{name}</th>)}</tr></thead><tbody>{rows.map((row, index) => {
    const selected = doc[key].some(item => item.id === row.id);
    const change = (patch: Partial<components['schemas']['ProcessEightDContainmentDto']>) => update(key, selected ? doc[key].map(item => item.id === row.id ? { ...item, ...patch } : item) : [...doc[key], { ...row, id: crypto.randomUUID(), ...patch }]);
    const prefix = `${title} ${index + 1}`;
    return <tr key={index < positions.length ? `position-${index}` : row.id} tabIndex={-1} data-eight-d-path={selected ? `${key}[${doc[key].findIndex(item => item.id === row.id)}]` : undefined}><td><input type="checkbox" aria-label={`${title} ${row.group} ${row.location}`} disabled={disabled} checked={selected} onChange={event => event.target.checked ? change({}) : update(key, doc[key].filter(item => item.id !== row.id))} />{input(`${prefix} ${text('分组', 'Group')}`, row.group, group => change({ group }))}</td><td>{input(`${prefix} ${text('位置', 'Location')}`, row.location, location => change({ location }))}</td><td>{quantity(`${prefix} ${text('数量', 'Quantity')}`, row.quantity, quantity => change({ quantity }))}</td><td>{area(`${prefix} ${text('措施', 'Measure')}`, row.measure, measure => change({ measure }))}</td><td>{input(`${prefix} ${text('责任人', 'Owner')}`, row.owner, owner => change({ owner }))}</td><td>{input(`${prefix} ${text('计划日期', 'Planned date')}`, row.plannedAt, plannedAt => change({ plannedAt: plannedAt || null }), 'date')}</td><td>{input(`${prefix} ${text('完成情况', 'Completion')}`, row.completion, completion => change({ completion }))}</td><td>{quantity(`${prefix} ${text('不良数量', 'NG quantity')}`, row.ngQuantity, ngQuantity => change({ ngQuantity }))}</td></tr>;
  })}</tbody></table></div>{!disabled && <Button onClick={() => update(key, [...doc[key], { id: crypto.randomUUID(), group: '', location: '', quantity: null, measure: '', owner: '', plannedAt: null, completion: '', ngQuantity: null }])}>{text('增加围堵位置', 'Add containment location')} · {title}</Button>}</>;
  };
  return <>
    <nav className={styles.anchors} aria-label={text('8D 内容分区', '8D content sections')}>{['D2', 'D3', 'D4', 'D5-D6', 'D7', 'D8'].map(id => <a key={id} href={`#eight-d-${anchorId}-${id}`}>{id}</a>)}</nav>
    {section('D2', text('问题描述', 'Problem description'), <>{area(text('D2 问题描述', 'D2 Description'), doc.description, value => update('description', value))}{evidence(text('OK 附件（可选）', 'OK evidence (optional)'), doc.okFileIds, value => update('okFileIds', value))}{evidence(text('NG 附件（可选）', 'NG evidence (optional)'), doc.ngFileIds, value => update('ngFileIds', value))}</>)}
    {section('D3', text('临时措施与围堵', 'Temporary measures and containment'), <>
      {doc.temporaryMeasures.map((row, index) => {
        type Row = components['schemas']['ProcessEightDTemporaryMeasureDto'];
        const change = (patch: Partial<Row> | ((current: Row) => Partial<Row>)) => update('temporaryMeasures', rows => rows.map(item => item.id === row.id ? { ...item, ...(typeof patch === 'function' ? patch(item) : patch) } : item));
        return <div key={row.id} className={styles.row} tabIndex={-1} data-eight-d-path={`temporaryMeasures[${index}]`}><div className={styles.fields}>{area(`${text('临时措施', 'Temporary measure')} ${index + 1}`, row.description, description => change({ description }))}{input(text('临时措施责任部门 / 人', 'Temporary measure department / owner'), row.departmentOwner, departmentOwner => change({ departmentOwner }))}{input(text('导入日期', 'Introduction date'), row.introducedAt, introducedAt => change({ introducedAt: introducedAt || null }), 'date')}</div>{evidence(text('临时措施附件', 'Temporary measure evidence'), row.fileIds, fileIds => change(current => ({ fileIds: fileIds(current.fileIds) })))}{remove(`${text('移除临时措施', 'Remove temporary measure')} ${index + 1}`, () => update('temporaryMeasures', doc.temporaryMeasures.filter(item => item.id !== row.id)))}</div>;
      })}
      {!disabled && <Button onClick={() => update('temporaryMeasures', [...doc.temporaryMeasures, { id: crypto.randomUUID(), description: '', departmentOwner: '', introducedAt: null, fileIds: [] }])}>{text('增加临时措施', 'Add temporary measure')}</Button>}
      {containment('containment', text('本次问题围堵', 'Current problem containment'))}
      {containment('optionalAffectedContainment', text('潜在影响围堵（可选）', 'Potential impact containment (optional)'))}
    </>)}
    {section('D4', text('根因分析', 'Root cause analysis'), <>
      {area(text('D4 分析过程', 'D4 Analysis process'), doc.analysisProcess, value => update('analysisProcess', value))}
      {evidence(text('D4 分析过程附件', 'D4 Analysis evidence'), doc.analysisFileIds, value => update('analysisFileIds', value))}
      <div className={styles.fields}>{area(text('发生因', 'Occurrence cause'), doc.occurrenceCause, value => update('occurrenceCause', value))}{area(text('流出因', 'Escape cause'), doc.escapeCause, value => update('escapeCause', value))}{area(text('系统因（可选）', 'System cause (optional)'), doc.systemCause, value => update('systemCause', value))}</div>
    </>)}
    {section('D5-D6', text('永久措施、实施与有效性验证', 'Corrective actions, implementation and effectiveness'), <>
      {portal && <p>{text('D5 与 D6 使用同一措施；有效性由人工明确判断，附件或日期不代表有效。后续批数或时长选填其一。', 'D5 and D6 use the same action. Effectiveness requires an explicit human decision, not a file or date. Supply follow-up batches or duration.')}</p>}

      {doc.correctiveActions.map((row, index) => {
        type Row = components['schemas']['ProcessEightDCorrectiveActionDto'];
        const change = (patch: Partial<Row> | ((current: Row) => Partial<Row>)) => update('correctiveActions', rows => rows.map(item => item.id === row.id ? { ...item, ...(typeof patch === 'function' ? patch(item) : patch) } : item));
        const prefix = `${text('措施', 'Action')} ${index + 1}`;
        return <section key={row.id} className={styles.row} aria-label={prefix} tabIndex={-1} data-eight-d-path={`correctiveActions[${index}]`}><h4>{prefix}</h4><div className={styles.fields}>
          <EightDField label={text('原因类型', 'Cause type')}><select disabled={disabled} value={row.causeKind} onChange={event => change({ causeKind: event.target.value as typeof row.causeKind })}><option value="OCCURRENCE">{text('发生因', 'Occurrence')}</option><option value="ESCAPE">{text('流出因', 'Escape')}</option><option value="SYSTEM">{text('系统因', 'System')}</option></select></EightDField>
          {area(`${prefix} ${text('对策', 'Countermeasure')}`, row.action, action => change({ action }))}
          {input(`${prefix} ${text('责任人', 'Owner')}`, row.owner, owner => change({ owner }))}
          {input(`${prefix} ${text('计划日期', 'Planned date')}`, row.plannedAt, plannedAt => change({ plannedAt: plannedAt || null }), 'date')}
          {area(`${prefix} ${text('验证方法', 'Verification method')}`, row.verificationMethod, verificationMethod => change({ verificationMethod }))}
          {input(`${prefix} ${text('实施日期', 'Implementation date')}`, row.implementationAt, implementationAt => change({ implementationAt: implementationAt || null }), 'date')}
          {area(`${prefix} ${text('实施结果', 'Implementation result')}`, row.result, result => change({ result }))}
          {area(`${prefix} ${text('改善前', 'Before improvement')}`, row.beforeState, beforeState => change({ beforeState }))}
          {area(`${prefix} ${text('改善后', 'After improvement')}`, row.afterState, afterState => change({ afterState }))}
          {input(`${prefix} ${text('实际首批断点', 'Actual first batch')}`, row.firstBatch, firstBatch => change({ firstBatch }))}
          {quantity(`${prefix} ${text('后续批数', 'Follow-up batch count')}`, row.followUpBatchCount, followUpBatchCount => change({ followUpBatchCount }))}
          {input(`${prefix} ${text('跟踪时长', 'Follow-up duration')}`, row.followUpDuration, followUpDuration => change({ followUpDuration }))}
          {area(`${prefix} ${text('验证记录', 'Verification record')}`, row.verificationRecord, verificationRecord => change({ verificationRecord }))}
          <EightDField label={`${prefix} ${text('人工有效性结论', 'Human effectiveness decision')}`}><select disabled={disabled} value={row.effective === null ? '' : String(row.effective)} onChange={event => change({ effective: event.target.value === '' ? null : event.target.value === 'true' })}><option value="">{text('尚未判断', 'Not assessed')}</option><option value="true">{text('有效', 'Effective')}</option><option value="false">{text('无效', 'Ineffective')}</option></select></EightDField>
        </div><Space wrap>{evidence(text('措施附件', 'Action evidence'), row.fileIds, fileIds => change(current => ({ fileIds: fileIds(current.fileIds) })))}{evidence(text('验证附件', 'Verification evidence'), row.verificationFileIds, verificationFileIds => change(current => ({ verificationFileIds: verificationFileIds(current.verificationFileIds) })))}{remove(`${text('移除措施', 'Remove action')} ${index + 1}`, () => update('correctiveActions', doc.correctiveActions.filter(item => item.id !== row.id)))}</Space></section>;
      })}
      {!disabled && <Button onClick={() => update('correctiveActions', [...doc.correctiveActions, { id: crypto.randomUUID(), causeKind: 'OCCURRENCE', action: '', owner: '', plannedAt: null, verificationMethod: '', fileIds: [], implementationAt: null, result: '', beforeState: '', afterState: '', firstBatch: '', followUpBatchCount: null, followUpDuration: '', verificationRecord: '', verificationFileIds: [], effective: null }])}>{text('增加永久措施', 'Add corrective action')}</Button>}
    </>)}
    {section('D7', text('横向展开与标准化', 'Horizontal deployment and standardization'), <>
      {doc.horizontalDeployment.map((row, index) => {
        type Row = components['schemas']['ProcessEightDHorizontalDeploymentDto'];
        const change = (patch: Partial<Row> | ((current: Row) => Partial<Row>)) => update('horizontalDeployment', rows => rows.map(item => item.id === row.id ? { ...item, ...(typeof patch === 'function' ? patch(item) : patch) } : item));
        return <div key={row.id} className={styles.row} tabIndex={-1} data-eight-d-path={`horizontalDeployment[${index}]`}><h4>{text('横向展开', 'Horizontal deployment')} {index + 1}</h4><div className={styles.fields}>{input(text('展开范围', 'Deployment scope'), row.scope, scope => change({ scope }))}{area(text('排查结果', 'Inspection result'), row.inspectionResult, inspectionResult => change({ inspectionResult }))}{area(text('展开措施', 'Deployment action'), row.action, action => change({ action }))}{input(text('展开责任人', 'Deployment owner'), row.owner, owner => change({ owner }))}{input(text('展开完成情况', 'Deployment completion'), row.completion, completion => change({ completion }))}</div>{evidence(text('展开附件', 'Deployment evidence'), row.fileIds, fileIds => change(current => ({ fileIds: fileIds(current.fileIds) })))}</div>;
      })}
      {!disabled && <Button onClick={() => update('horizontalDeployment', [...doc.horizontalDeployment, { id: crypto.randomUUID(), scope: '', inspectionResult: '', action: '', owner: '', completion: '', fileIds: [] }])}>{text('增加横向展开', 'Add horizontal deployment')}</Button>}
      <div className={styles.scroll} role="region" aria-label={text('标准化七列表', 'Seven-column standardization table')} tabIndex={0}><table className={styles.table}><thead><tr>{[text('序号', 'No.'), text('相关文件', 'Related document'), text('是否需更新', 'Update needed'), text('部门 / 主导者', 'Department / lead'), text('计划完成日期', 'Planned completion date'), text('实际完成日期', 'Actual completion date'), text('状态', 'Status')].map(name => <th key={name}>{name}</th>)}</tr></thead><tbody>{doc.standardization.map((row, index) => {
        const change = (patch: Partial<components['schemas']['ProcessEightDStandardizationDto']>) => update('standardization', doc.standardization.map((item, i) => i === index ? { ...item, ...patch } : item));
        const prefix = row.documentName || `${text('新增文件', 'New document')} ${index + 1}`;
        return <tr key={row.id} tabIndex={-1} data-eight-d-path={`standardization[${index}]`}><td>{index + 1}</td><td>{savedDocumentNames.current.has(row.id) ? <span>{row.documentName}</span> : input(`${prefix} ${text('文件名称', 'Document name')}`, row.documentName, documentName => change({ documentName }))}</td><td><select aria-label={`${prefix} ${text('是否更新', 'Update needed')}`} disabled={disabled} value={row.needsUpdate === null ? '' : String(row.needsUpdate)} onChange={event => change({ needsUpdate: event.target.value === '' ? null : event.target.value === 'true' })}><option value="">{text('待确认', 'Unconfirmed')}</option><option value="true">{text('需要', 'Required')}</option><option value="false">{text('不需要', 'Not required')}</option></select></td><td>{input(`${prefix} ${text('责任部门 / 人', 'Department / owner')}`, row.departmentOwner, departmentOwner => change({ departmentOwner }))}</td><td>{input(`${prefix} ${text('计划日期', 'Planned date')}`, row.plannedAt, plannedAt => change({ plannedAt: plannedAt || null }), 'date')}</td><td>{input(`${prefix} ${text('完成日期', 'Completion date')}`, row.completedAt, completedAt => change({ completedAt: completedAt || null }), 'date')}</td><td><select aria-label={`${prefix} ${text('状态', 'Status')}`} disabled={disabled} value={row.status} onChange={event => change({ status: event.target.value })}><option value="">{text('待确认', 'Unconfirmed')}</option><option value="PENDING">{text('待处理', 'Pending')}</option><option value="COMPLETED">{text('已完成', 'Completed')}</option><option value="NOT_APPLICABLE">{text('不适用', 'Not applicable')}</option>{row.status && !['PENDING', 'COMPLETED', 'NOT_APPLICABLE'].includes(row.status) && <option value={row.status}>{row.status}</option>}</select>{area(`${prefix} ${text('理由', 'Reason')}`, row.reason, reason => change({ reason }))}</td></tr>;
      })}</tbody></table></div>
      {!disabled && <Button onClick={() => update('standardization', [...doc.standardization, { id: crypto.randomUUID(), key: `custom-${crypto.randomUUID()}`, documentName: '', needsUpdate: null, departmentOwner: '', plannedAt: null, completedAt: null, status: '', reason: '' }])}>{text('增加标准化文件', 'Add standardization document')}</Button>}
    </>)}
    {section('D8', text('结案总结', 'Closure summary'), area(text('D8 结案总结', 'D8 Closure summary'), doc.closureSummary, value => update('closureSummary', value)))}
  </>;
}
