import type { components, operations } from '@qms/contracts';
import { Alert, Button, Drawer, Empty, Form, Input, Pagination, Radio, Select, Space, Spin, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest, csrfToken, getSession } from '../../api/client';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { denied, ProcessError, useProcessWrite, type Defect } from './process-ledger';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';

type Body = components['schemas']['IssueProcessEightDDto'];
type Preview = components['schemas']['ProcessEightDSourcePreviewDto'];
type Options = components['schemas']['ProcessEightDAssignmentOptionsDto'];
type Query = Pick<NonNullable<operations['ProcessEightDController_assignmentOptions']['parameters']['query']>, 'action' | 'sectionDepartmentId' | 'search'>;
type Result = components['schemas']['ProcessIssueResultDto'];
const base = '/api/v1/process-quality/eight-d';

export function ProcessEightDIssueDrawer({ sources, onClose, onIssued, onDenied }: { sources: Defect[]; onClose: () => void; onIssued: (result: Result) => void; onDenied: (cause?: unknown) => void }) {
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
  const writer = useProcessWrite(onDenied);
  const requestLeave = useNavigationGuard();
  const alive = useRef(true);
  const submitting = useRef(false);
  const sourceRefs = sources.map(record => ({ defectId: record.id, expectedVersion: record.version }));
  useUnsavedChanges(dirty || writer.uncertain);
  useNavigationBusy(writer.busy || (previewLoading && dirty));
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  async function readPreviews(signal: AbortSignal) {
    const session = await getSession();
    signal.throwIfAborted();
    if ((scope && scope !== `${session.accountType}:${session.organizationId}:${session.userId}`) || sources.some(record => record.organizationId !== session.organizationId)) {
      onDenied(); throw new Error('会话或组织已变化，请重新选择来源。');
    }
    const token = await csrfToken(signal);
    signal.throwIfAborted();
    const body: components['schemas']['ProcessEightDSourcePreviewInputDto'] = { sources: sourceRefs };
    const result = await apiRequest<Preview[]>(`${base}/sources/preview`, { method: 'POST', signal, headers: { 'x-csrf-token': token }, body: JSON.stringify(body) });
    signal.throwIfAborted();
    if (result.length !== sources.length || sources.some(source => !result.some(item => item.defectId === source.id))) throw new Error('来源预览不完整，请重试。');
    return result;
  }
  async function loadPreviews() {
    setPreviewLoading(true); setError(undefined);
    try { const next = await readPreviews(writer.signal()); if (alive.current) { setPreviews(next); setConfirmations({}); } }
    catch (cause) { if (alive.current) { setPreviews(undefined); setError(cause); if (denied(cause)) onDenied(cause); } }
    finally { if (alive.current) setPreviewLoading(false); }
  }
  useEffect(() => { void loadPreviews(); }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setOptionsLoading(true); setOptionsError(undefined);
    // Department and department-scoped owner searches have separate pagination.
    const departmentQuery: Query = { action: 'ISSUE', search: departmentSearch };
    const ownerQuery: Query = { action: 'ISSUE', search: userSearch, sectionDepartmentId: section };
    const read = (query: Query, page: number) => {
      const params = new URLSearchParams({ page: String(page), pageSize: '100' });
      Object.entries(query).forEach(([key, value]) => { if (value !== undefined) params.set(key, value); });
      return apiRequest<Options>(`${base}/assignment-options?${params}`, { signal: controller.signal });
    };
    void Promise.all([read(departmentQuery, departmentPage), section ? read(ownerQuery, userPage) : Promise.resolve(undefined)]).then(([departmentOptions, ownerOptions]) => {
      if (!active) return;
      setDepartments(departmentOptions.departments); setDepartmentTotal(departmentOptions.departmentTotal);
      setUsers(ownerOptions?.users ?? []); setUserTotal(ownerOptions?.userTotal ?? 0);
    }).catch(cause => { if (active) { setOptionsError(cause); setUsers([]); setDepartments([]); if (denied(cause)) onDenied(cause); } }).finally(() => { if (active) setOptionsLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [section, departmentPage, departmentSearch, userPage, userSearch, optionRevision]);

  async function submit(values: Body) {
    if (submitting.current || !previews) return;
    const required = previews;
    if (required.some(item => !confirmations[item.defectId])) { setError(new Error('请逐来源明确选择复发或非复发。')); return; }
    submitting.current = true; setError(undefined);
    try {
      if (!writer.uncertain) {
        setPreviewLoading(true);
        const fresh = await readPreviews(writer.signal());
        const fingerprint = (items: Preview[]) => JSON.stringify(items.map(item => [item.defectId, item.relatedSetToken, item.hasHiddenRelations, item.relatedProblems]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
        if (fingerprint(fresh) !== fingerprint(previews)) {
          setPreviews(fresh); setConfirmations({}); setChangedRelations(true); return;
        }
        if (!users.some(user => user.id === values.ownerUserId) || values.responsibleSectionDepartmentId !== section) throw new Error('请重新选择当前科室有效负责人。');
      }
      const sourceConfirmations: Body['sourceConfirmations'] = required.map(item => ({ defectId: item.defectId, relatedProblemIds: item.relatedProblems.map(problem => problem.problemId), relatedSetToken: item.relatedSetToken, recurrence: confirmations[item.defectId], ...(reasons[item.defectId]?.trim() ? { reason: reasons[item.defectId].trim() } : {}) }));
      const body: Body = { sources: sourceRefs, severity: values.severity, responsibleSectionDepartmentId: values.responsibleSectionDepartmentId, ownerUserId: values.ownerUserId,
        ...(values.analysisDueAt ? { analysisDueAt: new Date(`${values.analysisDueAt}T23:59:59`).toISOString() } : {}),
        ...(values.closureDueAt ? { closureDueAt: new Date(`${values.closureDueAt}T23:59:59`).toISOString() } : {}), sourceConfirmations };
      const result = await writer.write<Result>(base, body, 'POST');
      if (alive.current) { setDirty(false); onIssued(result); }
    } catch (cause) { if (alive.current) { setError(cause); if (denied(cause)) onDenied(cause); } }
    finally { submitting.current = false; if (alive.current) setPreviewLoading(false); }
  }
  return <Drawer open title="发起正式内部8D" size="min(760px, 100vw)" onClose={() => { if (!writer.busy && !previewLoading) requestLeave(onClose, true); }} closable={!writer.busy} keyboard={!writer.busy} mask={{ closable: !writer.busy }}>
    <Typography.Paragraph>已选择 {sources.length} 条来源。</Typography.Paragraph>
    <ProcessError cause={error} fallback={error instanceof Error ? error.message : '发单失败，请重试。'} />
    {writer.uncertain ? <Alert type="warning" title="发单结果未知；请勿更改请求，重试将使用原请求及同一幂等键。" /> : null}
    {changedRelations ? <Alert type="warning" title="关联集合已变化，请按最新预览重新逐条确认；已保留发单草稿。" /> : null}
    {previewLoading ? <Spin aria-label="加载来源预览" /> : !previews ? <Button onClick={() => void loadPreviews()}>重试来源预览</Button> : <section aria-label="发单来源预览" className="process-quality-source-preview">{previews.map(item => <section key={item.defectId} className="process-quality-card">
      <Typography.Text strong>{sources.find(record => record.id === item.defectId)?.description}</Typography.Text>
      {item.relatedProblems.map(problem => <div key={problem.problemId}><Link to={`/app/problem-workspace/${problem.problemId}`}>{problem.reportNumber}</Link> · <span>{problem.title}</span> <span>{problem.status}</span></div>)}
      {item.hasHiddenRelations ? <Alert type="warning" title="部分关联问题无权查看。" /> : null}
      {!item.relatedProblems.length && !item.hasHiddenRelations ? <Typography.Paragraph type="secondary">尚无已关联问题</Typography.Paragraph> : null}
      <Radio.Group aria-label={`来源复发判定 ${item.defectId}`} disabled={writer.busy || writer.uncertain || previewLoading} value={confirmations[item.defectId]} onChange={event => { setDirty(true); setConfirmations(current => ({ ...current, [item.defectId]: event.target.value })); }}><Radio value="RECURRENCE">复发</Radio><Radio value="NOT_RECURRENCE">非复发</Radio></Radio.Group><Input aria-label={`判定说明 ${item.defectId}`} placeholder="判定说明（可空）" maxLength={2000} disabled={writer.busy || writer.uncertain || previewLoading} value={reasons[item.defectId] ?? ''} onChange={event => { setDirty(true); setReasons(current => ({ ...current, [item.defectId]: event.target.value })); }} />
    </section>)}</section>}
    <ProcessError cause={optionsError} fallback="责任候选加载失败，请重试。" />
    <Form form={form} layout="vertical" disabled={writer.busy || writer.uncertain || previewLoading} onValuesChange={() => setDirty(true)} onFinish={values => void submit(values)}>
      <Form.Item name="severity" label="风险等级" rules={[{ required: true, message: '请选择风险等级' }]}><Select options={[{ value: 'LOW', label: '低' }, { value: 'MEDIUM', label: '中' }, { value: 'HIGH', label: '高' }, { value: 'CRITICAL', label: '重大' }]} /></Form.Item>
      <Form.Item name="responsibleSectionDepartmentId" label="责任科室" rules={[{ required: true, message: '请选择责任科室' }]}><Select loading={optionsLoading} showSearch filterOption={false} onSearch={value => { setDepartmentSearch(value); setDepartmentPage(1); }} options={optionsLoading ? [] : departments.map(department => ({ value: department.id, label: department.name }))} onChange={value => { setSection(value); setUsers([]); setUserSearch(''); setUserPage(1); form.setFieldValue('ownerUserId', undefined); }} notFoundContent={optionsLoading ? <Spin size="small" /> : <Empty description="无有效责任科室" />} /></Form.Item>
      {departmentTotal > 100 ? <Pagination aria-label="责任科室候选分页" disabled={writer.busy || writer.uncertain || previewLoading} current={departmentPage} pageSize={100} total={departmentTotal} showSizeChanger={false} onChange={setDepartmentPage} /> : null}
      <Form.Item name="ownerUserId" label="负责人" rules={[{ required: true, message: '请选择该科室有效负责人' }]}><Select disabled={!section || writer.busy || writer.uncertain || previewLoading} loading={optionsLoading} showSearch filterOption={false} onSearch={value => { setUserSearch(value); setUserPage(1); }} options={optionsLoading ? [] : users.map(user => ({ value: user.id, label: user.fullName ?? user.username }))} notFoundContent={optionsLoading ? <Spin size="small" /> : <Empty description="该科室暂无有效负责人" />} /></Form.Item>
      {userTotal > 100 ? <Pagination aria-label="负责人候选分页" disabled={writer.busy || writer.uncertain || previewLoading} current={userPage} pageSize={100} total={userTotal} showSizeChanger={false} onChange={setUserPage} /> : null}
      {optionsError ? <Button onClick={() => setOptionRevision(value => value + 1)}>重试责任候选</Button> : null}
      <div className="process-quality-form-grid"><Form.Item name="analysisDueAt" label="分析/对策期限"><Input type="date" /></Form.Item><Form.Item name="closureDueAt" label="关闭计划"><Input type="date" /></Form.Item></div>
      <Space><Button type="primary" htmlType="submit" loading={writer.busy || previewLoading} disabled={!previews || writer.busy || previewLoading || !!optionsError || optionsLoading}>{writer.uncertain ? '同请求重试发起8D' : '确认发起8D'}</Button></Space>
    </Form>
  </Drawer>;
}
