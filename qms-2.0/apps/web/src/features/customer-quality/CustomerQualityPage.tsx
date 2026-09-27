import { Alert, Button, Descriptions, Empty, Input, Space, Spin, Table, Tag, Typography } from 'antd';
import type { components } from '@qms/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, apiRequest, csrfToken, safeAccountError } from '../../api/client';
import { importFields, readComplaintWorkbook, serializeComplaintImport, type ImportError } from './customer-quality-import';
import { CustomerMasterSection } from './CustomerMasterSection';
import { CustomerComplaintProcessing } from './CustomerComplaintProcessing';
import { CustomerComplaintEntry } from './CustomerComplaintEntry';
import './customer-quality.css';

type Complaint = components['schemas']['CustomerComplaintDto'];
type ComplaintDetail = components['schemas']['CustomerComplaintDetailDto'];
type ImportBody = components['schemas']['ImportCustomerComplaintsDto'];
type ImportResult = components['schemas']['CustomerComplaintImportResultDto'];
type Permissions = components['schemas']['PermissionsResponseDto'];

const typeLabels: Record<Complaint['complaint_type'], string> = { ZERO_KM: '0KM', AFTER_SALES: '售后' };

export function CustomerQualityPage() {
  const [items, setItems] = useState<Complaint[]>([]);
  const [selected, setSelected] = useState<ComplaintDetail>();
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<unknown>();
  const [detailError, setDetailError] = useState<unknown>();
  const [importName, setImportName] = useState('');
  const [importRows, setImportRows] = useState<ImportBody['rows']>([]);
  const [importErrors, setImportErrors] = useState<ImportError[]>([]);
  const [importError, setImportError] = useState<unknown>();
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult>();
  const [imported, setImported] = useState(false);
  const [permissions, setPermissions] = useState<Permissions>();
  const [permissionError, setPermissionError] = useState<unknown>();
  const importKey = useRef('');
  const detailRequestId = useRef(0);

  async function loadPermissions() {
    setPermissions(undefined); setPermissionError(undefined);
    try { setPermissions(await apiRequest<Permissions>('/api/v1/system/my-permissions')); }
    catch (cause) { setPermissionError(cause); }
  }

  async function load() {
    setLoading(true); setError(undefined);
    try { setItems(await apiRequest<Complaint[]>('/api/v1/customer-quality/complaints')); }
    catch (cause) { setItems([]); setError(cause); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); void loadPermissions(); }, []);

  async function openDetail(id: string) {
    const requestId = ++detailRequestId.current;
    setDetailLoading(true); setDetailError(undefined);
    setSelected(undefined);
    try { const detail = await apiRequest<ComplaintDetail>(`/api/v1/customer-quality/complaints/${id}`); if (requestId === detailRequestId.current) setSelected(detail); }
    catch (cause) { if (requestId === detailRequestId.current) { setSelected(undefined); setDetailError(cause); } }
    finally { if (requestId === detailRequestId.current) setDetailLoading(false); }
  }

  async function selectImport(file: File) {
    setImportName(file.name); setImportRows([]); setImportErrors([]); setImportResult(undefined);
    setImportError(undefined); setImported(false); importKey.current = crypto.randomUUID();
    setImportBusy(true);
    try {
      const parsed = await readComplaintWorkbook(file);
      setImportRows(parsed.rows); setImportErrors(parsed.errors);
    } catch (cause) { setImportError(cause); }
    finally { setImportBusy(false); }
  }

  async function submitImport() {
    if (importBusy || imported || !permissions?.permissions.includes('customer-quality:complaints:write') || !importRows.length || importErrors.length) return;
    setImportBusy(true); setImportError(undefined);
    try {
      const body = serializeComplaintImport(importRows);
      const result = await apiRequest<ImportResult>('/api/v1/customer-quality/complaints/import', {
        method: 'POST',
        headers: { 'x-csrf-token': await csrfToken(), 'Idempotency-Key': importKey.current },
        body,
      });
      setImportResult(result); setImported(true);
      await load();
    } catch (cause) { setImportError(cause); }
    finally { setImportBusy(false); }
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
    {permissionError && !(error instanceof ApiError && error.status === 403) ? <Alert type="warning" showIcon title="无法验证客诉导入权限" action={<Button onClick={() => void loadPermissions()}>重试</Button>} /> : null}
    <CustomerMasterSection />
    {permissions?.permissions.includes('customer-quality:complaints:write') ? <section className="customer-quality-card"><CustomerComplaintEntry onCreated={async (id) => { await Promise.all([load(), openDetail(id)]); }} /></section> : null}
    {permissions?.permissions.includes('customer-quality:complaints:write') && !(error instanceof ApiError && error.status === 403) ? <section className="customer-quality-card customer-quality-import" aria-live="polite">
      <Typography.Title level={3}>Excel 批量导入</Typography.Title>
      <Typography.Paragraph type="secondary">选择 .xlsx 文件的首个工作表。首行为英文契约列名：{importFields.slice(0, 9).join('、')}。每次最多 100 条；文件只在本地解析，提交时发送 JSON。</Typography.Paragraph>
      <label className="customer-quality-import__picker">选择客诉 Excel 文件 <input aria-label="选择客诉 Excel 文件" type="file" accept=".xlsx" disabled={importBusy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void selectImport(file); }} /></label>
      {importBusy && !importRows.length ? <Spin /> : null}
      {importName ? <Typography.Paragraph>当前文件：{importName}；数据行：{importRows.length}</Typography.Paragraph> : null}
      {importError ? <Alert type={importError instanceof ApiError && importError.status === 403 ? 'warning' : 'error'} showIcon title={importError instanceof ApiError ? safeAccountError(importError) : importError instanceof Error ? importError.message : '导入失败，请重试'} description={importError instanceof ApiError ? importError.traceId : undefined} /> : null}
      {importErrors.length ? <Alert type="error" showIcon title={`发现 ${importErrors.length} 处字段错误，修正 Excel 后重新选择文件`} description={<ul>{importErrors.map((issue, index) => <li key={`${issue.rowNumber}-${issue.field}-${index}`}>第 {issue.rowNumber} 行 {issue.field}：{issue.message}</li>)}</ul>} /> : null}
      {importRows.length ? <><Table<ImportBody['rows'][number]> size="small" rowKey="rowNumber" dataSource={importRows} pagination={{ pageSize: 10 }} scroll={{ x: 800 }} columns={[
        { title: 'Excel 行', dataIndex: 'rowNumber' },
        ...importFields.map((field) => ({ title: field, dataIndex: field, render: (value: unknown) => value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value) })),
      ]} /><Button type="primary" loading={importBusy} disabled={Boolean(importErrors.length) || imported} onClick={() => void submitImport()}>导入 {importRows.length} 条</Button></> : null}
      {importResult ? <><Typography.Paragraph>已创建 {importResult.created} 条，重复 {importResult.duplicates} 条，拒绝 {importResult.rejected} 条。</Typography.Paragraph><Table<ImportResult['items'][number]> size="small" rowKey="rowNumber" dataSource={importResult.items} pagination={{ pageSize: 10 }} columns={[
        { title: 'Excel 行', dataIndex: 'rowNumber' }, { title: '结果', dataIndex: 'status', render: (status: string) => ({ CREATED: '已创建', DUPLICATE: '重复', REJECTED: '已拒绝' })[status as 'CREATED' | 'DUPLICATE' | 'REJECTED'] }, { title: '客诉编号', dataIndex: 'complaintNumber', render: (value: string | null) => value ?? '—' }, { title: '错误代码', dataIndex: 'errorCode', render: (value: string | null) => value ?? '—' },
      ]} /></> : null}
    </section> : null}
    {selected || detailLoading || detailError ? <section className="customer-quality-card" aria-live="polite"><Typography.Title level={3}>客诉详情</Typography.Title>{detailError ? <Alert type="error" showIcon title={detailError instanceof ApiError ? safeAccountError(detailError) : '客诉详情加载失败，请重试。'} description={detailError instanceof ApiError ? detailError.traceId : undefined} /> : null}{detailLoading ? <Spin /> : selected ? <Descriptions column={{ xs: 1, sm: 2 }} items={[{ key: 'number', label: '编号', children: selected.complaint_number }, { key: 'type', label: '类型', children: typeLabels[selected.complaint_type] }, { key: 'severity', label: '严重度', children: selected.severity }, { key: 'status', label: '状态', children: selected.status }, { key: 'description', label: '不良描述', span: 2, children: selected.defect_description }, { key: 'analysis', label: '解析状态', children: selected.currentAnalysis?.status ?? '未记录' }, { key: 'disposition', label: '实物处置', children: selected.currentDisposition?.status ?? '未记录' }]} /> : null}{selected ? <CustomerComplaintProcessing key={selected.id} complaint={selected} canWrite={Boolean(permissions?.permissions.includes('customer-quality:complaints:write'))} refresh={async () => { await Promise.all([load(), openDetail(selected.id)]); }} /> : null}</section> : null}
  </main>;
}
