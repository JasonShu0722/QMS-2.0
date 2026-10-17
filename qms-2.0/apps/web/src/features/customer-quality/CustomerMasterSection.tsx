import { Alert, Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Typography } from 'antd';
import type { components } from '@qms/contracts';
import { useEffect, useRef, useState } from 'react';
import { apiRequest, csrfToken, safeAccountError } from '../../api/client';
import { CustomerMasterImport } from './CustomerMasterImport';

type Customer = components['schemas']['CustomerMasterDto'];
type Relation = components['schemas']['CustomerRelationDto'];
type CreateRelation = components['schemas']['CreateCustomerRelationDto'];
type Permissions = components['schemas']['PermissionsResponseDto'];
const base = '/api/v1/customer-quality';
const labels = { CUSTOMER_PARENT: '上级客户', VEHICLE_MODEL: '车型', PROJECT: '项目', PRODUCT: '产品' } as const;
export function relationPayload(values: CreateRelation): CreateRelation {
  return values.relationType === 'CUSTOMER_PARENT'
    ? { relationType: values.relationType, relatedCustomerId: values.relatedCustomerId }
    : { relationType: values.relationType, relatedCode: values.relatedCode, relatedName: values.relatedName };
}

export function CustomerMasterSection({ organizationId, organizationPermissions }: { organizationId?: string; organizationPermissions?: string[] } = {}) {
  return <CustomerMasterContent key={organizationId ?? 'current'} organizationId={organizationId} organizationPermissions={organizationPermissions} />;
}

function CustomerMasterContent({ organizationId, organizationPermissions }: { organizationId?: string; organizationPermissions?: string[] }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selected, setSelected] = useState<string>();
  const [relations, setRelations] = useState<Relation[]>([]);
  const [permissions, setPermissions] = useState<Permissions | undefined>(organizationPermissions ? { organizationId: organizationId ?? '', permissions: organizationPermissions } : undefined);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<{ kind: 'customer' | 'relation'; id: string; version: number; name: string }>();
  const [form] = Form.useForm<CreateRelation>();
  const pending = useRef<{ signature: string; key: string } | undefined>(undefined);
  const relationRequest = useRef(0);
  const selectedCustomer = useRef<string | undefined>(undefined);
  const customerRequest = useRef(0);
  const mounted = useRef(true);
  const canWrite = (organizationPermissions ?? permissions?.permissions)?.includes('customer-quality:complaints:write') ?? false;
  const scoped = (path: string) => organizationId ? `${path}?organizationId=${encodeURIComponent(organizationId)}` : path;

  async function refreshCustomers() {
    const request = ++customerRequest.current;
    try { const rows = await apiRequest<Customer[]>(scoped(`${base}/customers`)); if (mounted.current && request === customerRequest.current) { setCustomers(rows); setError(undefined); } }
    catch (cause) { if (!mounted.current || request !== customerRequest.current) return; relationRequest.current++; selectedCustomer.current = undefined; setCustomers([]); setSelected(undefined); setRelations([]); setPermissions(undefined); setEdit(undefined); setError(cause); }
  }
  async function refreshRelations(customerId: string) {
    if (selectedCustomer.current !== customerId) return;
    const requestId = ++relationRequest.current;
    try { const rows = await apiRequest<Relation[]>(scoped(`${base}/customers/${customerId}/relations`)); if (mounted.current && requestId === relationRequest.current && selectedCustomer.current === customerId) { setRelations(rows); setError(undefined); } }
    catch (cause) { if (mounted.current && requestId === relationRequest.current && selectedCustomer.current === customerId) { setRelations([]); setEdit(undefined); setError(cause); } }
  }
  useEffect(() => {
    mounted.current = true;
    void refreshCustomers();
    if (!organizationPermissions) void apiRequest<Permissions>(scoped('/api/v1/system/my-permissions')).then((value) => { if (mounted.current) setPermissions(value); }, (cause) => { if (!mounted.current) return; customerRequest.current++; relationRequest.current++; selectedCustomer.current = undefined; setPermissions(undefined); setCustomers([]); setSelected(undefined); setRelations([]); setEdit(undefined); setError(cause); });
    return () => { mounted.current = false; customerRequest.current++; relationRequest.current++; };
  }, []);

  async function mutate(path: string, method: 'POST' | 'PUT' | 'DELETE', body: object) {
    if (organizationId) body = { ...body, organizationId };
    const signature = JSON.stringify([path, method, body]);
    if (pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
    const attempt = pending.current;
    await apiRequest(path, { method, headers: { 'x-csrf-token': await csrfToken(), 'Idempotency-Key': attempt.key }, body: JSON.stringify(body) });
    if (pending.current === attempt) pending.current = undefined;
  }

  async function createCustomer(values: { code: string; name: string }) {
    if (!canWrite || busy) return;
    setBusy(true); setError(undefined);
    try { await mutate(`${base}/customers`, 'POST', values); await refreshCustomers(); }
    catch (cause) { setError(cause); }
    finally { setBusy(false); }
  }
  async function addRelation(values: CreateRelation) {
    if (!canWrite || busy || !selected) return;
    const customerId = selected;
    setBusy(true); setError(undefined);
    try {
      await mutate(`${base}/customers/${customerId}/relations`, 'POST', relationPayload(values));
      if (selectedCustomer.current === customerId) { form.resetFields(); await refreshRelations(customerId); }
    } catch (cause) { if (selectedCustomer.current === customerId) setError(cause); }
    finally { setBusy(false); }
  }
  async function saveEdit() {
    if (!edit || !canWrite || busy || !edit.name.trim()) return;
    setBusy(true); setError(undefined);
    try {
      if (edit.kind === 'customer') { await mutate(`${base}/customers/${edit.id}`, 'PUT', { expectedVersion: edit.version, name: edit.name.trim() }); await refreshCustomers(); }
      else { await mutate(`${base}/customer-relations/${edit.id}`, 'PUT', { expectedVersion: edit.version, relatedName: edit.name.trim() }); if (selected) await refreshRelations(selected); }
      setEdit(undefined);
    } catch (cause) { setError(cause); }
    finally { setBusy(false); }
  }
  async function removeRelation(row: Relation) {
    if (!canWrite || busy || !selected) return;
    setBusy(true); setError(undefined);
    try { await mutate(`${base}/customer-relations/${row.id}`, 'DELETE', { expectedVersion: row.version }); await refreshRelations(selected); }
    catch (cause) { setError(cause); await refreshRelations(selected); }
    finally { setBusy(false); }
  }

  return <section className="customer-quality-card" aria-label="客户主数据">
    <Typography.Title level={3}>客户主数据</Typography.Title>
    {error ? <Alert showIcon type="error" title={safeAccountError(error)} action={<Button onClick={() => { void refreshCustomers(); if (selected) void refreshRelations(selected); }}>重试</Button>} /> : null}
    <Space wrap><Select aria-label="选择客户" placeholder="选择客户" style={{ minWidth: 220 }} value={selected} options={customers.map((customer) => ({ value: customer.id, label: `${customer.code} · ${customer.name}` }))} onChange={(id) => { selectedCustomer.current = id; relationRequest.current++; setSelected(id); setRelations([]); setEdit(undefined); if (canWrite) form.resetFields(); void refreshRelations(id); }} /><Button onClick={() => void refreshCustomers()}>刷新客户</Button>{selected && canWrite ? <Button onClick={() => { const customer = customers.find((item) => item.id === selected); if (customer) setEdit({ kind: 'customer', id: customer.id, version: customer.version, name: customer.name }); }} disabled={busy}>编辑客户</Button> : null}</Space>
    {canWrite ? <Form layout="inline" onFinish={(values: { code: string; name: string }) => void createCustomer(values)}><Form.Item name="code" rules={[{ required: true }]}><Input aria-label="客户代码" placeholder="客户代码" maxLength={100} /></Form.Item><Form.Item name="name" rules={[{ required: true }]}><Input aria-label="客户名称" placeholder="客户名称" maxLength={200} /></Form.Item><Button htmlType="submit" loading={busy}>新增客户</Button></Form> : null}
    {canWrite ? <CustomerMasterImport organizationId={organizationId} onImported={refreshCustomers} /> : null}
    {selected ? <><Table<Relation> rowKey="id" dataSource={relations} pagination={false} columns={[{ title: '类型', dataIndex: 'relation_type', render: (value: Relation['relation_type']) => labels[value] }, { title: '关系', render: (_, row) => row.relation_type === 'CUSTOMER_PARENT' ? customers.find((item) => item.id === String(row.related_customer_id))?.name ?? String(row.related_customer_id ?? '') : `${row.related_code} · ${row.related_name}` }, ...(canWrite ? [{ title: '操作', render: (_: unknown, row: Relation) => <Space><Button onClick={() => setEdit({ kind: 'relation', id: row.id, version: row.version, name: typeof row.related_name === 'string' ? row.related_name : '' })} disabled={row.relation_type === 'CUSTOMER_PARENT' || busy}>编辑</Button><Popconfirm title="删除客户关系" description="确认删除这条关系？" okText="删除" cancelText="取消" onConfirm={() => void removeRelation(row)}><Button danger disabled={busy}>删除</Button></Popconfirm></Space> }] : [])]} />
      {canWrite ? <Form form={form} layout="inline" onFinish={(values: CreateRelation) => void addRelation(values)}><Form.Item name="relationType" rules={[{ required: true }]}><Select aria-label="关系类型" placeholder="关系类型" style={{ minWidth: 130 }} options={Object.entries(labels).map(([value, label]) => ({ value, label }))} /></Form.Item><Form.Item noStyle shouldUpdate={(prev, next) => prev.relationType !== next.relationType}>{({ getFieldValue }) => getFieldValue('relationType') === 'CUSTOMER_PARENT' ? <Form.Item name="relatedCustomerId" rules={[{ required: true }]}><Select aria-label="上级客户" placeholder="上级客户" style={{ minWidth: 160 }} options={customers.filter((item) => item.id !== selected).map((item) => ({ value: item.id, label: item.name }))} /></Form.Item> : <><Form.Item name="relatedCode" rules={[{ required: true }]}><Input aria-label="关系代码" placeholder="代码" maxLength={100} /></Form.Item><Form.Item name="relatedName" rules={[{ required: true }]}><Input aria-label="关系名称" placeholder="名称" maxLength={200} /></Form.Item></>}</Form.Item><Button htmlType="submit" loading={busy}>新增关系</Button></Form> : null}</> : null}
    <Modal title={edit?.kind === 'customer' ? '编辑客户' : '编辑关系'} open={Boolean(edit)} onCancel={() => { if (!busy) setEdit(undefined); }} footer={null} destroyOnHidden><Input aria-label="编辑名称" value={edit?.name ?? ''} maxLength={200} onChange={(event) => setEdit((current) => current ? { ...current, name: event.target.value } : current)} />{error ? <Alert type="error" title={safeAccountError(error)} /> : null}<Space><Button onClick={() => setEdit(undefined)} disabled={busy}>取消</Button><Button type="primary" onClick={() => void saveEdit()} disabled={!edit?.name.trim()} loading={busy}>保存</Button></Space></Modal>
  </section>;
}
