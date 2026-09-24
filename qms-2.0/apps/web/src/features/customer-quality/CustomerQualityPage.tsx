import { Alert, Button, Descriptions, Empty, Input, Space, Spin, Table, Tag, Typography } from 'antd';
import type { components } from '@qms/contracts';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, apiRequest, safeAccountError } from '../../api/client';
import './customer-quality.css';

type Complaint = components['schemas']['CustomerComplaintDto'];
type ComplaintDetail = components['schemas']['CustomerComplaintDetailDto'];

const typeLabels: Record<Complaint['complaint_type'], string> = { ZERO_KM: '0KM', AFTER_SALES: '售后' };

export function CustomerQualityPage() {
  const [items, setItems] = useState<Complaint[]>([]);
  const [selected, setSelected] = useState<ComplaintDetail>();
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<unknown>();
  const [detailError, setDetailError] = useState<unknown>();

  async function load() {
    setLoading(true); setError(undefined);
    try { setItems(await apiRequest<Complaint[]>('/api/v1/customer-quality/complaints')); }
    catch (cause) { setItems([]); setError(cause); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function openDetail(id: string) {
    setDetailLoading(true); setDetailError(undefined);
    try { setSelected(await apiRequest<ComplaintDetail>(`/api/v1/customer-quality/complaints/${id}`)); }
    catch (cause) { setSelected(undefined); setDetailError(cause); }
    finally { setDetailLoading(false); }
  }

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? items.filter((item) => [item.complaint_number, item.product_code, item.vin, item.defect_description].some((value) => value?.toLowerCase().includes(query))) : items;
  }, [items, search]);

  return <main className="customer-quality-page">
    <header className="customer-quality-heading"><div><Typography.Text type="secondary">客户质量</Typography.Text><Typography.Title level={1}>客诉台账</Typography.Title><Typography.Paragraph type="secondary">记录客户来源、实物处置和解析状态，再进入正式问题分流。</Typography.Paragraph></div><Button onClick={() => void load()} loading={loading}>刷新</Button></header>
    {error ? <Alert type={error instanceof ApiError && error.status === 403 ? 'warning' : 'error'} showIcon title={error instanceof ApiError && error.status === 403 ? '暂无客诉台账访问权限' : error instanceof ApiError ? safeAccountError(error) : '客诉台账加载失败，请重试。'} description={error instanceof ApiError ? error.traceId : undefined} action={error instanceof ApiError && error.status === 403 ? undefined : <Button onClick={() => void load()}>重试</Button>} /> : null}
    <section className="customer-quality-card"><Space className="customer-quality-toolbar" wrap><Input.Search aria-label="搜索客诉" placeholder="搜索编号、产品、VIN 或描述" allowClear onSearch={setSearch} onChange={(event) => setSearch(event.target.value)} /><Typography.Text type="secondary">共 {filtered.length} 条</Typography.Text></Space>
      {loading ? <div className="customer-quality-loading"><Spin /></div> : error ? null : <Table<Complaint> rowKey="id" dataSource={filtered} scroll={{ x: 900 }} locale={{ emptyText: <Empty description={search ? '没有匹配的客诉' : '暂无客诉记录'} /> }} columns={[
        { title: '客诉编号', dataIndex: 'complaint_number', render: (value: string, row) => <Button type="link" onClick={() => void openDetail(row.id)}>{value}</Button> },
        { title: '类型', dataIndex: 'complaint_type', render: (value: Complaint['complaint_type']) => typeLabels[value] },
        { title: '产品', dataIndex: 'product_code', render: (value?: string | null) => value || '未填写' },
        { title: '严重度', dataIndex: 'severity', render: (value: string) => <Tag color={value === 'CRITICAL' || value === 'HIGH' ? 'red' : 'blue'}>{value}</Tag> },
        { title: '状态', dataIndex: 'status' },
        { title: '更新时间', dataIndex: 'created_at', render: (value: string) => new Date(value).toLocaleString() },
      ]} />}
    </section>
    {selected || detailLoading || detailError ? <section className="customer-quality-card" aria-live="polite"><Typography.Title level={3}>客诉详情</Typography.Title>{detailError ? <Alert type="error" showIcon title={detailError instanceof ApiError ? safeAccountError(detailError) : '客诉详情加载失败，请重试。'} description={detailError instanceof ApiError ? detailError.traceId : undefined} /> : null}{detailLoading ? <Spin /> : selected ? <Descriptions column={{ xs: 1, sm: 2 }} items={[{ key: 'number', label: '编号', children: selected.complaint_number }, { key: 'type', label: '类型', children: typeLabels[selected.complaint_type] }, { key: 'severity', label: '严重度', children: selected.severity }, { key: 'status', label: '状态', children: selected.status }, { key: 'description', label: '不良描述', span: 2, children: selected.defect_description }, { key: 'analysis', label: '解析状态', children: selected.currentAnalysis?.status ?? '未记录' }, { key: 'disposition', label: '实物处置', children: selected.currentDisposition?.status ?? '未记录' }]} /> : null}</section> : null}
  </main>;
}
