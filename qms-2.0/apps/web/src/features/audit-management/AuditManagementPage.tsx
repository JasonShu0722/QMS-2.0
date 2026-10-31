import { Alert, Button, Descriptions, Drawer, Empty, Form, Input, List, Select, Space, Spin, Tag, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiRequest, csrfToken, safeAccountError } from '../../api/client';
import type { components } from '@qms/contracts';
import { AuditExcelImport } from './AuditExcelImport';
import { AuditMobileExecution } from './AuditMobileExecution';
import { AuditNcClosurePanel } from './AuditNcClosurePanel';
import './audit-management.css';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';

type AuditPlan = components['schemas']['AuditPlanResponseDto'];
type AuditImportPage = components['schemas']['AuditImportRowPageDto'];
type AuditImportRow = components['schemas']['AuditImportRowResponseDto'];
type IssueBody = components['schemas']['IssueAuditImportRowDto'];
type IssueResult = components['schemas']['AuditImportIssueResultDto'];
type Permissions = components['schemas']['PermissionsResponseDto'];
type IssueFields = Pick<IssueBody, 'problemType' | 'responseForm' | 'responsibleScope' | 'severity'> & IssueBody['workflowBinding'];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorMessage(cause: unknown) {
  if (cause instanceof ApiError) return safeAccountError(cause);
  return '审计计划加载失败，请重试。';
}

function permissionDenied(cause: unknown) {
  if (cause instanceof ApiError) return cause.status === 401 || cause.status === 403 || cause.code === 'FEATURE_PERMISSION_DENIED' || cause.code === 'ORGANIZATION_SCOPE_DENIED';
  return typeof cause === 'object' && cause !== null && ([401, 403].includes((cause as { status?: number }).status ?? 0) || ['FEATURE_PERMISSION_DENIED', 'ORGANIZATION_SCOPE_DENIED'].includes((cause as { code?: string }).code ?? ''));
}

const statusLabels: Record<AuditPlan['status'], string> = {
  PLANNED: '已计划', APPROVED: '已批准', IN_PROGRESS: '进行中', COMPLETED: '已完成', CANCELLED: '已取消',
};

const typeLabels: Record<AuditPlan['audit_type'], string> = {
  SYSTEM: '体系审核', PROCESS: '过程审核', PRODUCT: '产品审核', SECOND_PARTY: '第二方审核', CUSTOMER: '客户审核',
};

const importStatusLabels: Record<AuditImportRow['status'], string> = {
  PENDING_REVIEW: '待复核', ACCEPTED: '已接受', REJECTED: '已拒绝', ISSUED: '已发单',
};

const sourceLabels: Record<AuditImportRow['source_system'], string> = {
  CUSTOMER: '客户', SECOND_PARTY: '第二方',
};

function importStatusColor(status: AuditImportRow['status']) {
  return status === 'ACCEPTED' || status === 'ISSUED' ? 'green' : status === 'REJECTED' ? 'red' : 'orange';
}

function optionalText(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

export function AuditManagementPage({ planId: initialPlanId }: { planId?: string } = {}) {
  const [issueForm] = Form.useForm<IssueFields>();
  const [input, setInput] = useState(initialPlanId ?? '');
  const [planId, setPlanId] = useState(initialPlanId ?? '');
  const [plan, setPlan] = useState<AuditPlan>();
  const [loading, setLoading] = useState(Boolean(initialPlanId));
  const [error, setError] = useState<unknown>();
  const [imports, setImports] = useState<AuditImportPage>();
  const [importLoading, setImportLoading] = useState(true);
  const [importError, setImportError] = useState<unknown>();
  const [importStatus, setImportStatus] = useState<AuditImportRow['status']>();
  const [importSource, setImportSource] = useState<AuditImportRow['source_system']>();
  const [importRevision, setImportRevision] = useState(0);
  const [importBusyId, setImportBusyId] = useState<string>();
  const [issueRow, setIssueRow] = useState<AuditImportRow>();
  const [issueBusy, setIssueBusy] = useState(false);
  const [issueError, setIssueError] = useState<unknown>();
  const [issueConflict, setIssueConflict] = useState(false);
  const [issueDenied, setIssueDenied] = useState(false);
  const [issued, setIssued] = useState<IssueResult>();
  const [issueSucceeded, setIssueSucceeded] = useState(false);
  const [showNcClosure, setShowNcClosure] = useState(false);
  const [permissions, setPermissions] = useState<Permissions>();
  const [permissionError, setPermissionError] = useState<unknown>();
  const mutation = useRef<{ signature: string; key: string } | undefined>(undefined);
  const issueMutation = useRef<{ signature: string; key: string } | undefined>(undefined);
  const issueRowRef = useRef<AuditImportRow | undefined>(undefined);
  const importRequestId = useRef(0);
  const importController = useRef<AbortController | undefined>(undefined);
  const issueRequestId = useRef(0);
  const [issueDirty, setIssueDirty] = useState(false);
  const requestLeave = useNavigationGuard();
  useUnsavedChanges(issueDirty);
  useNavigationBusy(issueBusy || Boolean(importBusyId));
  function discardIssue() { setIssueDirty(false); setIssueRow(undefined); issueRowRef.current = undefined; issueForm.resetFields(); issueMutation.current = undefined; }
  function refreshImports() { setImportRevision((value) => value + 1); }

  function canIssueWith(row: AuditImportRow, granted?: Permissions) {
    return row.status === 'ACCEPTED' && granted?.organizationId === row.organization_id
      && granted.permissions.includes('audit-management:write') && granted.permissions.includes('workflow:start');
  }

  function canIssue(row: AuditImportRow) {
    return canIssueWith(row, permissions);
  }

  function canReview(row: AuditImportRow) {
    return row.status === 'PENDING_REVIEW' && permissions?.organizationId === row.organization_id
      && permissions.permissions.includes('audit-management:write');
  }

  function clearImportAccess(cause: unknown, fromIssue = false) {
    importRequestId.current += 1;
    importController.current?.abort();
    issueRequestId.current += 1;
    setImports(undefined);
    setPermissions(undefined);
    setPermissionError(undefined);
    setIssueRow(undefined);
    setIssueDirty(false);
    issueRowRef.current = undefined;
    issueForm.resetFields();
    setIssueError(undefined);
    setIssueConflict(false);
    setIssued(undefined);
    setIssueSucceeded(false);
    issueMutation.current = undefined;
    mutation.current = undefined;
    setIssueBusy(false);
    setImportBusyId(undefined);
    setImportLoading(false);
    setImportError(cause);
    setIssueDenied(fromIssue);
  }

  function closeIssueNow() {
    if (issueBusy) return;
    const refresh = issueConflict;
    setIssueRow(undefined);
    setIssueDirty(false);
    issueRowRef.current = undefined;
    setIssueError(undefined);
    setIssueConflict(false);
    issueForm.resetFields();
    issueMutation.current = undefined;
    if (refresh) setImportRevision((value) => value + 1);
  }
  function closeIssue() { if (!issueBusy) requestLeave(closeIssueNow, true); }

  async function load(id = planId) {
    const value = id.trim();
    if (!value) return;
    setPlanId(value);
    setLoading(true);
    setError(undefined);
    try { setPlan(await apiRequest<AuditPlan>(`/api/v1/audit-management/plans/${value}`)); }
    catch (cause) { setPlan(undefined); setError(cause); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (initialPlanId) void load(initialPlanId); }, [initialPlanId]);

  useEffect(() => {
    const controller = new AbortController();
    const requestId = ++importRequestId.current;
    importController.current = controller;
    const current = () => !controller.signal.aborted && requestId === importRequestId.current;
    const params = new URLSearchParams({ page: '1', pageSize: '20' });
    if (importStatus) params.set('status', importStatus);
    if (importSource) params.set('sourceSystem', importSource);
    setImportLoading(true);
    setImportError(undefined);
    setIssueDenied(false);
    setPermissionError(undefined);
    apiRequest<AuditImportPage>(`/api/v1/audit-management/imports?${params}`, { signal: controller.signal })
      .then((page) => {
        if (!current()) return;
        setImports(page);
        void apiRequest<Permissions>('/api/v1/system/my-permissions', { signal: controller.signal })
          .then((value) => { if (current()) {
            setPermissions(value);
            setPermissionError(undefined);
            if (issueRowRef.current && !canIssueWith(issueRowRef.current, value)) {
              issueRequestId.current += 1;
              issueRowRef.current = undefined;
              setIssueRow(undefined);
              setIssueDirty(false);
              issueForm.resetFields();
              issueMutation.current = undefined;
              setIssueError(undefined);
            }
          } })
          .catch((cause) => { if (current()) {
            if (permissionDenied(cause)) { clearImportAccess(cause); return; }
            setPermissionError(cause);
            issueRequestId.current += 1;
            issueRowRef.current = undefined;
            setIssueRow(undefined);
            setIssueDirty(false);
            issueForm.resetFields();
            issueMutation.current = undefined;
            setIssueError(undefined);
          } });
      })
      .catch((cause) => { if (current()) { if (permissionDenied(cause)) clearImportAccess(cause); else setImportError(cause); } })
      .finally(() => { if (current()) setImportLoading(false); });
    return () => controller.abort();
  }, [importRevision, importSource, importStatus]);

  async function reviewImport(row: AuditImportRow, decision: 'ACCEPTED' | 'REJECTED') {
    if (!canReview(row) || importBusyId || issueBusy) return;
    const path = `/api/v1/audit-management/imports/${row.id}/review`;
    const body = { expectedVersion: row.version, decision };
    const signature = JSON.stringify([path, body]);
    if (mutation.current?.signature !== signature) mutation.current = { signature, key: crypto.randomUUID() };
    setImportBusyId(row.id);
    setImportError(undefined);
    try {
      await apiRequest<AuditImportRow>(path, {
        method: 'PUT',
        headers: { 'x-csrf-token': await csrfToken(), 'Idempotency-Key': mutation.current.key },
        body: JSON.stringify(body),
      });
      mutation.current = undefined;
      setImportRevision((value) => value + 1);
    } catch (cause) {
      if (permissionDenied(cause)) clearImportAccess(cause);
      else setImportError(cause);
    } finally {
      setImportBusyId(undefined);
    }
  }

  function openIssue(row: AuditImportRow) {
    if (!canIssue(row)) return;
    requestLeave(() => {
      setIssueDirty(false);
      issueForm.resetFields();
      issueRowRef.current = row;
      setIssueRow(row);
      setIssueError(undefined);
      setIssueConflict(false);
      setIssueSucceeded(false);
      setIssued(undefined);
      issueMutation.current = undefined;
    });
  }

  async function issueImport(values: IssueFields) {
    if (!issueRow || issueBusy || issueConflict || !canIssue(issueRow)) return;
    const requestId = ++issueRequestId.current;
    const path = `/api/v1/audit-management/imports/${issueRow.id}/issue`;
    const body: IssueBody = {
      expectedVersion: issueRow.version,
      problemType: values.problemType.trim(), responseForm: values.responseForm,
      responsibleScope: values.responsibleScope.trim(), severity: values.severity.trim(),
      workflowBinding: {
        workflowDefinitionId: values.workflowDefinitionId.trim(),
        workflowVersionId: values.workflowVersionId.trim(),
        instanceKey: values.instanceKey.trim(),
      },
    };
    const signature = JSON.stringify([path, body]);
    if (issueMutation.current?.signature !== signature) issueMutation.current = { signature, key: crypto.randomUUID() };
    setIssueBusy(true);
    setIssueError(undefined);
    try {
      const response = await apiRequest<IssueResult>(path, {
        method: 'POST', headers: { 'x-csrf-token': await csrfToken(), 'Idempotency-Key': issueMutation.current.key }, body: JSON.stringify(body),
      });
      if (requestId !== issueRequestId.current) return;
      setIssued(response);
      setIssueSucceeded(true);
      issueMutation.current = undefined;
      issueRowRef.current = undefined;
      setIssueRow(undefined);
      setIssueDirty(false);
      issueForm.resetFields();
      setImportRevision((value) => value + 1);
    } catch (cause) {
      if (requestId !== issueRequestId.current) return;
      if (permissionDenied(cause)) clearImportAccess(cause, true);
      else if (cause instanceof ApiError && cause.status === 409) {
        importRequestId.current += 1;
        importController.current?.abort();
        setImports(undefined);
        setIssueConflict(true);
        setIssueError(cause);
      } else setIssueError(cause);
    } finally { if (requestId === issueRequestId.current) setIssueBusy(false); }
  }

  return <main className="audit-management-page">
    <h1 className="sr-only">审核计划</h1>
    {plan ? <header className="audit-management-heading"><Button onClick={() => void load()} loading={loading}>刷新</Button></header> : null}
    <section className="audit-management-card">
      <Space.Compact className="audit-management-lookup">
        <Input aria-label="审核计划 ID" placeholder="输入审核计划 ID" value={input} onChange={(event) => setInput(event.target.value)} onPressEnter={() => void load(input)} />
        <Button type="primary" onClick={() => void load(input)} loading={loading}>查看计划</Button>
      </Space.Compact>
    </section>
    {error ? <Alert type={permissionDenied(error) ? 'warning' : 'error'} showIcon title={permissionDenied(error) ? '暂无审核计划访问权限' : errorMessage(error)} description={error instanceof ApiError && error.traceId ? `追踪标识：${error.traceId}` : undefined} action={!permissionDenied(error) ? <Button onClick={() => void load()}>重试</Button> : undefined} /> : null}
    <section className="audit-management-card" aria-live="polite">
      {loading ? <div className="audit-management-loading"><Spin /></div> : error ? null : plan ? <Descriptions column={{ xs: 1, sm: 2 }} title={<Space><span>{plan.title}</span><Tag color={plan.status === 'COMPLETED' ? 'green' : plan.status === 'CANCELLED' ? 'red' : 'blue'}>{statusLabels[plan.status]}</Tag></Space>} items={[
        { key: 'year', label: '年度', children: plan.year }, { key: 'type', label: '审核类型', children: typeLabels[plan.audit_type] },
        { key: 'start', label: '计划开始', children: new Date(plan.planned_start).toLocaleString() }, { key: 'end', label: '计划结束', children: new Date(plan.planned_end).toLocaleString() },
        { key: 'version', label: '版本', children: plan.version }, { key: 'organization', label: '组织', children: plan.organization_id },
      ]} /> : <Empty description={planId ? '未找到审核计划' : '输入审核计划 ID 后查看详情'} />}
    </section>
    <AuditMobileExecution />
    <Button onClick={() => requestLeave(() => setShowNcClosure((value) => !value))}>{showNcClosure ? '收起整改记录' : '查看审核整改'}</Button>
    {showNcClosure ? <AuditNcClosurePanel /> : null}
    <section className="audit-management-card audit-import-card" aria-label="审核导入行">
      <div className="audit-import-heading">
        <div><Typography.Title level={3}>外部审核导入</Typography.Title></div>
        <Button onClick={refreshImports} loading={importLoading}>刷新导入</Button>
      </div>
      <Space wrap className="audit-import-filters">
        <Select aria-label="导入来源" allowClear placeholder="全部来源" value={importSource} onChange={(value) => requestLeave(() => { discardIssue(); setImportSource(value); })} options={Object.entries(sourceLabels).map(([value, label]) => ({ value, label }))} />
        <Select aria-label="导入状态" allowClear placeholder="全部状态" value={importStatus} onChange={(value) => requestLeave(() => { discardIssue(); setImportStatus(value); })} options={Object.entries(importStatusLabels).map(([value, label]) => ({ value, label }))} />
      </Space>
      {permissionError && !importError ? <Alert type="warning" showIcon title="无法验证发单权限" action={<Button onClick={refreshImports}>重试</Button>} /> : null}
      {permissions?.organizationId && permissions.permissions.includes('audit-management:write') ? <AuditExcelImport key={permissions.organizationId} organizationId={permissions.organizationId} onImported={() => setImportRevision((value) => value + 1)} onDenied={(cause) => clearImportAccess(cause)} /> : null}
      {issueSucceeded ? <Alert type="success" showIcon title={issued ? `问题 ${issued.problem.reportNumber} 已发起` : '审核导入行已发单'} action={issued ? <Link to={`/app/problem-workspace/${issued.problem.id}?organizationId=${encodeURIComponent(issued.source.organizationId)}`}>查看问题 {issued.problem.reportNumber}</Link> : undefined} /> : null}
      {importError ? <Alert type={permissionDenied(importError) ? 'warning' : 'error'} showIcon title={permissionDenied(importError) ? issueDenied ? '暂无发单权限' : '暂无导入行访问或复核权限' : '导入行加载或复核失败'} description={safeAccountError(importError)} action={!permissionDenied(importError) ? <Button onClick={refreshImports}>重试</Button> : undefined} /> : null}
      {importLoading ? <div className="audit-management-loading"><Spin /></div> : !importError ? <List dataSource={imports?.items ?? []} locale={{ emptyText: <Empty description="暂无导入行" /> }} renderItem={(row) => <List.Item key={row.id} actions={canReview(row) ? [<Button key="accept" size="small" type="primary" loading={importBusyId === row.id} onClick={() => void reviewImport(row, 'ACCEPTED')}>接受</Button>, <Button key="reject" size="small" danger loading={importBusyId === row.id} onClick={() => void reviewImport(row, 'REJECTED')}>拒绝</Button>] : canIssue(row) ? [<Button key="issue" size="small" type="primary" onClick={() => openIssue(row)}>发起正式问题</Button>] : undefined}>
        <List.Item.Meta title={<Space wrap><Typography.Text strong>{row.external_key}</Typography.Text><Tag>{sourceLabels[row.source_system]}</Tag><Tag color={importStatusColor(row.status)}>{importStatusLabels[row.status]}</Tag></Space>} description={<Space orientation="vertical" size={0}><Typography.Text type="secondary">版本 v{row.version} · {new Date(row.created_at).toLocaleString('zh-CN')}</Typography.Text>{optionalText(row.review_note) ? <Typography.Text type="secondary">复核备注：{optionalText(row.review_note)}</Typography.Text> : null}{optionalText(row.problem_index_id) ? <Link to={`/app/problem-workspace/${optionalText(row.problem_index_id)}?organizationId=${encodeURIComponent(row.organization_id)}`}>已关联问题：{optionalText(row.problem_index_id)}</Link> : null}</Space>} />
      </List.Item>} /> : null}
    </section>
    <Drawer title="审核导入行发单" open={Boolean(issueRow)} onClose={closeIssue} closable={!issueBusy} keyboard={!issueBusy} mask={{ closable: !issueBusy }} width="min(620px, 100vw)" destroyOnHidden={false}>
      {issueRow ? <>
        <Typography.Paragraph>来源：{sourceLabels[issueRow.source_system]} · {issueRow.external_key} · 版本 v{issueRow.version}</Typography.Paragraph>
        {issueError ? <Alert className="audit-import-issue-error" type={permissionDenied(issueError) ? 'warning' : 'error'} showIcon title={permissionDenied(issueError) ? '暂无发单权限' : issueError instanceof ApiError && issueError.status === 409 ? '来源版本已变化；请关闭并刷新导入行后重新选择。' : issueError instanceof ApiError ? safeAccountError(issueError) : '发单失败，请重试。'} description={issueError instanceof ApiError && issueError.traceId ? `追踪标识：${issueError.traceId}` : undefined} action={issueConflict ? <Button onClick={closeIssue}>关闭并刷新导入行</Button> : undefined} /> : null}
        <Form<IssueFields> form={issueForm} layout="vertical" disabled={issueBusy} onValuesChange={() => setIssueDirty(true)} initialValues={{ responseForm: 'BRIEF' }} onFinish={(values) => void issueImport(values)}>
          <Form.Item name="problemType" label="问题类型" rules={[{ required: true, whitespace: true, message: '请输入问题类型' }, { max: 100, message: '最多 100 个字符' }]}><Input maxLength={100} /></Form.Item>
          <Form.Item name="responseForm" label="响应形式" rules={[{ required: true, message: '请选择响应形式' }]}><Select options={[{ value: 'BRIEF', label: '问题简报' }, { value: 'EIGHT_D', label: '8D' }]} /></Form.Item>
          <Form.Item name="responsibleScope" label="责任范围" rules={[{ required: true, whitespace: true, message: '请输入责任范围' }, { max: 100, message: '最多 100 个字符' }]}><Input maxLength={100} /></Form.Item>
          <Form.Item name="severity" label="严重度" rules={[{ required: true, whitespace: true, message: '请输入严重度' }, { max: 32, message: '最多 32 个字符' }]}><Input maxLength={32} /></Form.Item>
          <Form.Item name="workflowDefinitionId" label="流程定义 ID" rules={[{ required: true, message: '请输入流程定义 ID' }, { pattern: uuidPattern, message: '请输入有效的 UUID' }]}><Input /></Form.Item>
          <Form.Item name="workflowVersionId" label="流程版本 ID" rules={[{ required: true, message: '请输入流程版本 ID' }, { pattern: uuidPattern, message: '请输入有效的 UUID' }]}><Input /></Form.Item>
          <Form.Item name="instanceKey" label="实例标识" rules={[{ required: true, whitespace: true, message: '请输入实例标识' }, { max: 200, message: '最多 200 个字符' }]}><Input maxLength={200} /></Form.Item>
          <div className="qms-dialog-actions" role="group" aria-label="审核导入行发单"><Button type="primary" htmlType="submit" loading={issueBusy} disabled={issueConflict || !canIssue(issueRow)}>确认发单</Button></div>
        </Form>
      </> : null}
    </Drawer>
  </main>;
}
