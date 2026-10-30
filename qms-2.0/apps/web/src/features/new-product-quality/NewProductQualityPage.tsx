import { Alert, Button, Descriptions, Empty, Input, InputNumber, List, Modal, Space, Spin, Tag, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, csrfToken, getSession, safeAccountError } from '../../api/client';
import { AttachmentPanel } from '../attachments/AttachmentPanel';
import { NewProductIssueClosurePanel } from './NewProductIssueClosurePanel';
import { NewProductEightDPanel } from './NewProductEightDPanel';
import './new-product-quality.css';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';

type Project = components['schemas']['NewProductProjectDetailDto'];
type TrialReport = components['schemas']['NewProductTrialReportDto'];
type TrialSummary = components['schemas']['NewProductTrialSummaryDto'];

function errorMessage(cause: unknown) {
  if (cause instanceof ApiError) return safeAccountError(cause);
  return '新产品项目加载失败，请重试。';
}

function permissionDenied(cause: unknown) {
  if (cause instanceof ApiError) return cause.status === 403 || cause.code === 'FEATURE_PERMISSION_DENIED' || cause.code === 'ORGANIZATION_SCOPE_DENIED';
  return typeof cause === 'object' && cause !== null && ((cause as { status?: number }).status === 403 || ['FEATURE_PERMISSION_DENIED', 'ORGANIZATION_SCOPE_DENIED'].includes((cause as { code?: string }).code ?? ''));
}

const projectStatus: Record<Project['status'], string> = { ACTIVE: '进行中', ARCHIVED: '已归档' };

export function NewProductQualityPage({ projectId: initialProjectId }: { projectId?: string } = {}) {
  const [input, setInput] = useState(initialProjectId ?? '');
  const [projectId, setProjectId] = useState(initialProjectId ?? '');
  const [project, setProject] = useState<Project>();
  const [eightDOpen, setEightDOpen] = useState(false);
  const [loading, setLoading] = useState(Boolean(initialProjectId));
  const [error, setError] = useState<unknown>();
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [riskStatement, setRiskStatement] = useState('');
  const [handoverBusy, setHandoverBusy] = useState(false);
  const [handoverError, setHandoverError] = useState<unknown>();
  const [trialReport, setTrialReport] = useState<TrialReport>();
  const [trialReportLoading, setTrialReportLoading] = useState(false);
  const [trialReportBatchId, setTrialReportBatchId] = useState<string>();
  const [trialReportError, setTrialReportError] = useState<unknown>();
  const projectRequestId = useRef(0);
  const reportRequestId = useRef(0);
  const [trialSummary, setTrialSummary] = useState<TrialSummary>();
  const [summaryLoaded, setSummaryLoaded] = useState(false);
  const [summaryConclusion, setSummaryConclusion] = useState('');
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryError, setSummaryError] = useState<unknown>();
  const [summaryDecisionNote, setSummaryDecisionNote] = useState('');
  const [summaryDownloadBusy, setSummaryDownloadBusy] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>();
  const [sessionError, setSessionError] = useState(false);
  const [earlyFlowOpen, setEarlyFlowOpen] = useState(false);
  const [earlyFlowEditing, setEarlyFlowEditing] = useState(false);
  const [earlyFlowDays, setEarlyFlowDays] = useState(30);
  const [earlyFlowPlan, setEarlyFlowPlan] = useState('');
  const [earlyFlowFrequency, setEarlyFlowFrequency] = useState('');
  const [earlyFlowExitCriteria, setEarlyFlowExitCriteria] = useState('');
  const [releaseEvidenceId, setReleaseEvidenceId] = useState('');
  const [releaseNote, setReleaseNote] = useState('');
  const [earlyFlowBusy, setEarlyFlowBusy] = useState(false);
  const [earlyFlowError, setEarlyFlowError] = useState<unknown>();
  const [earlyFlowDirty, setEarlyFlowDirty] = useState(false);
  const [summaryDirty, setSummaryDirty] = useState(false);
  const [draftEpoch, setDraftEpoch] = useState(0);
  const requestLeave = useNavigationGuard();
  const writing = handoverBusy || summaryBusy || earlyFlowBusy;
  useUnsavedChanges(Boolean(riskStatement) || earlyFlowDirty || summaryDirty || Boolean(summaryDecisionNote) || Boolean(releaseNote) || Boolean(releaseEvidenceId));
  useNavigationBusy(writing);
  function discardDrafts() {
    setDraftEpoch((value) => value + 1);
    setRiskStatement(''); setHandoverOpen(false); setEarlyFlowOpen(false); setEarlyFlowDirty(false); setSummaryDirty(false); setSummaryDecisionNote(''); setReleaseNote(''); setReleaseEvidenceId('');
  }
  function lookup(id = projectId) { if (!writing) requestLeave(() => { discardDrafts(); void load(id, true); }); }
  function openReport(id: string) { if (!writing) requestLeave(() => { setSummaryDirty(false); setSummaryDecisionNote(''); void loadTrialReport(id); }); }
  function closeHandover() { if (!writing) requestLeave(() => { setHandoverOpen(false); setRiskStatement(''); }, true); }
  function closeEarlyFlow() { if (!writing) requestLeave(() => { setEarlyFlowOpen(false); setEarlyFlowDirty(false); }, true); }

  async function load(id = projectId, resetDrafts = false) {
    const value = id.trim();
    if (!value) return;
    const requestId = ++projectRequestId.current;
    setProjectId(value);
    setLoading(true);
    setError(undefined);
    if (resetDrafts || value !== project?.id) {
      reportRequestId.current += 1;
      setTrialReport(undefined);
      setTrialReportError(undefined);
      setTrialSummary(undefined);
      setSummaryLoaded(false);
      setSummaryDownloadBusy(false);
      setSummaryConclusion('');
      setSummaryError(undefined);
      setReleaseEvidenceId('');
      setReleaseNote('');
    }
    try { const next = await apiRequest<Project>(`/api/v1/new-product-quality/projects/${value}`); if (projectRequestId.current === requestId) setProject(next); }
    catch (cause) { if (projectRequestId.current === requestId) { if (permissionDenied(cause) || value !== project?.id) setProject(undefined); setError(cause); } }
    finally { if (projectRequestId.current === requestId) setLoading(false); }
  }

  async function downloadSummary(format: 'xlsx' | 'pdf') {
    if (!trialReport || !trialSummary || trialSummary.status !== 'APPROVED') return;
    setSummaryDownloadBusy(true);
    const requestId = reportRequestId.current;
    try {
      const response = await fetch(`/api/v1/new-product-quality/trial-batches/${trialReport.id}/summary/export/${format}?expectedVersion=${trialSummary.version}`, { credentials: 'include' });
      if (!response.ok) {
        const payload = response.headers.get('content-type')?.includes('application/json') ? await response.json() : {};
        throw new ApiError({ code: payload.code ?? `HTTP_${response.status}`, message: '报告下载失败', traceId: payload.traceId }, response.status);
      }
      const url = URL.createObjectURL(await response.blob());
      if (reportRequestId.current !== requestId) { URL.revokeObjectURL(url); return; }
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `qms-trial-summary-${trialReport.id}-v${trialSummary.version}.${format}`; anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) { if (reportRequestId.current === requestId) setSummaryError(cause); } finally { if (reportRequestId.current === requestId) setSummaryDownloadBusy(false); }
  }

  useEffect(() => { if (initialProjectId) void load(initialProjectId); }, [initialProjectId]);
  useEffect(() => {
    let active = true;
    getSession().then((session) => { if (active) setCurrentUserId(session.userId); }).catch(() => { if (active) setSessionError(true); });
    return () => { active = false; };
  }, []);

  async function handover() {
    if (!project || writing || !riskStatement.trim()) return;
    setHandoverBusy(true);
    setHandoverError(undefined);
    try {
      const token = await csrfToken();
      await apiRequest(`/api/v1/new-product-quality/projects/${project.id}/handover`, { method: 'POST', headers: { 'x-csrf-token': token, 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ expectedVersion: project.version, riskStatement: riskStatement.trim() }) });
      setHandoverOpen(false);
      setRiskStatement('');
      await load(project.id);
    } catch (cause) { setHandoverError(cause); }
    finally { setHandoverBusy(false); }
  }

  async function loadTrialReport(batchId: string) {
    const requestId = ++reportRequestId.current;
    setTrialReportLoading(true);
    setTrialReportBatchId(batchId);
    setTrialReportError(undefined);
    setTrialReport(undefined);
    setTrialSummary(undefined);
    setSummaryLoaded(false);
    setSummaryDownloadBusy(false);
    setSummaryConclusion('');
    setSummaryError(undefined);
    try {
      const report = await apiRequest<TrialReport>(`/api/v1/new-product-quality/trial-batches/${batchId}/report`);
      if (reportRequestId.current !== requestId) return;
      setTrialReport(report);
      try {
        const summary = await apiRequest<TrialSummary>(`/api/v1/new-product-quality/trial-batches/${batchId}/summary`);
        if (reportRequestId.current === requestId) { setTrialSummary(summary); setSummaryConclusion(summary?.conclusion ?? ''); }
      } catch (cause) {
        if (reportRequestId.current === requestId) { if (cause instanceof ApiError && cause.status === 404) setTrialSummary(undefined); else setSummaryError(cause); }
      } finally {
        if (reportRequestId.current === requestId) setSummaryLoaded(true);
      }
    } catch (cause) {
      if (reportRequestId.current === requestId) { setTrialReport(undefined); setTrialReportError(cause); }
    } finally {
      if (reportRequestId.current === requestId) setTrialReportLoading(false);
    }
  }

  async function createSummary(batchId: string) {
    if (writing || !summaryConclusion.trim()) return;
    const requestId = reportRequestId.current;
    setSummaryBusy(true); setSummaryError(undefined);
    try {
      const token = await csrfToken();
      const summary = await apiRequest<TrialSummary>(`/api/v1/new-product-quality/trial-batches/${batchId}/summary`, { method: 'POST', headers: { 'x-csrf-token': token, 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ conclusion: summaryConclusion.trim() }) });
      if (reportRequestId.current === requestId) { setTrialSummary(summary); setSummaryDirty(false); }
    } catch (cause) { if (reportRequestId.current === requestId) setSummaryError(cause); } finally { if (reportRequestId.current === requestId) setSummaryBusy(false); }
  }

  async function submitSummary(batchId: string) {
    if (!trialSummary || writing) return;
    const requestId = reportRequestId.current;
    setSummaryBusy(true); setSummaryError(undefined);
    try { const token = await csrfToken(); const summary = await apiRequest<TrialSummary>(`/api/v1/new-product-quality/trial-batches/${batchId}/summary/submit`, { method: 'PUT', headers: { 'x-csrf-token': token, 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ expectedVersion: trialSummary.version }) }); if (reportRequestId.current === requestId) setTrialSummary(summary); }
    catch (cause) { if (reportRequestId.current === requestId) setSummaryError(cause); } finally { if (reportRequestId.current === requestId) setSummaryBusy(false); }
  }

  async function decideSummary(batchId: string, decision: 'APPROVE' | 'REJECT') {
    if (writing || !trialSummary || !currentUserId || !trialSummary.submittedById || trialSummary.submittedById === currentUserId || decision === 'REJECT' && !summaryDecisionNote.trim()) return;
    const requestId = reportRequestId.current;
    setSummaryBusy(true); setSummaryError(undefined);
    try {
      const token = await csrfToken();
      const summary = await apiRequest<TrialSummary>(`/api/v1/new-product-quality/trial-batches/${batchId}/summary/decision`, { method: 'PUT', headers: { 'x-csrf-token': token, 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ expectedVersion: trialSummary.version, decision, note: summaryDecisionNote.trim() || undefined }) });
      if (reportRequestId.current === requestId) { setTrialSummary(summary); setSummaryConclusion(summary.conclusion); setSummaryDecisionNote(''); }
    } catch (cause) { if (reportRequestId.current === requestId) setSummaryError(cause); }
    finally { if (reportRequestId.current === requestId) setSummaryBusy(false); }
  }

  async function reviseSummary(batchId: string) {
    if (writing || !trialSummary || !summaryConclusion.trim()) return;
    const requestId = reportRequestId.current;
    setSummaryBusy(true); setSummaryError(undefined);
    try {
      const token = await csrfToken();
      const summary = await apiRequest<TrialSummary>(`/api/v1/new-product-quality/trial-batches/${batchId}/summary/revise`, { method: 'PUT', headers: { 'x-csrf-token': token, 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ expectedVersion: trialSummary.version, conclusion: summaryConclusion.trim() }) });
      if (reportRequestId.current === requestId) { setTrialSummary(summary); setSummaryConclusion(''); setSummaryDirty(false); }
    } catch (cause) { if (reportRequestId.current === requestId) setSummaryError(cause); }
    finally { if (reportRequestId.current === requestId) setSummaryBusy(false); }
  }

  async function createEarlyFlow() {
    if (writing || !project || !earlyFlowPlan.trim() || !earlyFlowFrequency.trim() || !earlyFlowExitCriteria.trim()) return;
    setEarlyFlowBusy(true);
    setEarlyFlowError(undefined);
    try {
      const token = await csrfToken();
      const body = { monitoringWindowDays: earlyFlowDays, monitoringFrequency: earlyFlowFrequency.trim(), plan: earlyFlowPlan.trim(), exitCriteria: earlyFlowExitCriteria.trim() };
      await apiRequest(earlyFlowEditing && project.early_flow ? `/api/v1/new-product-quality/early-flows/${project.early_flow.id}/revise` : `/api/v1/new-product-quality/projects/${project.id}/early-flow`, { method: earlyFlowEditing ? 'PUT' : 'POST', headers: { 'x-csrf-token': token, 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(earlyFlowEditing && project.early_flow ? { ...body, expectedVersion: project.early_flow.version } : body) });
      setEarlyFlowOpen(false);
      setEarlyFlowDirty(false);
      setEarlyFlowPlan('');
      setEarlyFlowFrequency('');
      setEarlyFlowExitCriteria('');
      await load(project.id);
    } catch (cause) { setEarlyFlowError(cause); }
    finally { setEarlyFlowBusy(false); }
  }

  function openEarlyFlowEditor() {
    if (writing) return;
    requestLeave(() => {
      setEarlyFlowDirty(false);
      setEarlyFlowEditing(Boolean(project?.early_flow));
      setEarlyFlowDays(project?.early_flow?.monitoringWindowDays ?? 30);
      setEarlyFlowFrequency(project?.early_flow?.monitoringFrequency === '未记录' ? '' : project?.early_flow?.monitoringFrequency ?? '');
      setEarlyFlowPlan(project?.early_flow?.plan ?? '');
      setEarlyFlowExitCriteria(project?.early_flow?.exitCriteria === '未记录' ? '' : project?.early_flow?.exitCriteria ?? '');
      setEarlyFlowOpen(true);
    });
  }

  async function decideEarlyFlowRelease(decision: 'APPROVE' | 'REJECT') {
    if (writing || !project?.early_flow || !releaseEvidenceId || project.early_flow.submittedById === currentUserId || decision === 'REJECT' && !releaseNote.trim()) return;
    setEarlyFlowBusy(true); setEarlyFlowError(undefined);
    try {
      const token = await csrfToken();
      await apiRequest(`/api/v1/new-product-quality/early-flows/${project.early_flow.id}/release`, { method: 'PUT', headers: { 'x-csrf-token': token, 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ expectedVersion: project.early_flow.version, decision, evidenceObjectId: releaseEvidenceId, note: releaseNote.trim() || undefined }) });
      setReleaseEvidenceId(''); setReleaseNote('');
      await load(project.id);
    } catch (cause) { setEarlyFlowError(cause); }
    finally { setEarlyFlowBusy(false); }
  }

  async function transitionEarlyFlow(action: 'submit' | 'approve') {
    if (writing || !project?.early_flow) return;
    setEarlyFlowBusy(true);
    setEarlyFlowError(undefined);
    try {
      const token = await csrfToken();
      const body = action === 'approve' ? { expectedVersion: project.early_flow.version, decision: 'APPROVE', note: '初期流动方案已确认' } : { expectedVersion: project.early_flow.version };
      await apiRequest(`/api/v1/new-product-quality/early-flows/${project.early_flow.id}/${action}`, { method: 'PUT', headers: { 'x-csrf-token': token, 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body) });
      await load(project.id);
    } catch (cause) { setEarlyFlowError(cause); }
    finally { setEarlyFlowBusy(false); }
  }

  return <main className="new-product-quality-page">
    <h1 className="sr-only">项目质量台账</h1>
    {project ? <header className="new-product-quality-heading"><Space><Button aria-label="刷新" onClick={() => lookup()} loading={loading}>刷新</Button><Button disabled={writing} onClick={() => requestLeave(() => setEightDOpen(value => !value))}>新品同源8D</Button>{project.status === 'ACTIVE' ? <Button type="primary" disabled={writing} onClick={() => setHandoverOpen(true)}>量产移交</Button> : null}</Space></header> : null}
    <section className="new-product-quality-card">
      <Space.Compact className="new-product-quality-lookup">
        <Input aria-label="新产品项目 ID" placeholder="输入新产品项目 ID" value={input} onChange={(event) => setInput(event.target.value)} onPressEnter={() => lookup(input)} />
        <Button type="primary" onClick={() => lookup(input)} loading={loading}>查看项目</Button>
      </Space.Compact>
    </section>
    {error ? <Alert type={permissionDenied(error) ? 'warning' : 'error'} showIcon title={permissionDenied(error) ? '暂无新产品项目访问权限' : errorMessage(error)} description={error instanceof ApiError && error.traceId ? `追踪标识：${error.traceId}` : undefined} action={!permissionDenied(error) ? <Button onClick={() => lookup()}>重试</Button> : undefined} /> : null}
    <section className="new-product-quality-card" aria-live="polite">
      {loading && !project ? <div className="new-product-quality-loading"><Spin /></div> : error && !project ? null : project ? <>
        <Descriptions column={{ xs: 1, sm: 2 }} title={<Space><span>{project.name}</span><Tag color={project.status === 'ACTIVE' ? 'blue' : 'default'}>{projectStatus[project.status]}</Tag></Space>} items={[
          { key: 'code', label: '项目编号', children: project.code }, { key: 'product', label: '产品代码', children: project.product_code },
          { key: 'stages', label: '阶段数', children: project.stages.length }, { key: 'batches', label: '试制批次数', children: project.batches.length },
          { key: 'lessons', label: '经验教训数', children: project.lessons.length }, { key: 'version', label: '版本', children: project.version },
          ...(project.handover ? [{ key: 'handover', label: '移交记录', children: new Date(project.handover.handed_over_at).toLocaleString('zh-CN') }] : []),
        ]} />
        {eightDOpen && project.organization_id ? <NewProductEightDPanel projectId={project.id} organizationId={project.organization_id} projectContext={project} active={project.status === 'ACTIVE'} onDenied={cause => { projectRequestId.current++; reportRequestId.current++; setProject(undefined); setTrialReport(undefined); setTrialSummary(undefined); discardDrafts(); setError(cause); }} /> : null}
        <Typography.Title level={3}>阶段</Typography.Title>
        <List size="small" dataSource={project.stages} locale={{ emptyText: <Empty description="暂无阶段" /> }} renderItem={(stage) => <List.Item><Space><Typography.Text strong>{stage.code}</Typography.Text><span>{stage.name}</span><Tag>{stage.status}</Tag></Space></List.Item>} />
        <NewProductIssueClosurePanel key={`${project.id}:${draftEpoch}`} projectId={project.id} value={project.issues} active={project.status === 'ACTIVE'} currentUserId={currentUserId} onRefresh={() => load(project.id)} />
        <Space align="center"><Typography.Title level={3} style={{ margin: 0 }}>初期流动</Typography.Title>{project.status === 'ACTIVE' && (!project.early_flow || project.early_flow.status !== 'SUBMITTED') ? <Button type="link" onClick={openEarlyFlowEditor}>{project.early_flow ? '修订方案' : '创建方案'}</Button> : null}{project.early_flow?.status === 'DRAFT' || project.early_flow?.status === 'REJECTED' ? <Button type="link" onClick={() => void transitionEarlyFlow('submit')} loading={earlyFlowBusy}>提交审批</Button> : null}{project.early_flow?.status === 'SUBMITTED' ? <Button type="link" onClick={() => void transitionEarlyFlow('approve')} loading={earlyFlowBusy}>批准方案</Button> : null}</Space>
        {earlyFlowError ? <Alert type="error" showIcon title="初期流动方案操作失败" description={earlyFlowError instanceof ApiError && earlyFlowError.traceId ? `追踪标识：${earlyFlowError.traceId}` : undefined} /> : null}
        {project.early_flow ? <><Descriptions size="small" column={{ xs: 1, sm: 2 }} items={[{ key: 'status', label: '方案状态', children: <Tag color={project.early_flow.status === 'APPROVED' ? 'success' : project.early_flow.status === 'REJECTED' ? 'error' : 'processing'}>{project.early_flow.status}</Tag> }, { key: 'days', label: '监控周期', children: `${project.early_flow.monitoringWindowDays} 天` }, { key: 'frequency', label: '监控频次', children: project.early_flow.monitoringFrequency }, { key: 'plan', label: '方案', children: project.early_flow.plan }, { key: 'exit', label: '退出条件', children: project.early_flow.exitCriteria }, { key: 'note', label: '审批意见', children: project.early_flow.approvalNote ?? '暂无' }, { key: 'release', label: '独立放行', children: project.early_flow.releaseDecision ? `${project.early_flow.releaseDecision.decision === 'APPROVE' ? '批准' : '拒绝'} · 版本 ${project.early_flow.releaseDecision.flowVersion} · ${project.early_flow.releaseDecision.decidedAt}` : '尚未决定' }]} />{project.early_flow.releaseDecision ? <AttachmentPanel resource={{ resourceType: 'new-product-early-flow', resourceId: project.early_flow.id }} fileIds={[project.early_flow.releaseDecision.evidenceObjectId]} readOnly /> : null}{project.early_flow.status === 'APPROVED' && !project.early_flow.releaseDecision && project.early_flow.submittedById !== currentUserId && currentUserId ? <Space direction="vertical" style={{ width: '100%' }}><AttachmentPanel resource={{ resourceType: 'new-product-early-flow', resourceId: project.early_flow.id }} fileIds={releaseEvidenceId ? [releaseEvidenceId] : []} readOnly={writing} onReady={(file) => setReleaseEvidenceId(file.id)} onRemoved={(id) => setReleaseEvidenceId((current) => current === id ? '' : current)} /><Input.TextArea aria-label="初期流动放行意见" value={releaseNote} disabled={writing} onChange={(event) => setReleaseNote(event.target.value)} maxLength={2000} rows={2} /><Space><Button onClick={() => void decideEarlyFlowRelease('APPROVE')} disabled={!releaseEvidenceId} loading={earlyFlowBusy}>批准退出初期流动</Button><Button danger onClick={() => void decideEarlyFlowRelease('REJECT')} disabled={!releaseEvidenceId || !releaseNote.trim()} loading={earlyFlowBusy}>拒绝退出初期流动</Button></Space></Space> : null}{project.early_flow.status === 'APPROVED' && !project.early_flow.releaseDecision && project.early_flow.submittedById === currentUserId ? <Typography.Text type="secondary">放行须由其他审批人决定</Typography.Text> : null}</> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未建立初期流动方案" />}
        <Typography.Title level={3}>试产批次</Typography.Title>
        <List size="small" dataSource={project.batches} locale={{ emptyText: <Empty description="暂无试产批次" /> }} renderItem={(batch) => <List.Item actions={[<Button key="report" type="link" onClick={() => openReport(batch.id)} loading={trialReportLoading && trialReportBatchId === batch.id}>查看试产报告 {batch.code}</Button>]}><Space><Typography.Text strong>{batch.code}</Typography.Text><Typography.Text type="secondary">{batch.work_order_code ?? '未关联工单'}</Typography.Text></Space></List.Item>} />
        {trialReportError ? <Alert type="error" showIcon title="试产报告加载失败" description={trialReportError instanceof ApiError && trialReportError.traceId ? `追踪标识：${trialReportError.traceId}` : undefined} /> : null}
        {trialReport && trialSummary?.status === 'APPROVED' && !summaryError ? <Space><Button loading={summaryDownloadBusy} onClick={() => void downloadSummary('xlsx')}>下载 Excel</Button><Button loading={summaryDownloadBusy} onClick={() => void downloadSummary('pdf')}>下载 PDF</Button></Space> : null}
        {trialReport ? <section className="new-product-quality-report" aria-live="polite"><Typography.Title level={4}>试产报告 · {trialReport.code}</Typography.Title><List size="small" dataSource={trialReport.metrics} locale={{ emptyText: <Empty description="暂无试产指标" /> }} renderItem={(metric) => <List.Item><Space wrap><Typography.Text strong>{metric.code}</Typography.Text><span>目标 {metric.target}</span><span>实际 {metric.actual}</span><Tag color={metric.signal === 'GREEN' ? 'success' : 'error'}>{metric.signal === 'GREEN' ? '达标' : '未达标'}</Tag></Space></List.Item>} /><Typography.Title level={5}>试产总结</Typography.Title>{summaryError ? <Alert type={permissionDenied(summaryError) ? 'warning' : 'error'} showIcon title={permissionDenied(summaryError) ? '暂无试产总结访问权限' : '试产总结加载或操作失败'} action={!permissionDenied(summaryError) ? <Button onClick={() => openReport(trialReport.id)}>重试</Button> : undefined} /> : null}{!summaryLoaded ? <Spin aria-label="试产总结加载中" /> : summaryError ? null : !trialSummary ? <Space direction="vertical" style={{ width: '100%' }}><Input.TextArea aria-label="试产结论" value={summaryConclusion} disabled={writing} onChange={(event) => { setSummaryConclusion(event.target.value); setSummaryDirty(true); }} maxLength={10000} rows={3} placeholder="记录试产结论和遗留风险" /><Button type="primary" onClick={() => void createSummary(trialReport.id)} disabled={!summaryConclusion.trim()} loading={summaryBusy}>创建总结</Button></Space> : <Space direction="vertical"><Descriptions size="small" column={1} items={[{ key: 'status', label: '状态', children: trialSummary.status }, { key: 'conclusion', label: '结论', children: trialSummary.conclusion }, { key: 'source', label: '来源摘要', children: trialSummary.sourceSha256 ?? '尚未冻结' }, { key: 'issues', label: '问题数', children: trialSummary.issueSnapshot.length }, { key: 'note', label: '审批意见', children: trialSummary.approvalNote ?? '暂无' }]} />{trialSummary.status === 'DRAFT' ? <Button onClick={() => void submitSummary(trialReport.id)} loading={summaryBusy}>提交审批</Button> : null}{trialSummary.status === 'SUBMITTED' && (sessionError || !currentUserId || trialSummary.submittedById === currentUserId) ? <Typography.Text type="secondary">试产总结需由其他审批人处理</Typography.Text> : null}{trialSummary.status === 'SUBMITTED' && currentUserId && trialSummary.submittedById && trialSummary.submittedById !== currentUserId ? <Space direction="vertical"><Input.TextArea aria-label="试产总结审批意见" value={summaryDecisionNote} disabled={writing} onChange={(event) => setSummaryDecisionNote(event.target.value)} maxLength={2000} rows={2} /><Space><Button onClick={() => void decideSummary(trialReport.id, 'APPROVE')} loading={summaryBusy}>批准总结</Button><Button danger onClick={() => void decideSummary(trialReport.id, 'REJECT')} disabled={!summaryDecisionNote.trim()} loading={summaryBusy}>驳回总结</Button></Space></Space> : null}{['REJECTED', 'APPROVED'].includes(trialSummary.status) && project.status === 'ACTIVE' ? <Space direction="vertical"><Input.TextArea aria-label="修订试产结论" value={summaryConclusion} disabled={writing} onChange={(event) => { setSummaryConclusion(event.target.value); setSummaryDirty(true); }} maxLength={10000} rows={3} /><Button onClick={() => void reviseSummary(trialReport.id)} disabled={!summaryConclusion.trim()} loading={summaryBusy}>修订总结</Button></Space> : null}</Space>}</section> : null}
      </> : <Empty description={projectId ? '未找到新产品项目' : '输入新产品项目 ID 后查看详情'} />}
    </section>
    <Modal open={earlyFlowOpen} title={earlyFlowEditing ? '修订初期流动方案' : '创建初期流动方案'} onCancel={closeEarlyFlow} closable={!writing} keyboard={!writing} mask={{ closable: !writing }} onOk={() => void createEarlyFlow()} okText="保存方案" okButtonProps={{ disabled: !earlyFlowPlan.trim() || !earlyFlowFrequency.trim() || !earlyFlowExitCriteria.trim(), loading: earlyFlowBusy }} cancelButtonProps={{ disabled: earlyFlowBusy }} footer={(_, { CancelBtn, OkBtn }) => <div className="qms-dialog-actions" role="group" aria-label={earlyFlowEditing ? '修订初期流动方案' : '创建初期流动方案'}><CancelBtn /><OkBtn /></div>}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Typography.Text>监控周期（天）</Typography.Text>
        <InputNumber aria-label="监控周期" min={1} max={365} value={earlyFlowDays} onChange={(value) => { setEarlyFlowDays(value ?? 30); setEarlyFlowDirty(true); }} disabled={earlyFlowBusy} />
        <Typography.Text>监控频次</Typography.Text>
        <Input aria-label="监控频次" value={earlyFlowFrequency} onChange={(event) => { setEarlyFlowFrequency(event.target.value); setEarlyFlowDirty(true); }} maxLength={200} disabled={earlyFlowBusy} />
        <Typography.Text>监控方案</Typography.Text>
        <Input.TextArea aria-label="监控方案" value={earlyFlowPlan} onChange={(event) => { setEarlyFlowPlan(event.target.value); setEarlyFlowDirty(true); }} maxLength={10000} rows={4} disabled={earlyFlowBusy} />
        <Typography.Text>退出条件</Typography.Text>
        <Input.TextArea aria-label="退出条件" value={earlyFlowExitCriteria} onChange={(event) => { setEarlyFlowExitCriteria(event.target.value); setEarlyFlowDirty(true); }} maxLength={10000} rows={3} disabled={earlyFlowBusy} />
      </Space>
    </Modal>
    <Modal open={handoverOpen} title="量产移交确认" onCancel={closeHandover} closable={!writing} keyboard={!writing} mask={{ closable: !writing }} onOk={() => void handover()} okText="确认移交" okButtonProps={{ disabled: !riskStatement.trim(), loading: handoverBusy }} cancelButtonProps={{ disabled: handoverBusy }} footer={(_, { CancelBtn, OkBtn }) => <div className="qms-dialog-actions" role="group" aria-label="量产移交确认"><CancelBtn /><OkBtn /></div>}>
      <Typography.Paragraph>系统将检查阶段评审、交付物、经验教训、试产指标和未关闭问题。移交成功后项目归档。</Typography.Paragraph>
      {handoverError ? <Alert type={permissionDenied(handoverError) ? 'warning' : 'error'} showIcon title={handoverError instanceof ApiError ? safeAccountError(handoverError) : '量产移交失败，请重试。'} description={handoverError instanceof ApiError && handoverError.status === 409 ? '请核对项目资料和风险签署，刷新后重试。' : undefined} /> : null}
      <Typography.Text>遗留风险说明</Typography.Text>
      <Input.TextArea aria-label="遗留风险说明" value={riskStatement} onChange={(event) => setRiskStatement(event.target.value)} maxLength={10000} rows={4} disabled={handoverBusy} />
    </Modal>
  </main>;
}
