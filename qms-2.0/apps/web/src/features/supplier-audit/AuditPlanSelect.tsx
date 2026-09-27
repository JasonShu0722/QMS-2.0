import type { components } from '@qms/contracts';
import { Alert, Button, InputNumber, Select, Space, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { ApiError, apiRequest, safeAccountError } from '../../api/client';

type Plan = components['schemas']['SupplierAuditPlanDto'];
type PlanPage = components['schemas']['SupplierAuditPlanPageDto'];
const PAGE_SIZE = 20;
const MAX_PAGES = 10;

export function AuditPlanSelect({ value, onChange }: { value?: string; onChange?: (value?: string) => void }) {
  const [year, setYear] = useState<number>();
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Plan[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(undefined);
    void apiRequest<PlanPage>(`/api/v1/supplier-audit/plans?page=${page}&pageSize=${PAGE_SIZE}${year ? `&year=${year}` : ''}`)
      .then((result) => {
        if (!active) return;
        setItems((current) => page === 1 ? result.items : [...new Map([...current, ...result.items].map((plan) => [plan.id, plan])).values()]);
        setTotal(result.total);
      })
      .catch((cause) => { if (active) setError(cause instanceof ApiError ? safeAccountError(cause) : '计划加载失败，请重试'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [year, page, revision]);

  const eligible = items.filter((plan) => plan.status === 'SUBMITTED' || plan.status === 'CLOSED');
  return <div className="supplier-audit-plan-select">
    <Space wrap><InputNumber aria-label="按年度筛选计划" placeholder="按年度筛选" min={2000} max={2200} value={year} onChange={(next) => { setYear(next ?? undefined); setPage(1); setItems([]); setTotal(0); onChange?.(undefined); }} /><Typography.Text type="secondary">已加载 {items.length} / {total} 项计划</Typography.Text></Space>
    <Select aria-label="已提交计划" value={value} onChange={onChange} showSearch optionFilterProp="label" placeholder="选择已提交或已关闭的计划" loading={loading} options={eligible.map((plan) => ({ value: plan.id, label: `${plan.title} · ${plan.auditYear}` }))} notFoundContent={loading ? '加载中…' : '当前范围暂无可选计划'} popupRender={(menu) => <>{menu}{page * PAGE_SIZE < total && page < MAX_PAGES ? <Button block type="text" loading={loading} disabled={!!error} onMouseDown={(event) => event.preventDefault()} onClick={() => setPage((current) => current + 1)}>加载更多计划</Button> : null}</>} />
    {page >= MAX_PAGES && total > MAX_PAGES * PAGE_SIZE ? <Alert type="info" showIcon title="计划超过本次可浏览的 200 条，请按年度缩小范围" /> : null}
    {error ? <Alert type="error" showIcon title={error} action={<Button size="small" onClick={() => setRevision((current) => current + 1)}>重试计划</Button>} /> : null}
  </div>;
}
