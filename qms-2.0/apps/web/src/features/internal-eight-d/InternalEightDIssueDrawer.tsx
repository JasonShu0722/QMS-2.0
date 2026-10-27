import type { components, operations } from '@qms/contracts';
import { Alert, Button, Drawer, Empty, Form, Input, Pagination, Radio, Select, Space, Spin, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiRequest, csrfToken, getSession } from '../../api/client';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { denied, ProcessError } from '../process-quality/process-ledger';
import { useCustomerLedgerWrite } from '../customer-quality/customer-ledger-write';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';

type Body = components['schemas']['IssueCustomerEightDDto'] | components['schemas']['IssueNewProductEightDDto'];
type Preview = components['schemas']['CustomerEightDSourcePreviewDto'];
type Options = components['schemas']['ProcessEightDAssignmentOptionsDto'];
type Query = Pick<NonNullable<operations['ProcessEightDController_assignmentOptions']['parameters']['query']>, 'action' | 'sectionDepartmentId' | 'search'>;
type Result = components['schemas']['ProcessIssueResultDto'];
export type EightDIssueSource = Pick<components['schemas']['CustomerLedgerItemDto'], 'id' | 'version' | 'organizationId'> & { description: string; projectId?: components['schemas']['NewProductDefectSelectionDto']['project_id'] };
export type InternalEightDDomain = 'customer-quality' | 'new-product-quality';

export function InternalEightDIssueDrawer({ domain, organizationId, sources, onClose, onIssued, onDenied }: { domain: InternalEightDDomain; organizationId?: string; sources: EightDIssueSource[]; onClose: () => void; onIssued: (result: Result) => void; onDenied: (cause: unknown) => void }) {
  const base = `/api/v1/${domain}/eight-d`;
  const [form] = Form.useForm<Body>();
  const scope = useWorkTabsStore(state => state.sessionScope);
  const [previews, setPreviews] = useState<Preview[]>();
  const [confirmations, setConfirmations] = useState<Record<string, 'RECURRENCE' | 'NOT_RECURRENCE'>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>();
  const [previewLoading, setPreviewLoading] = useState(true);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState<unknown>();
  const [departments, setDepartments] = useState<Options['departments']>([]);
  const [users, setUsers] = useState<Options['users']>([]);
  const [departmentTotal, setDepartmentTotal] = useState(0);
  const [userTotal, setUserTotal] = useState(0);
  const [departmentPage, setDepartmentPage] = useState(1);
  const [userPage, setUserPage] = useState(1);
  const [departmentSearch, setDepartmentSearch] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [optionRevision, setOptionRevision] = useState(0);
  const [section, setSection] = useState<string>();
  const [dirty, setDirty] = useState(false);
  const [changedRelations, setChangedRelations] = useState(false);
  const [baseline, setBaseline] = useState(sources);
  const [proposal, setProposal] = useState<{ sources: EightDIssueSource[]; context: string }>();
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceConflict, setSourceConflict] = useState(false);
  const writer = useCustomerLedgerWrite(cause => { if (isCurrent()) onDenied(cause); });
  const requestLeave = useNavigationGuard();
  const alive = useRef(true);
  const submitting = useRef(false);
  const sourcePending = useRef(false);
  const initialScope = useRef(scope);
  const selection = JSON.stringify([domain, organizationId, sources.map(({ id, organizationId: org, projectId }) => [id, org, projectId])]);
  const context = JSON.stringify([scope, selection]);
  const liveContext = useRef(context); liveContext.current = context;
  const initialSelection = useRef(selection);
  const invalidatedRef = useRef(false);
  invalidatedRef.current ||= scope !== initialScope.current || selection !== initialSelection.current;
  const invalidated = invalidatedRef.current;
  const sourceRefs = baseline.map(record => ({ sourceId: record.id, expectedVersion: record.version }));
  const busy = writer.busy || previewLoading || sourceLoading;
  useUnsavedChanges(dirty || writer.uncertain);
  useNavigationBusy(writer.busy || sourceLoading || (previewLoading && dirty));
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  function isCurrent(expectedContext = context) {
    return alive.current && !invalidatedRef.current && liveContext.current === expectedContext && useWorkTabsStore.getState().sessionScope === scope;
  }
  async function guardRead<T>(request: Promise<T>, signal: AbortSignal, expectedContext = context) {
    try { return await request; }
    catch (cause) {
      // A sibling may already have rejected Promise.all before this read loses access.
      if (!signal.aborted && isCurrent(expectedContext) && denied(cause)) { setPreviews(undefined); onDenied(cause); }
      throw cause;
    }
  }
  function guard(signal: AbortSignal, expectedContext: string) {
    signal.throwIfAborted();
    if (!alive.current || invalidatedRef.current) throw new DOMException('Drawer closed or invalidated', 'AbortError');
    if (useWorkTabsStore.getState().sessionScope !== initialScope.current || scope !== initialScope.current) throw new ApiError({ code: 'AUTH_SESSION_REQUIRED', message: '' }, 401);
    if (liveContext.current !== expectedContext || selection !== initialSelection.current) throw new Error('来源选择已变化，请重新打开抽屉；当前草稿未提交。');
  }
  async function sourceSession(signal: AbortSignal, expectedContext: string) {
    if (!sources.length || sources.length > 100 || sources.some(record => !record.id?.trim() || !Number.isSafeInteger(record.version) || record.version < 1) || new Set(sources.map(record => record.id)).size !== sources.length) throw new Error('来源标识或版本不完整，请重新选择真实来源。');
    const session = await getSession();
    guard(signal, expectedContext);
    if (session.accountType !== 'INTERNAL' || useWorkTabsStore.getState().sessionScope !== scope || (scope && scope !== `${session.accountType}:${session.organizationId}:${session.userId}`) || sources.some(record => record.organizationId !== (organizationId ?? session.organizationId))) {
      throw new ApiError({ code: 'AUTH_SESSION_REQUIRED', message: '' }, 401);
    }
    return session;
  }
  async function readPreviews(signal: AbortSignal, records = baseline) {
    const expectedContext = context;
    await sourceSession(signal, expectedContext);
    const token = await csrfToken(signal);
    guard(signal, expectedContext);
    const body: components['schemas']['CustomerEightDSourcePreviewInputDto'] = { organizationId, sources: records.map(record => ({ sourceId: record.id, expectedVersion: record.version })) };
    const result = await apiRequest<Preview[]>(`${base}/sources/preview`, { method: 'POST', signal, headers: { 'x-csrf-token': token }, body: JSON.stringify(body) });
    guard(signal, expectedContext);
    if (result.length !== records.length || records.some(source => !result.some(item => item.sourceId === source.id))) throw new Error('来源预览不完整，请重试。');
    return result;
  }
  async function loadPreviews(records = baseline) {
    if (invalidated) return;
    setPreviewLoading(true); setError(undefined);
    try { const next = await readPreviews(writer.signal(), records); if (isCurrent()) { setPreviews(next); setConfirmations({}); setSourceConflict(false); } }
    catch (cause) { if (isCurrent()) { setPreviews(undefined); setError(cause); if (cause instanceof ApiError && cause.status === 409) setSourceConflict(true); if (denied(cause)) onDenied(cause); } }
    finally { if (isCurrent()) setPreviewLoading(false); }
  }
  useEffect(() => { void loadPreviews(); }, []);
  useEffect(() => {
    setProposal(undefined);
    if (!invalidated) return;
    setPreviews(undefined); setConfirmations({}); setReasons({}); setDepartments([]); setUsers([]);
    form.resetFields(); setSection(undefined); setDirty(false); setPreviewLoading(false); setSourceLoading(false); setOptionsLoading(false); setOptionsError(undefined);
    setError(new Error('来源选择或会话已变化，请重新打开抽屉。'));
  }, [context, invalidated]);

  async function refreshSources() {
    if (invalidated || submitting.current || sourcePending.current || busy || writer.uncertain) return;
    sourcePending.current = true; setSourceLoading(true); setProposal(undefined); setError(undefined);
    const signal = writer.signal(); const expectedContext = context;
    try {
      if (domain === 'new-product-quality' && baseline.some(record => !record.projectId)) throw new Error('缺少新品项目标识，无法读取来源版本；请联系维护人员补齐入口。');
      const session = await guardRead(sourceSession(signal, expectedContext), signal, expectedContext);
      const params = new URLSearchParams({ organizationId: organizationId ?? session.organizationId });
      const selections = new Map<string, Promise<components['schemas']['NewProductDefectSelectionDto'][]>>();
      const next = await Promise.all(baseline.map(async record => {
        let value: EightDIssueSource;
        if (domain === 'customer-quality') {
          const detail = await guardRead(apiRequest<components['schemas']['CustomerLedgerDetailDto']>(`/api/v1/customer-quality/ledger/${encodeURIComponent(record.id)}?${params}`, { signal }), signal, expectedContext);
          guard(signal, expectedContext);
          value = { id: detail.id, organizationId: detail.organizationId, version: detail.version, description: `${detail.complaintNumber} · ${detail.normalized.defectDescription ?? '待补正'}` };
        } else {
          const projectId = record.projectId!;
          if (!selections.has(projectId)) selections.set(projectId, guardRead(apiRequest<components['schemas']['NewProductDefectSelectionDto'][]>(`/api/v1/new-product-quality/projects/${encodeURIComponent(projectId)}/defect-selections?${params}`, { signal }), signal, expectedContext));
          const rows = await selections.get(projectId)!;
          guard(signal, expectedContext);
          const selected = rows.find(row => row.id === record.id);
          if (!selected) throw new Error('来源选择已不存在，无法恢复；当前草稿已保留。');
          if (selected.project_id !== projectId) throw new Error('来源项目不一致，无法恢复；当前草稿已保留。');
          value = { id: selected.id, organizationId: selected.organization_id, projectId, version: selected.source_version, description: String(selected.source_snapshot.description ?? selected.id) };
        }
        if (value.id !== record.id || value.organizationId !== record.organizationId || !Number.isSafeInteger(value.version) || value.version < 1) throw new Error('来源读取不完整或不一致，无法恢复；当前草稿已保留。');
        return value;
      }));
      guard(signal, expectedContext); setProposal({ sources: next, context: expectedContext });
    } catch (cause) { if (isCurrent(expectedContext)) setError(cause); }
    finally { sourcePending.current = false; if (isCurrent(expectedContext)) setSourceLoading(false); }
  }
  async function adoptSources() {
    if (!proposal || submitting.current || sourcePending.current || busy || writer.uncertain) return;
    try { guard(writer.signal(), proposal.context); }
    catch (cause) { setProposal(undefined); setError(cause); if (denied(cause)) onDenied(cause); return; }
    // Only explicit adoption can discard a known failed attempt; unknown writes stay exact-retry only.
    writer.discard(); setBaseline(proposal.sources); setProposal(undefined); setPreviews(undefined); setConfirmations({}); setReasons({}); setDirty(true);
    setChangedRelations(false); sourcePending.current = true;
    try { await loadPreviews(proposal.sources); }
    finally { sourcePending.current = false; }
  }

  useEffect(() => {
    if (invalidated) return;
    const controller = new AbortController();
    let active = true;
    setOptionsLoading(true); setOptionsError(undefined);
    // Department and department-scoped owner searches have separate pagination.
    const departmentQuery: Query = { action: 'ISSUE', search: departmentSearch };
    const ownerQuery: Query = { action: 'ISSUE', search: userSearch, sectionDepartmentId: section };
    const read = (query: Query, page: number) => {
      const params = new URLSearchParams({ page: String(page), pageSize: '100' });
      if (organizationId) params.set('organizationId', organizationId);
      Object.entries(query).forEach(([key, value]) => { if (value !== undefined) params.set(key, value); });
      return guardRead(apiRequest<Options>(`${base}/assignment-options?${params}`, { signal: controller.signal }), controller.signal);
    };
    void Promise.all([read(departmentQuery, departmentPage), section ? read(ownerQuery, userPage) : Promise.resolve(undefined)]).then(([departmentOptions, ownerOptions]) => {
      if (!active || !isCurrent()) return;
      setDepartments(departmentOptions.departments); setDepartmentTotal(departmentOptions.departmentTotal);
      setUsers(ownerOptions?.users ?? []); setUserTotal(ownerOptions?.userTotal ?? 0);
    }).catch(cause => { if (active && isCurrent()) { setOptionsError(cause); setUsers([]); setDepartments([]); } }).finally(() => { if (active && isCurrent()) setOptionsLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [section, departmentPage, departmentSearch, userPage, userSearch, optionRevision, context, invalidated]);

  async function submit(values: Body) {
    if (invalidated || submitting.current || sourcePending.current || busy || proposal || sourceConflict || !previews || !sources.length || sources.length > 100) return;
    const required = previews.filter(item => item.relatedProblems.length || item.hasHiddenRelations);
    if (required.some(item => !confirmations[item.sourceId] || confirmations[item.sourceId] === 'NOT_RECURRENCE' && (item.relatedProblems.length > 0 || item.hasHiddenRelations) && !reasons[item.sourceId]?.trim())) { setError(new Error('请逐来源明确选择复发或非复发；已有关联的非复发须填写说明。')); return; }
    submitting.current = true; setError(undefined);
    try {
      if (!writer.uncertain) {
        setPreviewLoading(true);
        const fresh = await readPreviews(writer.signal());
        const fingerprint = (items: Preview[]) => JSON.stringify(items.map(item => [item.sourceId, item.relatedSetToken, item.hasHiddenRelations, item.relatedProblems]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
        if (fingerprint(fresh) !== fingerprint(previews)) {
          setPreviews(fresh); setConfirmations({}); setChangedRelations(true); return;
        }
        if (!users.some(user => user.id === values.ownerUserId) || values.responsibleSectionDepartmentId !== section) throw new Error('请重新选择当前科室有效负责人。');
      }
      const sourceConfirmations: Body['sourceConfirmations'] = required.map(item => ({ sourceId: item.sourceId, relatedProblemIds: item.relatedProblems.map(problem => problem.problemId), relatedSetToken: item.relatedSetToken, recurrence: confirmations[item.sourceId], ...(reasons[item.sourceId]?.trim() ? { reason: reasons[item.sourceId].trim() } : {}) }));
      const body: Body = { organizationId, sources: sourceRefs, severity: values.severity, responsibleSectionDepartmentId: values.responsibleSectionDepartmentId, ownerUserId: values.ownerUserId,
        ...(values.analysisDueAt ? { analysisDueAt: new Date(`${values.analysisDueAt}T23:59:59`).toISOString() } : {}),
        ...(values.closureDueAt ? { closureDueAt: new Date(`${values.closureDueAt}T23:59:59`).toISOString() } : {}), sourceConfirmations };
      const result = await writer.write<Result>(base, body, 'POST', () => { guard(writer.signal(), context); return !sourcePending.current; });
      if (isCurrent()) { setDirty(false); onIssued(result); }
    } catch (cause) { if (isCurrent()) { setError(cause); if (cause instanceof ApiError && cause.status === 409) { setSourceConflict(true); setPreviews(undefined); } if (denied(cause)) onDenied(cause); } }
    finally { submitting.current = false; if (isCurrent()) setPreviewLoading(false); }
  }
  return <Drawer open title="发起正式内部8D" size="min(760px, 100vw)" onClose={() => { if (!busy) requestLeave(onClose, true); }} closable={!busy} keyboard={!busy} mask={{ closable: !busy }}>
    <Typography.Paragraph>已选择 {sources.length} 条来源（跨页保留，上限100条）。受控流程及版本由服务端解析，实际发单人为专业审核人。</Typography.Paragraph>
    <ProcessError cause={error} fallback={error instanceof Error ? error.message : '发单失败，请重试。'} />
    {writer.uncertain ? <Alert type="warning" title="发单结果未知；请勿更改请求，重试将使用原请求及同一幂等键。" /> : null}
    <Button disabled={invalidated || busy || writer.uncertain} loading={sourceLoading} onClick={() => void refreshSources()}>重新读取来源版本</Button>
    {proposal ? <section aria-label="来源版本变化" className="process-quality-source-preview">
      <Typography.Paragraph>仅重新读取了来源，尚未采用；确认采用后重新预览，风险、责任人和期限草稿保留。</Typography.Paragraph>
      {proposal.sources.map(record => <section key={record.id} className="process-quality-card"><Typography.Text strong>{record.id}</Typography.Text><Typography.Paragraph>版本：v{baseline.find(item => item.id === record.id)?.version} → v{record.version}</Typography.Paragraph><Typography.Paragraph>原描述：{baseline.find(item => item.id === record.id)?.description}</Typography.Paragraph><Typography.Paragraph>最新描述：{record.description}</Typography.Paragraph></section>)}
      <Space><Button disabled={busy || writer.uncertain} onClick={() => setProposal(undefined)}>取消恢复</Button><Button type="primary" disabled={busy || writer.uncertain} onClick={() => void adoptSources()}>确认采用并预览</Button></Space>
    </section> : null}
    {changedRelations ? <Alert type="warning" title="关联集合已变化，请按最新预览重新逐条确认；已保留发单草稿。" /> : null}
    {previewLoading ? <Spin aria-label="加载来源预览" /> : !previews ? <Button disabled={invalidated} onClick={() => void loadPreviews()}>重试来源预览</Button> : <section aria-label="发单来源预览" className="process-quality-source-preview">{previews.map(item => <section key={item.sourceId} className="process-quality-card">
      <Typography.Text strong>{baseline.find(record => record.id === item.sourceId)?.description}</Typography.Text>
      {item.relatedProblems.map(problem => <div key={problem.problemId}><Link to={`/app/problem-workspace/${problem.problemId}`}>{problem.reportNumber}</Link> · <span>{problem.title}</span> <span>{problem.status}</span></div>)}
      {item.hasHiddenRelations ? <Alert type="warning" title="存在无权查看的关联，仅显示获权问题；确认令牌将在发单事务中精确复验。" /> : null}
      {!item.relatedProblems.length && !item.hasHiddenRelations ? <Typography.Paragraph type="secondary">未发现其他关联，不需要复发判定。</Typography.Paragraph> : <>
      <Radio.Group aria-label={`来源复发判定 ${item.sourceId}`} disabled={busy || writer.uncertain || !!proposal} value={confirmations[item.sourceId]} onChange={event => { setDirty(true); setConfirmations(current => ({ ...current, [item.sourceId]: event.target.value })); }}><Radio value="RECURRENCE">复发</Radio><Radio value="NOT_RECURRENCE">非复发</Radio></Radio.Group><Input aria-label={`判定说明 ${item.sourceId}`} placeholder="判定说明（非复发必填）" maxLength={2000} disabled={busy || writer.uncertain || !!proposal} value={reasons[item.sourceId] ?? ''} onChange={event => { setDirty(true); setReasons(current => ({ ...current, [item.sourceId]: event.target.value })); }} />
      </>}
    </section>)}</section>}
    <ProcessError cause={optionsError} fallback="责任候选加载失败，请重试。" />
    <Form form={form} layout="vertical" disabled={invalidated || busy || writer.uncertain} onValuesChange={() => setDirty(true)} onFinish={values => void submit(values)}>
      <Form.Item name="severity" label="风险等级" rules={[{ required: true, message: '请选择风险等级' }]}><Select options={[{ value: 'LOW', label: '低' }, { value: 'MEDIUM', label: '中' }, { value: 'HIGH', label: '高' }, { value: 'CRITICAL', label: '重大' }]} /></Form.Item>
      <Form.Item name="responsibleSectionDepartmentId" label="责任科室" rules={[{ required: true, message: '请选择责任科室' }]}><Select loading={optionsLoading} showSearch filterOption={false} onSearch={value => { setDepartmentSearch(value); setDepartmentPage(1); }} options={optionsLoading ? [] : departments.map(department => ({ value: department.id, label: department.name }))} onChange={value => { setSection(value); setUsers([]); setUserSearch(''); setUserPage(1); form.setFieldValue('ownerUserId', undefined); }} notFoundContent={optionsLoading ? <Spin size="small" /> : <Empty description="无有效责任科室" />} /></Form.Item>
      {departmentTotal > 100 ? <Pagination aria-label="责任科室候选分页" disabled={busy || writer.uncertain} current={departmentPage} pageSize={100} total={departmentTotal} showSizeChanger={false} onChange={setDepartmentPage} /> : null}
      <Form.Item name="ownerUserId" label="负责人" rules={[{ required: true, message: '请选择该科室有效负责人' }]}><Select disabled={invalidated || !section || busy || writer.uncertain} loading={optionsLoading} showSearch filterOption={false} onSearch={value => { setUserSearch(value); setUserPage(1); }} options={optionsLoading ? [] : users.map(user => ({ value: user.id, label: user.fullName ?? user.username }))} notFoundContent={optionsLoading ? <Spin size="small" /> : <Empty description="该科室暂无有效负责人" />} /></Form.Item>
      {userTotal > 100 ? <Pagination aria-label="负责人候选分页" disabled={busy || writer.uncertain} current={userPage} pageSize={100} total={userTotal} showSizeChanger={false} onChange={setUserPage} /> : null}
      {optionsError ? <Button onClick={() => setOptionRevision(value => value + 1)}>重试责任候选</Button> : null}
      <div className="process-quality-form-grid"><Form.Item name="analysisDueAt" label="分析/对策期限"><Input type="date" /></Form.Item><Form.Item name="closureDueAt" label="关闭计划"><Input type="date" /></Form.Item></div>
      <Typography.Paragraph type="secondary">期限需显式选择日期；留空表示尚未设定，不填默认天数。</Typography.Paragraph>
      <Space><Button type="primary" htmlType="submit" loading={writer.busy || previewLoading} disabled={!previews || busy || !!proposal || sourceConflict || !!optionsError || optionsLoading}>{writer.uncertain ? '同请求重试发起8D' : '确认发起8D'}</Button></Space>
    </Form>
  </Drawer>;
}
