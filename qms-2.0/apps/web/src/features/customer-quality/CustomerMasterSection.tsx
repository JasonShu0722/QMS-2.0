import { Alert, Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Typography } from 'antd';
import type { components } from '@qms/contracts';
import { useEffect, useRef, useState } from 'react';
import { apiRequest, csrfToken, safeAccountError } from '../../api/client';
import { CustomerMasterImport } from './CustomerMasterImport';
import { useLanguage } from '../../i18n/Language';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';

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
  const { t } = useLanguage();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selected, setSelected] = useState<string>();
  const [relations, setRelations] = useState<Relation[]>([]);
  const [permissions, setPermissions] = useState<Permissions | undefined>(organizationPermissions ? { organizationId: organizationId ?? '', permissions: organizationPermissions } : undefined);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [customersLoaded, setCustomersLoaded] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);
  const [edit, setEdit] = useState<{ kind: 'customer' | 'relation'; id: string; version: number; name: string }>();
  const [creating, setCreating] = useState(false);
  const [createDirty, setCreateDirty] = useState(false);
  const [createForm] = Form.useForm<components['schemas']['CreateCustomerDto']>();
  const mutationInFlight = useRef(false);
  const relationSubmitting = useRef(false);
  const [relationDirty, setRelationDirty] = useState(false);
  const [editDirty, setEditDirty] = useState(false);
  const requestLeave = useNavigationGuard();
  useUnsavedChanges(createDirty || relationDirty || editDirty);
  useNavigationBusy(busy);
  const [form] = Form.useForm<CreateRelation>();
  const pending = useRef<{ signature: string; key: string } | undefined>(undefined);
  const relationRequest = useRef(0);
  const selectedCustomer = useRef<string | undefined>(undefined);
  const customerRequest = useRef(0);
  const mounted = useRef(true);
  const canWrite = (organizationPermissions ?? permissions?.permissions)?.includes('customer-quality:complaints:write') ?? false;
  const canRead = (organizationPermissions ?? permissions?.permissions)?.includes('customer-quality:complaints:read') ?? false;
  const readable = useRef(canRead);
  readable.current = canRead;
  const scoped = (path: string) => organizationId ? `${path}?organizationId=${encodeURIComponent(organizationId)}` : path;

  async function refreshCustomers(reportFailure = false) {
    const request = ++customerRequest.current;
    setCustomersLoaded(false);
    try {
      const currentPermissions = organizationPermissions ? undefined : await apiRequest<Permissions>(scoped('/api/v1/system/my-permissions'));
      if (!mounted.current || request !== customerRequest.current) return;
      if (currentPermissions) setPermissions(currentPermissions);
      if (!(organizationPermissions ?? currentPermissions?.permissions)?.includes('customer-quality:complaints:read')) {
        setCustomers([]); setRelations([]); setSelected(undefined); selectedCustomer.current = undefined; relationRequest.current++;
        return;
      }
      const rows = await apiRequest<Customer[]>(scoped(`${base}/customers`));
      if (mounted.current && request === customerRequest.current) {
        setCustomers(rows); setCustomersLoaded(true); setError(undefined);
      }
    }
    catch (cause) { if (!mounted.current || request !== customerRequest.current) return; relationRequest.current++; selectedCustomer.current = undefined; setCustomers([]); setSelected(undefined); setRelations([]); setEdit(undefined); setError(cause); if (reportFailure) throw cause; }
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
    return () => { mounted.current = false; customerRequest.current++; relationRequest.current++; };
  }, []);

  async function exportCustomers() {
    if (!canRead || !customersLoaded || !customers.length || exporting) return;
    const request = customerRequest.current;
    setExporting(true); setExportError(false);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet(t('客户'));
      sheet.addRow([t('客户编码'), t('客户名称')]);
      customers.forEach((customer) => sheet.addRow([customer.code, customer.name]));
      sheet.columns.forEach((column) => { column.width = 24; column.numFmt = '@'; });
      const bytes = await workbook.xlsx.writeBuffer();
      if (!mounted.current || request !== customerRequest.current || !readable.current) return;
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      try { const link = document.createElement('a'); link.href = url; link.download = `${t('客户清单')}.xlsx`; link.click(); }
      finally { URL.revokeObjectURL(url); }
    } catch { if (mounted.current && request === customerRequest.current) setExportError(true); }
    finally { if (mounted.current) setExporting(false); }
  }

  async function mutate(path: string, method: 'POST' | 'PUT' | 'DELETE', body: object) {
    if (organizationId) body = { ...body, organizationId };
    const signature = JSON.stringify([path, method, body]);
    if (pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
    const attempt = pending.current;
    await apiRequest(path, { method, headers: { 'x-csrf-token': await csrfToken(), 'Idempotency-Key': attempt.key }, body: JSON.stringify(body) });
    if (pending.current === attempt) pending.current = undefined;
  }

  async function createCustomer(values: components['schemas']['CreateCustomerDto']) {
    if (!canWrite || mutationInFlight.current) return;
    mutationInFlight.current = true; setBusy(true); setError(undefined);
    try {
      await mutate(`${base}/customers`, 'POST', values);
      if (!mounted.current) return;
      createForm.resetFields(); setCreateDirty(false); setCreating(false);
      if (canRead) await refreshCustomers();
    }
    catch (cause) { if (mounted.current) setError(cause); }
    finally { mutationInFlight.current = false; if (mounted.current) setBusy(false); }
  }
  function cancelCreate() {
    if (busy) return;
    requestLeave(() => { createForm.resetFields(); setCreateDirty(false); setCreating(false); }, true);
  }
  function cancelEdit() { if (!busy) requestLeave(() => { setEdit(undefined); setEditDirty(false); }, true); }
  function changeCustomer(id: string) {
    if (busy && !relationSubmitting.current) return;
    const change = () => { selectedCustomer.current = id; relationRequest.current++; setSelected(id); setRelations([]); setEdit(undefined); setEditDirty(false); setRelationDirty(false); if (canWrite) form.resetFields(); void refreshRelations(id); };
    // The submitted relation belongs to its captured customer; later responses cannot replace this view.
    if (relationSubmitting.current && !createDirty && !editDirty) change();
    else requestLeave(change);
  }
  function refreshFromUser() {
    if (busy) return;
    requestLeave(() => { form.resetFields(); setRelationDirty(false); setEdit(undefined); setEditDirty(false); void refreshCustomers(); });
  }
  async function addRelation(values: CreateRelation) {
    if (!canWrite || busy || !selected) return;
    const customerId = selected;
    relationSubmitting.current = true;
    setBusy(true); setError(undefined);
    try {
      await mutate(`${base}/customers/${customerId}/relations`, 'POST', relationPayload(values));
      if (selectedCustomer.current === customerId) { form.resetFields(); setRelationDirty(false); await refreshRelations(customerId); }
    } catch (cause) { if (selectedCustomer.current === customerId) setError(cause); }
    finally { relationSubmitting.current = false; setBusy(false); }
  }
  async function saveEdit() {
    if (!edit || !canWrite || busy || !edit.name.trim()) return;
    setBusy(true); setError(undefined);
    try {
      if (edit.kind === 'customer') { await mutate(`${base}/customers/${edit.id}`, 'PUT', { expectedVersion: edit.version, name: edit.name.trim() }); await refreshCustomers(); }
      else { await mutate(`${base}/customer-relations/${edit.id}`, 'PUT', { expectedVersion: edit.version, relatedName: edit.name.trim() }); if (selected) await refreshRelations(selected); }
      setEdit(undefined);
      setEditDirty(false);
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
    {exportError ? <Alert showIcon type="error" title={t('客户清单导出失败，请重试')} /> : null}
    {error ? <Alert showIcon type="error" title={safeAccountError(error)} action={<Button onClick={refreshFromUser}>重试</Button>} /> : null}
    {canRead ? <Space wrap><Select aria-label="选择客户" placeholder="选择客户" style={{ minWidth: 220 }} value={selected} options={customers.map((customer) => ({ value: customer.id, label: `${customer.code} · ${customer.name}` }))} disabled={busy && !relationSubmitting.current} onChange={changeCustomer} /><Button disabled={busy} onClick={refreshFromUser}>刷新客户</Button>{canRead ? <Button onClick={() => void exportCustomers()} loading={exporting} disabled={!customersLoaded || !customers.length || exporting}>{t('导出当前客户清单')}</Button> : null}{selected && canWrite ? <Button onClick={() => requestLeave(() => { const customer = customers.find((item) => item.id === selected); if (customer) { setEditDirty(false); setEdit({ kind: 'customer', id: customer.id, version: customer.version, name: customer.name }); } })} disabled={busy}>编辑客户</Button> : null}</Space> : null}
    {canWrite ? <Space wrap><Button onClick={() => setCreating(true)}>{t('新增客户')}</Button><CustomerMasterImport organizationId={organizationId} onImported={canRead ? () => refreshCustomers(true) : () => undefined} /></Space> : null}
    {canWrite ? <Modal title={t('新增客户')} open={creating} footer={null} onCancel={cancelCreate} closable={!busy} keyboard={!busy} mask={{ closable: false }}>
      <Form form={createForm} layout="vertical" onValuesChange={() => setCreateDirty(true)} onFinish={(values: components['schemas']['CreateCustomerDto']) => void createCustomer(values)}>
        <Form.Item name="code" rules={[{ required: true, whitespace: true }]}><Input aria-label="客户代码" placeholder="客户代码" maxLength={100} disabled={busy} /></Form.Item>
        <Form.Item name="name" rules={[{ required: true, whitespace: true }]}><Input aria-label="客户名称" placeholder="客户名称" maxLength={200} disabled={busy} /></Form.Item>
        {error ? <Alert showIcon type="error" title={safeAccountError(error)} /> : null}
        <div className="qms-dialog-actions" role="group" aria-label={t('新增客户')}><Button type="primary" htmlType="submit" loading={busy}>{t('保存')}</Button></div>
      </Form>
    </Modal> : null}
    {selected ? <><Table<Relation> rowKey="id" dataSource={relations} pagination={false} columns={[{ title: '类型', dataIndex: 'relation_type', render: (value: Relation['relation_type']) => labels[value] }, { title: '关系', render: (_, row) => row.relation_type === 'CUSTOMER_PARENT' ? customers.find((item) => item.id === String(row.related_customer_id))?.name ?? String(row.related_customer_id ?? '') : `${row.related_code} · ${row.related_name}` }, ...(canWrite ? [{ title: '操作', render: (_: unknown, row: Relation) => <Space><Button onClick={() => requestLeave(() => { setEditDirty(false); setEdit({ kind: 'relation', id: row.id, version: row.version, name: typeof row.related_name === 'string' ? row.related_name : '' }); })} disabled={row.relation_type === 'CUSTOMER_PARENT' || busy}>编辑</Button><Popconfirm title="删除客户关系" description="确认删除这条关系？" okText="删除" cancelText="取消" onConfirm={() => void removeRelation(row)}><Button danger disabled={busy}>删除</Button></Popconfirm></Space> }] : [])]} />
      {canWrite ? <Form form={form} disabled={busy} onValuesChange={() => setRelationDirty(true)} layout="inline" onFinish={(values: CreateRelation) => void addRelation(values)}><Form.Item name="relationType" rules={[{ required: true }]}><Select aria-label="关系类型" placeholder="关系类型" style={{ minWidth: 130 }} options={Object.entries(labels).map(([value, label]) => ({ value, label }))} /></Form.Item><Form.Item noStyle shouldUpdate={(prev, next) => prev.relationType !== next.relationType}>{({ getFieldValue }) => getFieldValue('relationType') === 'CUSTOMER_PARENT' ? <Form.Item name="relatedCustomerId" rules={[{ required: true }]}><Select aria-label="上级客户" placeholder="上级客户" style={{ minWidth: 160 }} options={customers.filter((item) => item.id !== selected).map((item) => ({ value: item.id, label: item.name }))} /></Form.Item> : <><Form.Item name="relatedCode" rules={[{ required: true }]}><Input aria-label="关系代码" placeholder="代码" maxLength={100} /></Form.Item><Form.Item name="relatedName" rules={[{ required: true }]}><Input aria-label="关系名称" placeholder="名称" maxLength={200} /></Form.Item></>}</Form.Item><Button htmlType="submit" loading={busy}>新增关系</Button></Form> : null}</> : null}
    <Modal title={edit?.kind === 'customer' ? '编辑客户' : '编辑关系'} open={Boolean(edit)} onCancel={cancelEdit} closable={!busy} keyboard={!busy} mask={{ closable: !busy }} footer={null} destroyOnHidden><Input disabled={busy} aria-label="编辑名称" value={edit?.name ?? ''} maxLength={200} onChange={(event) => { setEdit((current) => current ? { ...current, name: event.target.value } : current); setEditDirty(true); }} />{error ? <Alert type="error" title={safeAccountError(error)} /> : null}<div className="qms-dialog-actions" role="group" aria-label={edit?.kind === 'customer' ? '编辑客户' : '编辑关系'}><Button onClick={cancelEdit} disabled={busy}>取消</Button><Button type="primary" onClick={() => void saveEdit()} disabled={!edit?.name.trim()} loading={busy}>保存</Button></div></Modal>
  </section>;
}
