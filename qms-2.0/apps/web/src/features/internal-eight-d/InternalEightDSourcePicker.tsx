import type { InternalEightDSourcePickerProps } from './source-picker';
import type { components } from '@qms/contracts';
import { Alert, Button, Checkbox, Input, Pagination, Radio, Space, Spin } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { eightDDomain } from './domain';

type Source = components['schemas']['CustomerEightDSourcePreviewInputDto']['sources'][number] & { description: string };
type Preview = components['schemas']['CustomerEightDSourcePreviewDto'];
type Confirmation = NonNullable<components['schemas']['CustomerEightDSourcesDto']['sourceConfirmations']>[number];
export function InternalEightDSourcePicker({ domain, report, read, disabled, onChange }: InternalEightDSourcePickerProps) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const projects = [...new Set(report.sources.map(source => source.snapshot.projectId).filter((value): value is string => typeof value === 'string'))];
  const [projectId, setProjectId] = useState(projects[0] ?? '');
  const [available, setAvailable] = useState<Source[]>();
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Source[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const originalPrimary = report.sources.find(source => source.primary)?.sourceId ?? '';
  const [primary, setPrimary] = useState(originalPrimary);
  const [preview, setPreview] = useState<Preview[]>();
  const [confirmations, setConfirmations] = useState<Record<string, Confirmation>>({});
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const closed = !!report.closedRevisionId;
  const remaining = report.sources.filter(source => !removed.includes(source.sourceId));
  function invalidate() { generation.current++; setPreview(undefined); setConfirmations({}); onChange(undefined); }
  useEffect(() => {
    let active = true; setAvailable(undefined); setError('');
    const query = new URLSearchParams({ organizationId: report.organizationId, page: String(page), pageSize: '20', search });
    void (async () => {
      if (domain === 'customer') {
        const result = await read<components['schemas']['CustomerLedgerPageDto']>(`/api/v1/customer-quality/ledger?${query}`);
        if (active) { setAvailable(result.items.map(row => ({ sourceId: row.id, expectedVersion: row.version, description: `${row.complaintNumber} · ${row.normalized.defectDescription ?? '待补正'}` }))); setTotal(result.total); }
      } else if (projectId) {
        const rows = await read<components['schemas']['NewProductDefectSelectionDto'][]>(`/api/v1/new-product-quality/projects/${encodeURIComponent(projectId)}/defect-selections?organizationId=${encodeURIComponent(report.organizationId)}`);
        const matches = rows.map(row => ({ sourceId: row.id, expectedVersion: row.source_version, description: String(row.source_snapshot.description ?? row.id) })).filter(row => row.description.includes(search));
        if (active) { setAvailable(matches.slice((page - 1) * 20, page * 20)); setTotal(matches.length); }
      } else if (active) { setAvailable([]); setTotal(0); }
    })().catch(() => { if (active) setError('来源台账加载失败，请重试。'); });
    return () => { active = false; };
  }, [domain, read, report.organizationId, report.version, projectId, search, page, revision]);
  useEffect(() => {
    generation.current++; setSelected([]); setRemoved([]); setPrimary(originalPrimary); setPreview(undefined); setConfirmations({}); setChecking(false); onChange(undefined);
    return () => { generation.current++; };
  }, [domain, report.version, originalPrimary, onChange]);
  useEffect(() => {
    if (!preview) { onChange(undefined); return; }
    const required = preview.filter(row => row.relatedProblems.length || row.hasHiddenRelations);
    if (required.some(row => !confirmations[row.sourceId] || confirmations[row.sourceId].recurrence === 'NOT_RECURRENCE' && !confirmations[row.sourceId].reason?.trim()) || !remaining.length && !selected.length || remaining.length + selected.length > 100 || (!closed && ![...remaining.map(row => row.sourceId), ...selected.map(row => row.sourceId)].includes(primary)) || closed && !selected.length) { onChange(undefined); return; }
    onChange({ add: selected.map(({ sourceId, expectedVersion }) => ({ sourceId, expectedVersion })), removeSourceIds: removed, ...(!closed ? { primarySourceId: primary } : {}), sourceConfirmations: required.map(row => confirmations[row.sourceId]) });
  }, [preview, confirmations, selected, removed, primary, report.sources, closed, onChange]);
  async function check() {
    const version = ++generation.current; setChecking(true); setError(''); onChange(undefined);
    try {
      const body: components['schemas']['CustomerEightDSourcePreviewInputDto'] = { organizationId: report.organizationId, problemId: report.problemId, sources: selected.map(({ sourceId, expectedVersion }) => ({ sourceId, expectedVersion })) };
      const rows = selected.length ? await read<Preview[]>(`${eightDDomain(domain).basePath}/sources/preview`, { method: 'POST', body: JSON.stringify(body) }) : [];
      if (version !== generation.current) return;
      if (rows.length !== selected.length || selected.some(row => !rows.some(item => item.sourceId === row.sourceId))) throw new Error('Invalid preview');
      setPreview(rows); setConfirmations({});
    } catch { if (version === generation.current) { setPreview(undefined); setError('来源预览失败，请重新核对。'); } }
    finally { if (version === generation.current) setChecking(false); }
  }
  const locked = disabled || checking;
  return <section aria-label="调整内部8D来源">

    {closed && <Alert type="info" title="关闭后仅补充来源，批准版和原主来源保持不变。" />}
    {domain === 'new-product' && <><label>新品来源项目<select aria-label="新品来源项目" disabled={locked} value={projectId} onChange={event => { setProjectId(event.target.value); setPage(1); }}>{projects.map(id => <option key={id} value={id}>{id}</option>)}</select></label></>}
    <label>搜索来源台账<Input aria-label="搜索来源台账" value={search} disabled={locked} maxLength={100} onChange={event => { setSearch(event.target.value); setPage(1); }} /></label>
    {error ? <Alert type="error" title={error} action={<Button disabled={locked} onClick={() => setRevision(value => value + 1)}>重试来源读取</Button>} /> : !available ? <Spin /> : available.filter(row => !report.sources.some(source => source.sourceId === row.sourceId)).map(row => <div key={row.sourceId}><Checkbox disabled={locked || remaining.length + selected.length >= 100 && !selected.some(item => item.sourceId === row.sourceId)} checked={selected.some(item => item.sourceId === row.sourceId)} onChange={event => { invalidate(); setSelected(previous => event.target.checked ? [...previous, row] : previous.filter(item => item.sourceId !== row.sourceId)); }}>{row.description}</Checkbox></div>)}
    {available && !available.length && <p>无匹配来源</p>}
    <Pagination current={page} pageSize={20} total={total} showSizeChanger={false} disabled={locked} onChange={setPage} />
    <h4>当前来源 / 主来源</h4>
    {report.sources.map(row => <Space wrap key={row.sourceId}><Checkbox disabled={locked || closed} checked={!removed.includes(row.sourceId)} onChange={event => { invalidate(); setRemoved(previous => event.target.checked ? previous.filter(id => id !== row.sourceId) : [...previous, row.sourceId]); }}>{String(row.snapshot.description ?? row.sourceId)}</Checkbox><Radio aria-label={`主来源 ${row.sourceId}`} disabled={locked || closed || removed.includes(row.sourceId)} checked={primary === row.sourceId} onChange={() => { invalidate(); setPrimary(row.sourceId); }}>主来源</Radio></Space>)}
    {selected.map(row => <Space wrap key={row.sourceId}><span>{row.description}</span><Button disabled={locked} onClick={() => { invalidate(); setSelected(previous => previous.filter(item => item.sourceId !== row.sourceId)); }}>移除待补来源</Button><Radio aria-label={`主来源 ${row.sourceId}`} disabled={locked || closed} checked={primary === row.sourceId} onChange={() => { invalidate(); setPrimary(row.sourceId); }}>主来源</Radio></Space>)}
    <div><Button disabled={locked || !remaining.length && !selected.length} loading={checking} onClick={() => void check()}>预览并核对来源关联</Button></div>
    {preview?.map(row => <section key={row.sourceId}><h4>{selected.find(item => item.sourceId === row.sourceId)?.description}</h4>{row.relatedProblems.map(problem => <p key={problem.problemId}>{problem.reportNumber} · {problem.title} · {problem.status}</p>)}
      {row.hasHiddenRelations && <Alert type="warning" title="另有不可见关联，请核对复发结论。" />}
      {row.relatedProblems.length || row.hasHiddenRelations ? <><label>复发关联结论<select aria-label={`复发关联结论 ${row.sourceId}`} disabled={locked} value={confirmations[row.sourceId]?.recurrence ?? ''} onChange={event => { const recurrence = event.target.value as Confirmation['recurrence']; setConfirmations(previous => { const next = { ...previous }; if (!recurrence) delete next[row.sourceId]; else next[row.sourceId] = { sourceId: row.sourceId, recurrence, relatedSetToken: row.relatedSetToken, relatedProblemIds: row.relatedProblems.map(problem => problem.problemId), ...(previous[row.sourceId]?.reason ? { reason: previous[row.sourceId].reason } : {}) }; return next; }); }}><option value="">请明确选择</option><option value="RECURRENCE">复发</option><option value="NOT_RECURRENCE">非复发继续关联</option></select></label>
        {confirmations[row.sourceId] && <label>关联说明（非复发必填）<Input.TextArea aria-label={`关联说明 ${row.sourceId}`} disabled={locked} maxLength={2000} value={confirmations[row.sourceId].reason ?? ''} onChange={event => setConfirmations(previous => ({ ...previous, [row.sourceId]: { ...previous[row.sourceId], reason: event.target.value } }))} /></label>}</> : <p>未发现其他关联</p>}
    </section>)}
  </section>;
}
