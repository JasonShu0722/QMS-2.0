import { Alert, Button, Descriptions, Empty, Input, Space, Spin, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { ApiError, apiRequest, safeAccountError } from '../../api/client';
import type { components } from '@qms/contracts';
import './audit-management.css';

type AuditPlan = components['schemas']['AuditPlanResponseDto'];

function errorMessage(cause: unknown) {
  if (cause instanceof ApiError) return safeAccountError(cause);
  return '审计计划加载失败，请重试。';
}

function permissionDenied(cause: unknown) {
  if (cause instanceof ApiError) return cause.status === 403 || cause.code === 'FEATURE_PERMISSION_DENIED' || cause.code === 'ORGANIZATION_SCOPE_DENIED';
  return typeof cause === 'object' && cause !== null && ((cause as { status?: number }).status === 403 || ['FEATURE_PERMISSION_DENIED', 'ORGANIZATION_SCOPE_DENIED'].includes((cause as { code?: string }).code ?? ''));
}

const statusLabels: Record<AuditPlan['status'], string> = {
  PLANNED: '已计划', APPROVED: '已批准', IN_PROGRESS: '进行中', COMPLETED: '已完成', CANCELLED: '已取消',
};

const typeLabels: Record<AuditPlan['audit_type'], string> = {
  SYSTEM: '体系审核', PROCESS: '过程审核', PRODUCT: '产品审核', SECOND_PARTY: '第二方审核', CUSTOMER: '客户审核',
};

export function AuditManagementPage({ planId: initialPlanId }: { planId?: string } = {}) {
  const [input, setInput] = useState(initialPlanId ?? '');
  const [planId, setPlanId] = useState(initialPlanId ?? '');
  const [plan, setPlan] = useState<AuditPlan>();
  const [loading, setLoading] = useState(Boolean(initialPlanId));
  const [error, setError] = useState<unknown>();

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

  return <main className="audit-management-page">
    <header className="audit-management-heading">
      <div><Typography.Text type="secondary">审核管理</Typography.Text><Typography.Title level={1}>审核计划</Typography.Title><Typography.Paragraph type="secondary">按计划 ID 查看受权限保护的审核计划状态和时间范围。</Typography.Paragraph></div>
      {plan ? <Button onClick={() => void load()} loading={loading}>刷新</Button> : null}
    </header>
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
  </main>;
}
