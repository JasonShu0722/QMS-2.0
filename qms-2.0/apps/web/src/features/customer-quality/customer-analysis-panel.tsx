import type { components } from '@qms/contracts';
import { Alert, Button, Descriptions, Empty, Form, Input, Modal, Select, Space, Spin, Tag, Typography } from 'antd';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, apiRequest, getSession, safeAccountError, type SessionView } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { AttachmentPanel } from '../attachments/AttachmentPanel';
import type { Attachment } from '../attachments/attachments';
import { createCustomerAnalysisWrite, customerAnalysisBase as base, customerAnalysisDenied, customerFaeDraft, customerSupplierDraft,
  type CustomerAnalysis, type CustomerAnalysisBody, type CustomerAnalysisCandidate, type CustomerAnalysisHistory, type CustomerAnalysisSection as Section,
  type CustomerAnalysisSummary, type CustomerFaeDraft, type CustomerSupplierDraft } from './customer-analysis';
import './customer-analysis.css';

type Props = { complaintId: string; onDenied?: (cause: ApiError) => void; organizationId?: string; sourceRecord?: components['schemas']['CustomerLedgerDetailDto'] };
type Assignment = { section: Section; transfer: boolean; candidates?: CustomerAnalysisCandidate[]; selected?: string };
type Operation = { section: Section; path: string; method: 'POST' | 'PUT'; body: CustomerAnalysisBody };
const titles: Record<Section, string> = { FAE: 'FAE 解析', SUPPLIER: '供应商分析' };
const keys = ['FAE', 'SUPPLIER'] as const;
const slot = (section: Section) => section === 'FAE' ? 'fae' : 'supplier';
const actionLabels: Record<CustomerAnalysisHistory['action'], string> = { ASSIGNED: '指定', TRANSFERRED: '转派', SAVED: '保存' };

export function CustomerAnalysisPanel(props: Props) {
  const sessionScope = useWorkTabsStore(state => state.sessionScope);
  const [params] = useSearchParams();
  const organizationId = props.organizationId ?? params.get('organizationId') ?? undefined;
  return <AnalysisContent key={JSON.stringify([sessionScope, organizationId, props.complaintId])} {...props} organizationId={organizationId} sessionScope={sessionScope} />;
}

function AnalysisContent({ complaintId, organizationId, sourceRecord, onDenied, sessionScope }: Props & { sessionScope?: string }) {
  const { t } = useLanguage();
  const guard = useNavigationGuard();
  const [summary, setSummary] = useState<CustomerAnalysisSummary>();
  const [source, setSource] = useState<components['schemas']['CustomerLedgerDetailDto']>();
  const [permissions, setPermissions] = useState<string[]>([]);
  const [actor, setActor] = useState<SessionView>();
  const [faeDraft, setFaeDraft] = useState<CustomerFaeDraft>();
  const [supplierDraft, setSupplierDraft] = useState<CustomerSupplierDraft>();
  const [dirty, setDirty] = useState({ FAE: false, SUPPLIER: false });
  const [pending, setPending] = useState({ FAE: false, SUPPLIER: false });
  const [uploadIntent, setUploadIntent] = useState({ FAE: false, SUPPLIER: false });
  const [attachmentEpoch, setAttachmentEpoch] = useState({ FAE: 0, SUPPLIER: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<unknown>();
  const [lost, setLost] = useState(false);
  const [assignment, setAssignment] = useState<Assignment>();
  const [history, setHistory] = useState<{ section: Section; rows?: CustomerAnalysisHistory[] }>();
  const [dialogError, setDialogError] = useState<unknown>();
  const lifetime = useRef<AbortController>(undefined);
  const alive = useRef(false);
  const denied = useRef(false);
  const readGeneration = useRef(0);
  const dialogGeneration = useRef(0);
  const mutationLock = useRef(false);
  const writer = useRef<ReturnType<typeof createCustomerAnalysisWrite>>(undefined);
  const operation = useRef<Operation>(undefined);
  const pendingRef = useRef(pending); pendingRef.current = pending;
  const uploadIntentRef = useRef(uploadIntent); uploadIntentRef.current = uploadIntent;
  const readyFiles = useRef<Record<Section, Map<string, Attachment>>>({ FAE: new Map(), SUPPLIER: new Map() });
  const deniedCallback = useRef(onDenied); deniedCallback.current = onDenied;
  const parentSource = useRef(sourceRecord); parentSource.current = sourceRecord;
  const canWrite = source?.status === 'FOLLOWING' && actor?.accountType === 'INTERNAL' && actor.organizationId === source.organizationId && permissions.includes('customer-quality:complaints:write');
  const canAssign = canWrite && source?.qualityEngineerId === actor?.userId && !!source?.qualityEngineerAssignmentId
    && !source.warnings?.some(warning => warning.code === 'ENGINEER_NO_LONGER_ELIGIBLE') && (source.stage !== 'NEW_PRODUCT' || permissions.includes('new-product-quality:projects:write'));
  const writable = (section: Section) => !!canWrite && summary?.[slot(section)]?.assigneeUserId === actor?.userId && permissions.includes(`customer-quality:analyses:${section === 'FAE' ? 'fae' : 'supplier'}`);
  const eligibility = useRef({ assign: false, FAE: false, SUPPLIER: false });
  eligibility.current = { assign: !!canAssign, FAE: writable('FAE'), SUPPLIER: writable('SUPPLIER') };
  const assignmentAllowed = !!assignment && eligibility.current[assignment.transfer ? assignment.section : 'assign'];
  function canMutate(attempt: Operation) {
    return attempt.method === 'PUT' || attempt.path.endsWith('/transfer') ? eligibility.current[attempt.section] : eligibility.current.assign;
  }
  const canRetry = !!operation.current && canMutate(operation.current);
  const current = () => alive.current && !denied.current && !lifetime.current?.signal.aborted && useWorkTabsStore.getState().sessionScope === sessionScope;
  const scoped = (path: string) => organizationId ? `${path}?organizationId=${encodeURIComponent(organizationId)}` : path;
  const uploading = pending.FAE || pending.SUPPLIER || uploadIntent.FAE || uploadIntent.SUPPLIER;
  const locked = loading || busy || uploading || uncertain;
  useUnsavedChanges(dirty.FAE || dirty.SUPPLIER || !!assignment?.selected || uncertain || uploading);
  useNavigationBusy(busy || uploading);

  useLayoutEffect(() => {
    if (!sourceRecord || sourceRecord.id !== complaintId || (organizationId && sourceRecord.organizationId !== organizationId)) return;
    // Sync confirmed source facts before paint without resetting either analysis draft.
    setSource(previous => !previous || (previous.organizationId === sourceRecord.organizationId && sourceRecord.version >= previous.version) ? sourceRecord : previous);
  }, [sourceRecord, complaintId, organizationId]);

  function revoke(cause: ApiError) {
    if (!current()) return;
    denied.current = true; lifetime.current?.abort(); readGeneration.current++; dialogGeneration.current++;
    writer.current = undefined; operation.current = undefined; readyFiles.current = { FAE: new Map(), SUPPLIER: new Map() };
    setSummary(undefined); setSource(undefined); setActor(undefined); setPermissions([]); setFaeDraft(undefined); setSupplierDraft(undefined);
    setAssignment(undefined); setHistory(undefined); setDialogError(undefined); setDirty({ FAE: false, SUPPLIER: false });
    setPending({ FAE: false, SUPPLIER: false }); setUploadIntent({ FAE: false, SUPPLIER: false }); setBusy(false); setUncertain(false); setLoading(false); setLost(true); setError(cause);
    deniedCallback.current?.(cause);
  }
  function failure(cause: unknown, dialog = false) {
    if (!current()) return;
    if (customerAnalysisDenied(cause)) revoke(cause);
    else if (dialog) setDialogError(cause); else setError(cause);
  }
  function install(record: CustomerAnalysis) {
    setSummary(previous => previous ? { ...previous, [slot(record.section)]: record } : previous);
    if (record.section === 'FAE') setFaeDraft(customerFaeDraft(record)); else setSupplierDraft(customerSupplierDraft(record));
    setDirty(previous => ({ ...previous, [record.section]: false }));
  }
  async function load() {
    const generation = ++readGeneration.current;
    const sourceAtStart = parentSource.current;
    setLoading(true); setError(undefined);
    try {
      const signal = lifetime.current!.signal;
      const session = await getSession();
      if (!current() || generation !== readGeneration.current) return;
      if (sessionScope && sessionScope !== `${session.accountType}:${session.organizationId}:${session.userId}`) throw new ApiError({ code: 'AUTH_SESSION_REQUIRED', message: '' }, 401);
      const access = await apiRequest<components['schemas']['PermissionsResponseDto']>(scoped('/api/v1/system/my-permissions'), { signal });
      if (!current() || generation !== readGeneration.current) return;
      if (!access.permissions.includes('customer-quality:complaints:read')) throw new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: '' }, 403);
      // A slow sibling read must not keep revoked drafts or attachments visible.
      const read = <T,>(path: string) => apiRequest<T>(scoped(path), { signal }).catch(cause => { failure(cause); throw cause; });
      const [next, detail] = await Promise.all([read<CustomerAnalysisSummary>(`${base}/complaints/${encodeURIComponent(complaintId)}`), read<components['schemas']['CustomerLedgerDetailDto']>(`/api/v1/customer-quality/ledger/${encodeURIComponent(complaintId)}`)]);
      if (!current() || generation !== readGeneration.current) return;
      if (next.complaintId !== complaintId || detail.id !== complaintId || detail.organizationId !== access.organizationId || (organizationId && access.organizationId !== organizationId)
        || keys.some(section => { const record = next[slot(section)]; return record && (record.section !== section || record.complaintId !== complaintId || record.organizationId !== detail.organizationId); })) throw new ApiError({ code: 'ORGANIZATION_SCOPE_DENIED', message: '' }, 403);
      setActor(session); setPermissions(access.permissions); setSummary(next);
      setSource(previous => previous?.organizationId === detail.organizationId
        && (previous.version > detail.version || (previous.version === detail.version && parentSource.current !== sourceAtStart)) ? previous : detail);
      setFaeDraft(next.fae ? customerFaeDraft(next.fae) : undefined); setSupplierDraft(next.supplier ? customerSupplierDraft(next.supplier) : undefined);
      setDirty({ FAE: false, SUPPLIER: false }); readyFiles.current = { FAE: new Map(), SUPPLIER: new Map() };
      writer.current = createCustomerAnalysisWrite(session, () => current() && !pendingRef.current.FAE && !pendingRef.current.SUPPLIER && !uploadIntentRef.current.FAE && !uploadIntentRef.current.SUPPLIER && !!operation.current && canMutate(operation.current));
    } catch (cause) { if (generation === readGeneration.current) failure(cause); }
    finally { if (current() && generation === readGeneration.current) setLoading(false); }
  }
  useEffect(() => {
    alive.current = true; lifetime.current = new AbortController();
    const unsubscribe = useWorkTabsStore.subscribe(state => { if (state.sessionScope !== sessionScope) lifetime.current?.abort(); });
    void load();
    return () => { alive.current = false; lifetime.current?.abort(); unsubscribe(); };
  }, []);

  const pendingFae = useCallback((value: boolean) => { if (current()) { pendingRef.current = { ...pendingRef.current, FAE: value }; setPending(pendingRef.current); } }, []);
  const pendingSupplier = useCallback((value: boolean) => { if (current()) { pendingRef.current = { ...pendingRef.current, SUPPLIER: value }; setPending(pendingRef.current); } }, []);
  function changeFiles(section: Section, change: (ids: string[]) => string[]) {
    if (!current()) return;
    if (section === 'FAE') setFaeDraft(draft => draft ? { ...draft, fileIds: change(draft.fileIds ?? []) } : draft);
    else setSupplierDraft(draft => draft ? { ...draft, fileIds: change(draft.fileIds ?? []) } : draft);
    setDirty(previous => ({ ...previous, [section]: true }));
  }
  function acceptFile(section: Section, file: Attachment) {
    const record = summary?.[slot(section)];
    if (!current() || !record || !writable(section) || busy || uncertain || file.status !== 'AVAILABLE' || file.scanStatus !== 'CLEAN'
      || file.resourceType !== 'customer-complaint-analysis' || file.resourceId !== record.id) return false;
    const ids = (section === 'FAE' ? faeDraft : supplierDraft)?.fileIds ?? [];
    if (ids.length >= 20 && !ids.includes(file.id)) { setError(new Error('附件最多关联 20 份，请先移除多余附件。')); return false; }
    readyFiles.current[section].set(file.id, file);
    uploadIntentRef.current = { ...uploadIntentRef.current, [section]: false }; setUploadIntent(uploadIntentRef.current);
    changeFiles(section, currentIds => [...new Set([...currentIds, file.id])]);
    return true;
  }
  function observeFiles(section: Section, files: Attachment[]) {
    if (!current()) return;
    const map = readyFiles.current[section];
    for (const file of files) {
      const old = map.get(file.id);
      if (file.resourceType === 'customer-complaint-analysis' && file.resourceId === summary?.[slot(section)]?.id && (!old || old.version <= file.version)) map.set(file.id, file);
    }
    // Metadata errors must not silently remove saved evidence references.
  }
  async function mutate(next?: Operation) {
    if (!current() || mutationLock.current || pendingRef.current.FAE || pendingRef.current.SUPPLIER || uploadIntentRef.current.FAE || uploadIntentRef.current.SUPPLIER || !writer.current) return;
    if (!uncertain && next) operation.current = next;
    const attempt = operation.current;
    if (!attempt || !canMutate(attempt)) return;
    mutationLock.current = true; setBusy(true); setError(undefined); setDialogError(undefined);
    try {
      const result = await writer.current.run(attempt.path, attempt.method, attempt.body, lifetime.current!.signal);
      if (!current()) return;
      if (result.complaintId !== complaintId || result.organizationId !== source?.organizationId || result.section !== attempt.section) throw new ApiError({ code: 'ORGANIZATION_SCOPE_DENIED', message: '' }, 403);
      install(result); operation.current = undefined; setAssignment(undefined); dialogGeneration.current++;
    } catch (cause) { failure(cause); }
    finally { mutationLock.current = false; if (current()) { setBusy(false); setUncertain(writer.current?.uncertain ?? false); } }
  }
  function save(section: Section) {
    const record = summary?.[slot(section)]; const draft = section === 'FAE' ? faeDraft : supplierDraft;
    if (!record || !draft || locked || !writable(section)) return;
    const map = readyFiles.current[section];
    const invalid = (draft.fileIds ?? []).some(id => { const file = map.get(id); return !file || file.status !== 'AVAILABLE' || file.scanStatus !== 'CLEAN'; });
    if (invalid) { setError(new Error('附件尚未完成安全扫描或读取，请刷新附件后保存。')); return; }
    void mutate({ section, path: `${base}/${encodeURIComponent(record.id)}/${section === 'FAE' ? 'fae' : 'supplier'}`, method: 'PUT', body: draft });
  }
  function resetDrafts() {
    if (summary?.fae) setFaeDraft(customerFaeDraft(summary.fae));
    if (summary?.supplier) setSupplierDraft(customerSupplierDraft(summary.supplier));
    setDirty({ FAE: false, SUPPLIER: false });
  }
  async function openAssignment(section: Section, transfer: boolean) {
    if (!current() || !eligibility.current[transfer ? section : 'assign']) return;
    const generation = ++dialogGeneration.current;
    setAssignment({ section, transfer }); setHistory(undefined); setDialogError(undefined);
    try {
      const candidates = await apiRequest<CustomerAnalysisCandidate[]>(scoped(`${base}/complaints/${encodeURIComponent(complaintId)}/candidates/${section}`), { signal: lifetime.current!.signal });
      if (current() && generation === dialogGeneration.current && eligibility.current[transfer ? section : 'assign']) setAssignment({ section, transfer, candidates });
    } catch (cause) { if (customerAnalysisDenied(cause) || generation === dialogGeneration.current) failure(cause, true); }
  }
  function confirmAssignment() {
    if (!assignment || locked || !assignmentAllowed) return;
    const target = assignment.candidates?.find(candidate => `${candidate.userId}:${candidate.assignmentId}` === assignment.selected);
    if (!target || !source) return;
    const record = summary?.[slot(assignment.section)];
    const body: components['schemas']['AssignCustomerAnalysisDto'] = { organizationId: source.organizationId, expectedVersion: record?.version ?? 0, assigneeUserId: target.userId, assigneeAssignmentId: target.assignmentId };
    void mutate({ section: assignment.section, method: 'POST', body, path: assignment.transfer && record ? `${base}/${encodeURIComponent(record.id)}/transfer` : `${base}/complaints/${encodeURIComponent(complaintId)}/assign/${assignment.section}` });
  }
  async function openHistory(section: Section) {
    const record = summary?.[slot(section)]; if (!record) return;
    const generation = ++dialogGeneration.current;
    setHistory({ section }); setAssignment(undefined); setDialogError(undefined);
    try {
      const rows = await apiRequest<CustomerAnalysisHistory[]>(scoped(`${base}/${encodeURIComponent(record.id)}/history`), { signal: lifetime.current!.signal });
      if (current() && generation === dialogGeneration.current) setHistory({ section, rows });
    } catch (cause) { if (customerAnalysisDenied(cause) || generation === dialogGeneration.current) failure(cause, true); }
  }
  const errorMessage = (cause: unknown) => cause instanceof ApiError && cause.status === 409 ? '记录已更新，当前输入已保留；请核对后刷新解析。'
    : cause instanceof ApiError ? safeAccountError(cause) : cause instanceof Error && cause.message.startsWith('附件') ? cause.message : '解析请求失败，请重试。';
  function closeAssignment() { if (!busy && !uncertain) guard(() => { dialogGeneration.current++; setAssignment(undefined); setDialogError(undefined); }, true); }

  return <section className="customer-analysis" aria-label={t('客诉解析协作')}>
    <header className="customer-analysis__heading"><div><Typography.Title level={4}>{t('解析协作')}</Typography.Title><Typography.Text type="secondary">{t('FAE 与 SQE 独立维护，不增加审批或发单关卡。')}</Typography.Text></div>
      {!lost && <Button disabled={locked} onClick={() => guard(() => { setAssignment(undefined); setHistory(undefined); dialogGeneration.current++; void load(); })}>{t('刷新解析')}</Button>}</header>
    {error ? <Alert showIcon type={lost ? 'warning' : 'error'} title={t(errorMessage(error))} description={error instanceof ApiError ? error.traceId : undefined} /> : null}
    {uncertain && <Alert showIcon type="warning" title={t('操作结果尚未确认，当前输入已锁定。重试只发送原请求。')} action={<Button disabled={busy || uploading || !canRetry} onClick={() => void mutate()}>{t('重试确认解析结果')}</Button>} />}
    {loading ? <Spin aria-label={t('正在加载解析')} /> : !lost && !summary ? <Button onClick={() => void load()}>{t('重试加载解析')}</Button> : null}
    {!lost && summary && <div className="customer-analysis__sections">{keys.map(section => {
      const record = summary[slot(section)]; const draft = section === 'FAE' ? faeDraft : supplierDraft;
      const edit = !!writable(section); const disabled = !edit || busy || uncertain || loading;
      return <section className="customer-analysis__section" aria-label={t(titles[section])} key={section}>
        <div className="customer-analysis__heading"><Typography.Title level={5}>{t(titles[section])}</Typography.Title><Space wrap>
          {section === 'FAE' && record && <Tag color={record.faeStatus === 'ANALYSED' ? 'green' : 'default'}>{t(record.faeStatus === 'ANALYSED' ? '已解析' : '未解析')}</Tag>}
          {record && <Button disabled={busy || uncertain || !!assignment} onClick={() => void openHistory(section)}>{t(section === 'FAE' ? '查看 FAE 历史' : '查看供应商分析历史')}</Button>}
          {canAssign && (section === 'SUPPLIER' || !record) && <Button disabled={locked} onClick={() => guard(() => { resetDrafts(); void openAssignment(section, false); })}>{t(section === 'FAE' ? '指定 FAE' : '指定 SQE')}</Button>}
          {section === 'FAE' && record && edit && <Button disabled={locked} onClick={() => guard(() => { resetDrafts(); void openAssignment(section, true); })}>{t('同部门转派 FAE')}</Button>}
        </Space></div>
        {!record ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('尚未指定解析人，请由当前质量工程师先指定，再上传附件。')} /> : <>
          <Descriptions size="small" column={1} items={[{ key: 'assignee', label: t('当前解析人'), children: <span>{record.assigneeUserId}<small className="customer-analysis__assignment">{t('任职')} {record.assigneeAssignmentId}</small></span> }, { key: 'version', label: t('已保存版本'), children: record.version }]} />
          <Form layout="vertical" disabled={disabled}>
            {section === 'FAE' && faeDraft ? <>
              <Form.Item label={t('FAE 解析文字')} htmlFor={`customer-fae-text-${record.id}`}><Input.TextArea id={`customer-fae-text-${record.id}`} value={faeDraft.text ?? ''} rows={4} maxLength={10000} onChange={event => { setFaeDraft({ ...faeDraft, text: event.target.value }); setDirty(previous => ({ ...previous, FAE: true })); }} /></Form.Item>
              <div className="customer-analysis__fields">
                <Form.Item label={t('解析完成日期')} htmlFor={`customer-fae-date-${record.id}`}><Input id={`customer-fae-date-${record.id}`} type="date" value={faeDraft.completedOn ?? ''} onChange={event => { setFaeDraft({ ...faeDraft, completedOn: event.target.value || null }); setDirty(previous => ({ ...previous, FAE: true })); }} /></Form.Item>
                <Form.Item label={t('失效零件')} htmlFor={`customer-fae-part-${record.id}`}><Input id={`customer-fae-part-${record.id}`} value={faeDraft.failedPart ?? ''} maxLength={200} onChange={event => { setFaeDraft({ ...faeDraft, failedPart: event.target.value }); setDirty(previous => ({ ...previous, FAE: true })); }} /></Form.Item>
                <Form.Item label={t('失效物料编码')} htmlFor={`customer-fae-material-${record.id}`}><Input id={`customer-fae-material-${record.id}`} value={faeDraft.failedMaterialCode ?? ''} maxLength={200} onChange={event => { setFaeDraft({ ...faeDraft, failedMaterialCode: event.target.value }); setDirty(previous => ({ ...previous, FAE: true })); }} /></Form.Item>
                <Form.Item label={t('是否需要供应商分析')} htmlFor={`customer-fae-supplier-${record.id}`}><Select id={`customer-fae-supplier-${record.id}`} value={faeDraft.supplierAnalysisRequired === null ? undefined : String(faeDraft.supplierAnalysisRequired)} allowClear placeholder={t('未填写')} options={[{ value: 'true', label: t('是') }, { value: 'false', label: t('否') }]} onChange={value => { setFaeDraft({ ...faeDraft, supplierAnalysisRequired: value === undefined ? null : value === 'true' }); setDirty(previous => ({ ...previous, FAE: true })); }} /></Form.Item>
              </div>
            </> : section === 'SUPPLIER' && supplierDraft ? <>
              <Form.Item label={t('供应商分析进度')} htmlFor={`customer-supplier-progress-${record.id}`}><Input.TextArea id={`customer-supplier-progress-${record.id}`} rows={3} maxLength={10000} value={supplierDraft.progress ?? ''} onChange={event => { setSupplierDraft({ ...supplierDraft, progress: event.target.value }); setDirty(previous => ({ ...previous, SUPPLIER: true })); }} /></Form.Item>
              <Form.Item label={t('供应商分析结果')} htmlFor={`customer-supplier-result-${record.id}`}><Input.TextArea id={`customer-supplier-result-${record.id}`} rows={4} maxLength={10000} value={supplierDraft.result ?? ''} onChange={event => { setSupplierDraft({ ...supplierDraft, result: event.target.value }); setDirty(previous => ({ ...previous, SUPPLIER: true })); }} /></Form.Item>
            </> : null}
          </Form>
          <div onChangeCapture={event => {
            const input = event.target;
            if (current() && input instanceof HTMLInputElement && input.type === 'file' && input.files?.length) {
              // Selection is only an unsettled intent, never uploaded or CLEAN evidence.
              uploadIntentRef.current = { ...uploadIntentRef.current, [section]: true }; setUploadIntent(uploadIntentRef.current);
            }
          }}><AttachmentPanel key={`${record.id}:${readGeneration.current}:${attachmentEpoch[section]}`} resource={{ resourceType: 'customer-complaint-analysis', resourceId: record.id }} fileIds={draft?.fileIds ?? record.fileIds} readOnly={disabled || (draft?.fileIds?.length ?? 0) >= 20}
            onReady={file => acceptFile(section, file)} onRemoved={id => { readyFiles.current[section].delete(id); changeFiles(section, ids => ids.filter(value => value !== id)); }}
            onFilesChanged={files => observeFiles(section, files)} onPendingChange={section === 'FAE' ? pendingFae : pendingSupplier} onAccessDenied={revoke} /></div>
          {uploadIntent[section] && <Space wrap><Typography.Text type="warning">{t('所选附件尚未成为可用证据，请等待扫描或重试上传。')}</Typography.Text><Button disabled={pending[section] || busy || uncertain} onClick={() => {
            uploadIntentRef.current = { ...uploadIntentRef.current, [section]: false }; setUploadIntent(uploadIntentRef.current);
            setAttachmentEpoch(previous => ({ ...previous, [section]: previous[section] + 1 }));
          }}>{t('放弃未关联附件')}</Button><Typography.Text type="secondary">{t('仅放弃本次未关联附件；不删除已上传对象，解析文字保持不变。')}</Typography.Text></Space>}
          {edit && !!draft?.fileIds?.length && <Space wrap>{draft.fileIds.map(id => <Button key={id} disabled={locked} onClick={() => { readyFiles.current[section].delete(id); changeFiles(section, ids => ids.filter(value => value !== id)); }}>{t('移除附件引用')} {id}</Button>)}</Space>}
          {edit && <div className="qms-dialog-actions"><Typography.Text type="secondary">{t(dirty[section] ? '当前修改尚未保存' : '当前内容已保存')}</Typography.Text><Button type="primary" disabled={locked} loading={busy && operation.current?.section === section} onClick={() => save(section)}>{t(section === 'FAE' ? '保存 FAE 解析' : '保存供应商分析')}</Button></div>}
        </>}
      </section>;
    })}</div>}
    {!lost && <Modal open={!!assignment} title={t(assignment?.transfer ? '同部门转派 FAE' : assignment?.section === 'FAE' ? '指定 FAE' : '指定 SQE')} onCancel={closeAssignment} footer={<div className="qms-dialog-actions"><Button disabled={busy || uncertain} onClick={closeAssignment}>{t('取消')}</Button>{uncertain ? <Button type="primary" disabled={busy || uploading || !canRetry} loading={busy} onClick={() => void mutate()}>{t('重试确认解析结果')}</Button> : <Button type="primary" disabled={locked || !assignment?.selected || !assignmentAllowed} loading={busy} onClick={confirmAssignment}>{t(assignment?.transfer ? '确认转派' : '确认指定')}</Button>}</div>} closable={!busy && !uncertain} mask={{ closable: !busy && !uncertain }}>
      {dialogError && assignment ? <Alert type="error" showIcon title={t(errorMessage(dialogError))} action={<Button disabled={busy || uncertain || !assignmentAllowed} onClick={() => void openAssignment(assignment.section, assignment.transfer)}>{t('重试加载候选人')}</Button>} /> : null}
      {error && assignment ? <Alert type="error" showIcon title={t(errorMessage(error))} /> : null}
      {assignment?.candidates ? <Form layout="vertical"><Form.Item label={t('解析人及有效任职')}><Select aria-label={t('解析人及有效任职')} placeholder={t('选择解析人及任职')} disabled={busy || uncertain || !assignmentAllowed} value={assignment.selected} options={assignment.candidates.map(candidate => ({ value: `${candidate.userId}:${candidate.assignmentId}`, label: `${candidate.username} · ${t('任职')} ${candidate.assignmentId}` }))} onChange={selected => setAssignment({ ...assignment, selected })} /></Form.Item>{!assignment.candidates.length && <Empty description={t('当前没有具备权限和有效任职的候选人')} />}</Form> : assignment && !dialogError ? <Spin aria-label={t('正在加载候选人')} /> : null}
      <Typography.Paragraph type="secondary">{t(assignment?.transfer ? '仅当前 FAE 可在同部门内转派；服务端会重新校验任职、权限和版本。' : '由当前质量工程师指定；指定成功后才可上传解析附件。')}</Typography.Paragraph>
    </Modal>}
    {!lost && <Modal open={!!history} title={t(history?.section === 'FAE' ? 'FAE 解析历史' : '供应商分析历史')} footer={null} onCancel={() => { dialogGeneration.current++; setHistory(undefined); setDialogError(undefined); }}>
      {dialogError && history ? <Alert type="error" showIcon title={t(errorMessage(dialogError))} action={<Button onClick={() => void openHistory(history.section)}>{t('重试加载解析历史')}</Button>} /> : null}
      {history?.rows ? history.rows.length ? <ol className="customer-analysis__history">{history.rows.map(row => <li key={row.id}><Space wrap><Tag>{t(actionLabels[row.action])}</Tag><Typography.Text>{t('版本')} {row.snapshot.version}</Typography.Text><time dateTime={row.snapshot.updatedAt}>{row.snapshot.updatedAt}</time></Space><Typography.Paragraph>{row.snapshot.text || row.snapshot.progress || t('未填写文字')}</Typography.Paragraph>{row.snapshot.result && <Typography.Paragraph>{row.snapshot.result}</Typography.Paragraph>}<Typography.Text type="secondary">{t('解析人')} {row.snapshot.assigneeUserId} · {t('任职')} {row.snapshot.assigneeAssignmentId} · {t('附件')} {row.snapshot.fileIds.length}</Typography.Text></li>)}</ol> : <Empty description={t('暂无解析历史')} /> : history && !dialogError ? <Spin aria-label={t('正在加载解析历史')} /> : null}
    </Modal>}
  </section>;
}
