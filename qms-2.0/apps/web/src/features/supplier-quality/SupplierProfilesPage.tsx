import { Alert, Button, Form, Input, Modal, Popconfirm, Space, Table, Typography } from 'antd';
import { useState } from 'react';
import { apiRequest } from '../../api/client';
import { createSupplierMutation, supplierApi, supplierError, type ProfileInput, type ProfilePage, type SupplierProfile } from './supplierQuality';
import { SupplierReferenceSelect } from './SupplierReferenceSelect';
import { useSupplierData } from './useSupplierData';

export function SupplierProfilesPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<SupplierProfile>();
  const [notice, setNotice] = useState<string>();
  const result = useSupplierData<ProfilePage>(`${supplierApi(false)}/profiles?page=${page}&search=${encodeURIComponent(search)}`);
  function saved() { setEditing(undefined); setNotice('供应商资料已保存'); result.reload(); }
  return <>
    <div className="supplier-toolbar"><Input.Search aria-label="搜索供应商资料" placeholder="搜索供应商名称或业务编码" maxLength={100} allowClear onSearch={(value) => { setSearch(value); setPage(1); }} /></div>
    {notice ? <Alert type="success" title={notice} /> : null}
    {result.error ? <Alert type="error" title={result.error} action={<Button onClick={result.reload}>重新加载</Button>} /> : <Table<SupplierProfile> rowKey="id" loading={result.loading} dataSource={result.data?.items ?? []} scroll={{ x: 700 }} pagination={{ current: page, pageSize: 20, total: result.data?.total ?? 0, showSizeChanger: false, onChange: setPage }} columns={[
      { title: '业务编码', dataIndex: 'businessCode' }, { title: '供应商名称', dataIndex: 'displayName' }, { title: '联系人', dataIndex: 'contactName' }, { title: '联系邮箱', dataIndex: 'contactEmail' },
      ...(result.data?.canManage ? [{ title: '操作', key: 'actions', render: (_: unknown, profile: SupplierProfile) => <Button onClick={() => { setEditing(profile); setNotice(undefined); }}>编辑资料</Button> }] : []),
    ]} />}
    {result.data?.canManage ? <section className="supplier-card"><Typography.Title level={3}>登记供应商资料</Typography.Title><ProfileForm saved={saved} /></section> : null}
    {editing ? <ProfileEditor record={editing} saved={saved} close={() => setEditing(undefined)} /> : null}
  </>;
}

function ProfileEditor({ record, saved, close }: { record: SupplierProfile; saved: () => void; close: () => void }) {
  const [current, setCurrent] = useState(record);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [reloadRevision, setReloadRevision] = useState(0);
  async function reload() {
    setBusy(true); setError(undefined);
    try { setCurrent(await apiRequest<SupplierProfile>(`${supplierApi(false)}/profiles/${record.id}`)); setReloadRevision((value) => value + 1); }
    catch (cause) { setError(supplierError(cause)); }
    finally { setBusy(false); }
  }
  return <Modal open title="编辑供应商资料" footer={null} onCancel={close} closable={!busy} keyboard={!busy} mask={{ closable: false }}>
    {error ? <Alert type="error" title={error} /> : null}
    <ProfileForm key={`${current.version}-${reloadRevision}`} record={current} saved={saved} busyChanged={setBusy} disabled={busy} />
    <Space><Popconfirm title="重新加载将丢弃尚未保存的资料，是否继续？" onConfirm={reload} okText="重新加载" cancelText="保留编辑"><Button disabled={busy}>重新加载资料</Button></Popconfirm><Button disabled={busy} onClick={close}>取消编辑</Button></Space>
  </Modal>;
}

function ProfileForm({ record, saved, busyChanged, disabled }: { record?: SupplierProfile; saved: () => void; busyChanged?: (busy: boolean) => void; disabled?: boolean }) {
  const [form] = Form.useForm<ProfileInput>();
  const [mutate] = useState(createSupplierMutation);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(values: ProfileInput) {
    setBusy(true); busyChanged?.(true); setError(undefined);
    const content = { businessCode: values.businessCode, contactName: values.contactName?.trim() || undefined, contactEmail: values.contactEmail?.trim() || undefined };
    try {
      await mutate(`${supplierApi(false)}/profiles${record ? `/${record.id}` : ''}`, record ? 'PUT' : 'POST', record ? { ...content, expectedVersion: record.version } : { ...content, supplierOrganizationId: values.supplierOrganizationId });
      form.resetFields(); saved();
    } catch (cause) { setError(supplierError(cause)); }
    finally { setBusy(false); busyChanged?.(false); }
  }
  return <>
    {error ? <Alert type="error" showIcon title={error} /> : null}
    <Form name={record ? `supplier-profile-edit-${record.id}` : 'supplier-profile-create'} form={form} layout="vertical" initialValues={record} onFinish={submit} disabled={busy || disabled}>
      <div className="supplier-form-grid">
        {record ? <Form.Item label="供应商企业"><Input aria-label="供应商企业" value={record.displayName} disabled /></Form.Item> : <Form.Item name="supplierOrganizationId" label="供应商企业" rules={[{ required: true, message: '请选择供应商企业' }]}><SupplierReferenceSelect path={`${supplierApi(false)}/supplier-options`} /></Form.Item>}
        <Form.Item name="businessCode" label="业务编码" rules={[{ required: true, whitespace: true, message: '请填写业务编码' }]}><Input maxLength={100} /></Form.Item>
        <Form.Item name="contactName" label="联系人"><Input maxLength={100} /></Form.Item>
        <Form.Item name="contactEmail" label="联系邮箱" rules={[{ type: 'email', message: '请输入有效邮箱' }]}><Input maxLength={254} /></Form.Item>
      </div><Form.Item><Button type="primary" htmlType="submit" loading={busy}>{record ? '保存供应商资料' : '登记供应商'}</Button></Form.Item>
    </Form>
  </>;
}
