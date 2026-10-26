import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Pagination, Radio, Space, Spin } from 'antd';
import type { components } from '@qms/contracts';
import { EightDField } from './EightDDocumentEditor';
import { aborted, useEightDText, type EightDRead, type EightDReport } from './eight-d';
import styles from './eight-d.module.css';

type Defect = components['schemas']['ProcessDefectDto'];
type Defects = components['schemas']['ProcessDefectPageDto'];
type SourceChange = Pick<components['schemas']['ProcessEightDSourcesDto'], 'add' | 'removeDefectIds' | 'primaryDefectId' | 'sourceConfirmations'>;
type Preview = components['schemas']['ProcessEightDSourcePreviewDto'];
type Confirmation = components['schemas']['ProcessEightDSourceConfirmationDto'];
export function EightDSourcePicker({ report, read, disabled, onChange }: { report: EightDReport; read: EightDRead; disabled: boolean; onChange: (value?: SourceChange) => void }) {
  const text = useEightDText();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ query: string; result: Defects }>();
  const [selected, setSelected] = useState<Defect[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [primary, setPrimary] = useState(report.sources.find(source => source.primary)?.defectId ?? '');
  const [preview, setPreview] = useState<Preview[]>();
  const [confirmations, setConfirmations] = useState<Record<string, Confirmation>>({});
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const query = new URLSearchParams({ organizationId: report.organizationId, page: String(page), pageSize: '20', search }).toString();
  const defects = data?.query === query ? data.result : undefined;
  const closed = !!report.closedRevisionId;
  const remaining = report.sources.filter(source => !removed.includes(source.defectId));
  const invalidated = () => { generation.current++; setPreview(undefined); setConfirmations({}); onChange(undefined); };
  useEffect(() => {
    let active = true; setError('');
    read<Defects>(`/api/v1/process-quality/defects?${query}`).then(result => { if (active) setData({ query, result }); })
      .catch(cause => { if (active && !aborted(cause)) setError(text('台账加载失败，请重新搜索', 'Ledger could not be loaded. Search again.')); });
    return () => { active = false; };
  }, [query, read, report.version]);
  useEffect(() => {
    generation.current++; setPreview(undefined); setConfirmations({}); setChecking(false); onChange(undefined);
  }, [report.version, onChange]);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => {
    const required = preview?.filter(item => item.relatedProblems.length || item.hasHiddenRelations) ?? [];
    const complete = preview && required.every(item => !!confirmations[item.defectId] && (confirmations[item.defectId].recurrence !== 'NOT_RECURRENCE' || !!confirmations[item.defectId].reason?.trim()));
    const ids = [...remaining.map(item => item.defectId), ...selected.map(item => item.id)];
    if (!complete || !ids.length || !primary || !ids.includes(primary)) { onChange(undefined); return; }
    if (closed && !selected.length) { onChange(undefined); return; }
    onChange({ add: selected.map(item => ({ defectId: item.id, expectedVersion: item.version })), removeDefectIds: removed, ...(!closed ? { primaryDefectId: primary } : {}), sourceConfirmations: required.map(item => confirmations[item.defectId]) });
  }, [preview, confirmations, selected, removed, primary, onChange]);
  async function check() {
    const version = ++generation.current; setChecking(true); setError('');
    try {
      const input: components['schemas']['ProcessEightDSourcePreviewInputDto'] = { organizationId: report.organizationId, problemId: report.problemId, sources: selected.map(item => ({ defectId: item.id, expectedVersion: item.version })) };
      const result = selected.length ? await read<Preview[]>('/api/v1/process-quality/eight-d/sources/preview', { method: 'POST', body: JSON.stringify(input) }) : [];
      if (version !== generation.current) return;
      if (result.length !== selected.length || selected.some(item => !result.some(entry => entry.defectId === item.id))) throw new Error('Invalid source preview');
      setPreview(result); setConfirmations({});
    } catch (cause) { if (version === generation.current && !aborted(cause)) setError(text('来源预览失败，请重新核对', 'Source preview failed. Check again.')); }
    finally { if (version === generation.current) setChecking(false); }
  }
  return <div className={styles.modal}>
    <p>{text('从真实台账选择来源；跨页选择保留。重复关联与复发须逐项确认，取消不变更。', 'Select real ledger records; selections persist across pages. Confirm related problems and recurrence individually. Cancel makes no change.')}</p>
    {closed ? <Alert type="info" title={text('关闭后仅补充来源，批准版不随关闭后来源补充改变。', 'Only sources may be supplemented after closure. The approved report stays unchanged.')} /> : null}
    <EightDField label={text('搜索来源台账', 'Search source ledger')}><input disabled={disabled || checking} value={search} maxLength={100} onChange={event => { setSearch(event.target.value); setPage(1); }} /></EightDField>
    {error ? <Alert type="error" title={error} /> : null}
    {!defects ? <Spin /> : <>{!defects.items.length ? <p>{text('无匹配台账', 'No matching ledger records')}</p> : defects.items.filter(item => !report.sources.some(source => source.defectId === item.id)).map(item => <Checkbox key={item.id} disabled={disabled || checking} checked={selected.some(row => row.id === item.id)} onChange={event => { invalidated(); setSelected(previous => event.target.checked ? [...previous, item] : previous.filter(row => row.id !== item.id)); }}>{item.description} · {item.traceCode ?? '—'} · v{item.version}</Checkbox>)}
      <Pagination size="small" current={page} pageSize={20} showSizeChanger={false} total={defects.total} disabled={disabled || checking} onChange={setPage} /></>}
    <h4>{text('当前来源 / 主来源', 'Current / primary sources')}</h4>
    {report.sources.map(source => <Space wrap key={source.defectId}><Checkbox disabled={disabled || checking || closed} checked={!removed.includes(source.defectId)} onChange={event => { invalidated(); setRemoved(previous => event.target.checked ? previous.filter(id => id !== source.defectId) : [...previous, source.defectId]); }}>{String(source.snapshot.description ?? source.defectId)}</Checkbox><Radio disabled={disabled || checking || closed || removed.includes(source.defectId)} checked={primary === source.defectId} onChange={() => { invalidated(); setPrimary(source.defectId); }}>{text('主来源', 'Primary source')}</Radio></Space>)}
    {selected.map(source => <Space wrap key={source.id}><span>{source.description} · v{source.version}</span><Button disabled={disabled || checking} onClick={() => { invalidated(); setSelected(previous => previous.filter(item => item.id !== source.id)); }}>{text('移除待补来源', 'Remove pending source')}</Button><Radio disabled={disabled || checking || closed} checked={primary === source.id} onChange={() => { invalidated(); setPrimary(source.id); }}>{text('主来源', 'Primary source')}</Radio></Space>)}
    {!remaining.length && !selected.length ? <Alert type="warning" title={text('至少保留一条来源', 'At least one source is required')} /> : null}
    <Button disabled={disabled || checking || !remaining.length && !selected.length} loading={checking} onClick={() => void check()}>{text('预览并核对来源关联', 'Preview source relationships')}</Button>
    {preview?.map(item => <div key={item.defectId} className={styles.row}><p>{text('来源关联核对', 'Source relationship check')} · {selected.find(source => source.id === item.defectId)?.description}</p>
      {item.relatedProblems.map(related => <p key={related.problemId}>{related.reportNumber} · {related.title} · {related.status}</p>)}
      {item.hasHiddenRelations && <Alert type="warning" title={text('另有不可见关联，仅按服务端指纹确认，不披露其标识。', 'Additional restricted relationships exist. Confirm the server fingerprint without exposing their IDs.')} />}
      {(item.relatedProblems.length > 0 || item.hasHiddenRelations) ? <><EightDField label={text('复发关联结论', 'Recurrence conclusion')}><select disabled={disabled} value={confirmations[item.defectId]?.recurrence ?? ''} onChange={event => {
        const recurrence = event.target.value as Confirmation['recurrence'];
        setConfirmations(previous => { const next = { ...previous }; if (!recurrence) delete next[item.defectId]; else next[item.defectId] = { defectId: item.defectId, relatedProblemIds: item.relatedProblems.map(related => related.problemId), relatedSetToken: item.relatedSetToken, recurrence, reason: previous[item.defectId]?.reason ?? '' }; return next; });
      }}><option value="">{text('请明确选择', 'Choose explicitly')}</option><option value="RECURRENCE">{text('复发', 'Recurrence')}</option><option value="NOT_RECURRENCE">{text('非复发继续关联', 'Link without recurrence')}</option></select></EightDField>
        {confirmations[item.defectId] && <EightDField label={text('关联说明（非复发必填）', 'Relationship reason (required if not recurring)')}><textarea disabled={disabled} value={confirmations[item.defectId].reason ?? ''} onChange={event => setConfirmations(previous => ({ ...previous, [item.defectId]: { ...previous[item.defectId], reason: event.target.value } }))} /></EightDField>}</> : <p>{text('未发现其他关联', 'No other relationships found')}</p>}
    </div>)}
  </div>;
}
