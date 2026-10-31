import type { components } from '@qms/contracts';
import { Alert, Button, Empty, Form, Input, Select, Space, Spin, Table, Tag, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest, csrfToken, safeAccountError } from '../../api/client';
import { useNavigationBusy, useUnsavedChanges } from '../../layouts/UnsavedChanges';

type Document = components['schemas']['SupplierAdmissionDocumentDto'];
type Page = components['schemas']['SupplierAdmissionPageDto'];
type Create = components['schemas']['CreateSupplierAdmissionDocumentDto'];
type Submit = components['schemas']['SubmitSupplierAdmissionDocumentDto'];

const internalPath = '/api/v1/supplier-admission/quality-documents';
const portalPath = '/api/v1/supplier-portal/quality-documents';
const statuses: Record<string, string> = { DRAFT: '草稿', SUBMITTED: '待审核', NEEDS_CHANGES: '需补充', ACCEPTED: '已通过' };
const types: Record<string, string> = { QUALITY_MANUAL: '质量手册', CERTIFICATE: '资质证书', PROCESS_CONTROL: '过程控制', PPAP: 'PPAP', OTHER: '其他' };

function textError(cause: unknown) {
  if (cause instanceof ApiError && cause.code === 'FILE_NOT_AVAILABLE') return '附件尚未通过扫描，请稍后重试';
  if (cause instanceof ApiError && cause.code === 'CONCURRENCY_CONFLICT') return '资料已被更新，请刷新后重试';
  return safeAccountError(cause);
}

async function mutate<T>(path: string, body: object) {
  const token = await csrfToken();
  return apiRequest<T>(path, { method: 'POST', headers: { 'x-csrf-token': token, 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body) });
}

export function SupplierAdmissionPage({ portal = false }: { portal?: boolean }) {
  const base = portal ? portalPath : internalPath;
  const [page, setPage] = useState<Page>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<string>();
  const [form] = Form.useForm<Create>();
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Document>();
  const [fileId, setFileId] = useState('');
  const [actionError, setActionError] = useState<string>();
  const key = useRef(false);
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(portal && (dirty || !!fileId));
  useNavigationBusy(saving);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(undefined);
    const query = new URLSearchParams({ page: '1', pageSize: '50' }); if (status) query.set('status', status);
    void apiRequest<Page>(`${base}?${query}`).then((result) => { if (active) setPage(result); }).catch((cause) => { if (active) setError(textError(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [base, status, revision]);

  async function create(values: Create) { if (key.current) return;
    key.current = true; setSaving(true); setActionError(undefined);
    try { await mutate<Document>(portalPath, values); form.resetFields(); setDirty(false); setRevision((value) => value + 1); }
    catch (cause) { setActionError(textError(cause)); }
    finally { key.current = false; setSaving(false); }
  }

  async function submit(record: Document) {
    if (key.current) return;
    if (!fileId.trim()) { setActionError('请输入已扫描通过的附件 ID'); return; }
    key.current = true; setSaving(true); setActionError(undefined);
    try { await mutate<Document>(`${portalPath}/${record.id}/submit`, { expectedVersion: record.version, fileId } satisfies Submit); setFileId(''); setRevision((value) => value + 1); }
    catch (cause) { setActionError(textError(cause)); }
    finally { key.current = false; setSaving(false); }
  }

  async function review(record: Document, decision: 'NEEDS_CHANGES' | 'ACCEPTED') { if (key.current) return;
    key.current = true; setSaving(true); setActionError(undefined);
    try { await mutate<Document>(`${internalPath}/${record.id}/review`, { expectedVersion: record.version, decision, note: decision === 'ACCEPTED' ? '资料完整，审核通过' : '请补充或修订资料' }); setRevision((value) => value + 1); }
    catch (cause) { setActionError(textError(cause)); }
    finally { key.current = false; setSaving(false); }
  }

  return <main className="supplier-admission-page">
    <header>{portal ? <><Typography.Text type="secondary">供应商质量 · 质量资料</Typography.Text><Typography.Title level={1}>质量资料提交</Typography.Title><Typography.Paragraph type="secondary">资料必须绑定真实附件，只有通过安全扫描的版本才可提交审核。</Typography.Paragraph></> : <h1 className="sr-only">供应商质量资料审核</h1>}<Space><Select aria-label="按状态筛选" allowClear placeholder="全部状态" value={status} onChange={setStatus} options={Object.entries(statuses).map(([value, label]) => ({ value, label }))} /><Button onClick={() => setRevision((value) => value + 1)}>刷新</Button></Space></header>
    {actionError ? <Alert type="error" showIcon title={actionError} /> : null}
    {portal ? <Form form={form} layout="inline" onValuesChange={() => setDirty(true)} onFinish={(values) => void create(values)} disabled={saving}><Form.Item name="profileId" label="供应商档案 ID" rules={[{ required: true }]}><Input placeholder="档案 UUID" /></Form.Item><Form.Item name="documentType" label="资料类型" rules={[{ required: true }]}><Select style={{ width: 150 }} options={Object.entries(types).map(([value, label]) => ({ value, label }))} /></Form.Item><Form.Item name="title" label="资料标题" rules={[{ required: true }]}><Input placeholder="例如：质量手册" /></Form.Item><Button type="primary" htmlType="submit" loading={saving}>新建资料</Button></Form> : null}
    <section aria-label="质量资料台账">{loading ? <Spin /> : error ? <Alert type="error" showIcon title={error} /> : <Table<Document> rowKey="id" dataSource={page?.items ?? []} pagination={false} locale={{ emptyText: <Empty description="暂无质量资料" /> }} columns={[{ title: '资料标题', dataIndex: 'title' }, { title: '类型', dataIndex: 'documentType', render: (value: string) => types[value] ?? value }, { title: '状态', dataIndex: 'status', render: (value: string) => <Tag color={value === 'ACCEPTED' ? 'green' : value === 'NEEDS_CHANGES' ? 'orange' : 'blue'}>{statuses[value] ?? value}</Tag> }, { title: '版本', dataIndex: 'version' }, { title: '操作', key: 'actions', render: (_: unknown, record) => portal ? <Space><Input disabled={saving} aria-label={`${record.title}附件 ID`} placeholder="附件 UUID" value={selected?.id === record.id ? fileId : ''} onChange={(event) => { setSelected(record); setFileId(event.target.value); }} /><Button disabled={!['DRAFT', 'NEEDS_CHANGES'].includes(record.status)} loading={saving} onClick={() => void submit(record)}>提交审核</Button></Space> : <Space><Button disabled={record.status !== 'SUBMITTED'} loading={saving} onClick={() => void review(record, 'ACCEPTED')}>通过</Button><Button disabled={record.status !== 'SUBMITTED'} loading={saving} onClick={() => void review(record, 'NEEDS_CHANGES')}>退回补充</Button></Space> }]} />}</section>
  </main>;
}
