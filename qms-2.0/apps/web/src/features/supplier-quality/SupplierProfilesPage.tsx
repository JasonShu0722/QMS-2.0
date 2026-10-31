import { Alert, Button, Form, Input, Modal, Popconfirm, Space, Typography } from 'antd';
import { LedgerTable, useLedgerPageSize } from '../../ui/ledger';
import type { components } from '@qms/contracts';
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { createSupplierMutation, supplierApi, supplierError, type ProfileInput, type ProfilePage, type SupplierProfile } from './supplierQuality';
import { SupplierMasterImport } from './SupplierMasterImport';
import { SupplierUsersPanel } from './SupplierUsersPanel';

type Props = { organizationId?: string; organizationPermissions?: string[]; onDenied?: (cause: ApiError) => void };
const base = `${supplierApi(false)}/profiles`;
export function SupplierProfilesPage(props: Props = {}) {
  return <ProfilesContent key={props.organizationId ?? 'current'} {...props} />;
}

function ProfilesContent({ organizationId, organizationPermissions, onDenied }: Props) {
  const [pageSize, setPageSize] = useLedgerPageSize('supplier-profiles', organizationId);
  const { t } = useLanguage();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [permissions, setPermissions] = useState<string[]>(organizationPermissions ?? []);
  const [data, setData] = useState<ProfilePage>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>();
  const [editing, setEditing] = useState<SupplierProfile>();
  const [creating, setCreating] = useState(false);
  const [accounts, setAccounts] = useState<SupplierProfile>();
  const [notice, setNotice] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [denied, setDenied] = useState(false);
  const alive = useRef(true);
  const sequence = useRef(0);
  const granted = organizationPermissions ?? permissions;
  const canRead = !denied && granted.includes('supplier-quality:profiles:read');
  const canWrite = !denied && granted.includes('supplier-quality:profiles:write');
  const scope = organizationId ? `&organizationId=${encodeURIComponent(organizationId)}` : '';
  function accountDenied(cause: ApiError) {
    if (!alive.current) return;
    sequence.current++; setDenied(true); setData(undefined); setEditing(undefined); setCreating(false); setAccounts(undefined);
    setNotice(false); setSearch(''); setLoading(false); setError(cause); onDenied?.(cause);
  }
  async function reload(reportFailure = false) {
    const request = ++sequence.current;
    setLoading(true);
    try {
      const result = await apiRequest<ProfilePage>(`${base}?page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(search)}${scope}`);
      if (alive.current && request === sequence.current) { setData(result); setDenied(false); setError(undefined); }
    } catch (cause) { if (alive.current && request === sequence.current) { setData(undefined); setError(cause); } if (reportFailure) throw cause; }
    finally { if (alive.current && request === sequence.current) setLoading(false); }
  }
  useEffect(() => {
    alive.current = true;
    if (!organizationPermissions) void apiRequest<components['schemas']['PermissionsResponseDto']>(`/api/v1/system/my-permissions${organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : ''}`).then((result) => { if (alive.current) setPermissions(result.permissions); }, (cause) => { if (alive.current) setError(cause); });
    return () => { alive.current = false; sequence.current++; };
  }, []);
  useEffect(() => { if (canRead) void reload(); else { sequence.current++; setData(undefined); } }, [page, pageSize, search, canRead]);
  function saved() { if (!alive.current) return; setCreating(false); setEditing(undefined); setNotice(true); if (canRead) void reload(); }
  async function exportPage() {
    if (!canRead || loading || exporting || !data?.items.length) return;
    setExporting(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet(t('供应商清单'));
      sheet.addRow(['供应商编码', '供应商名称', '联系人', '联系邮箱'].map(t));
      data.items.forEach((item) => sheet.addRow([item.businessCode, item.displayName, item.contactName ?? '', item.contactEmail ?? '']));
      sheet.columns.forEach((column) => { column.numFmt = '@'; column.width = 26; });
      const bytes = await workbook.xlsx.writeBuffer();
      if (!alive.current) return;
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const link = document.createElement('a'); link.href = url; link.download = `${t('供应商清单')}-${page}.xlsx`; link.click(); URL.revokeObjectURL(url);
    } catch (cause) { if (alive.current) setError(cause); }
    finally { if (alive.current) setExporting(false); }
  }
  return <section aria-label={t('供应商档案')}>
    {notice ? <Alert type="success" title={t('供应商资料已保存')} /> : null}
    {error ? <Alert type="error" title={t(supplierError(error))} action={granted.includes('supplier-quality:profiles:read') ? <Button onClick={() => void reload()}>{t('重新加载')}</Button> : undefined} /> : null}
    {canRead ? <><Space wrap><Input.Search aria-label={t('搜索供应商资料')} placeholder={t('搜索供应商名称或业务编码')} maxLength={100} allowClear onSearch={(value) => { setSearch(value); setPage(1); }} /><Button loading={loading} onClick={() => void reload()}>{t('重新加载')}</Button><Button loading={exporting} disabled={loading || !data?.items.length} onClick={() => void exportPage()}>{t('导出当前页供应商清单')}</Button></Space>
      <LedgerTable<SupplierProfile> ledgerId="supplier-profiles" organizationId={organizationId} requiredColumnKeys={['businessCode', 'actions']} rowKey="id" loading={loading} dataSource={data?.items ?? []} scroll={{ x: 800 }} pagination={{ current: page, pageSize, total: data?.total ?? 0, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], onChange: (next, size) => { setPage(size === pageSize ? next : 1); setPageSize(size); } }} columns={[
        { key: 'businessCode', title: t('业务编码'), dataIndex: 'businessCode' }, { key: 'displayName', title: t('供应商名称'), dataIndex: 'displayName' }, { key: 'contactName', title: t('联系人'), dataIndex: 'contactName' }, { key: 'contactEmail', title: t('联系邮箱'), dataIndex: 'contactEmail' },
        { key: 'collaboration', title: t('协作边界'), render: (_, row) => t(row.supplierOrganizationId ? '已开通协作' : '未开通协作') },
        { key: 'actions', title: t('操作'), render: (_, profile) => <Space wrap>{canWrite ? <Button onClick={() => { setEditing(profile); setNotice(false); }}>{t('编辑资料')}</Button> : null}<Button onClick={() => setAccounts(profile)}>{t('供应商用户账号')}</Button></Space> },
      ]} /></> : <Alert type="info" title={t('没有供应商档案查看权限')} />}
    {canWrite ? <Space wrap><Button onClick={() => setCreating(true)}>{t('登记供应商资料')}</Button><SupplierMasterImport organizationId={organizationId} onImported={canRead ? () => reload(true) : () => undefined} /></Space> : null}
    {canWrite && creating ? <ProfileCreator organizationId={organizationId} saved={saved} close={() => setCreating(false)} /> : null}
    {editing ? <ProfileEditor key={editing.id} organizationId={organizationId} record={editing} saved={saved} close={() => setEditing(undefined)} /> : null}
    {accounts ? <SupplierUsersPanel key={accounts.id} profile={accounts} organizationId={organizationId} organizationPermissions={granted} onBound={canRead ? reload : () => undefined} onClose={() => setAccounts(undefined)} onDenied={accountDenied} /> : null}
  </section>;
}

function ProfileCreator({ organizationId, saved, close }: { organizationId?: string; saved: () => void; close: () => void }) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [modal, holder] = Modal.useModal();
  function cancel() {
    if (busy) return;
    if (dirty) modal.confirm({ title: t('当前草稿尚未保存，继续将放弃修改。'), okText: t('放弃修改'), cancelText: t('继续编辑'), onOk: close });
    else close();
  }
  return <Modal open title={t('登记供应商资料')} footer={null} onCancel={cancel} closable={!busy} keyboard={!busy} mask={{ closable: false }}>
    {holder}<ProfileForm organizationId={organizationId} saved={saved} busyChanged={setBusy} dirtyChanged={setDirty} />
  </Modal>;
}

function ProfileEditor({ record, organizationId, saved, close }: { record: SupplierProfile; organizationId?: string; saved: () => void; close: () => void }) {
  const { t } = useLanguage();
  const [current, setCurrent] = useState(record);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<unknown>();
  const alive = useRef(true);
  const [modal, holder] = Modal.useModal();
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  function cancel() { if (busy) return; if (dirty) modal.confirm({ title: t('当前草稿尚未保存，继续将放弃修改。'), okText: t('放弃修改'), cancelText: t('继续编辑'), onOk: close }); else close(); }
  async function reload() {
    if (busy) return;
    setBusy(true); setError(undefined);
    try {
      const result = await apiRequest<SupplierProfile>(`${base}/${record.id}${organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : ''}`);
      if (alive.current) setCurrent(result);
    } catch (cause) { if (alive.current) setError(cause); }
    finally { if (alive.current) setBusy(false); }
  }
  return <Modal open title={t('编辑供应商资料')} footer={null} onCancel={cancel} closable={!busy} keyboard={!busy} mask={{ closable: false }}>
    {holder}{error ? <Alert type="error" title={t(supplierError(error))} /> : null}
    <ProfileForm record={current} organizationId={organizationId} saved={saved} busyChanged={setBusy} dirtyChanged={setDirty} disabled={busy} />
    <Space><Popconfirm title={t('重新加载当前版本并保留填写内容，是否继续？')} onConfirm={reload} okText={t('重新加载')} cancelText={t('保留编辑')}><Button disabled={busy}>{t('重新加载资料')}</Button></Popconfirm><Button disabled={busy} onClick={cancel}>{t('取消编辑')}</Button></Space>
  </Modal>;
}

function ProfileForm({ record, organizationId, saved, busyChanged, dirtyChanged, disabled }: { record?: SupplierProfile; organizationId?: string; saved: () => void; busyChanged?: (busy: boolean) => void; dirtyChanged?: (dirty: boolean) => void; disabled?: boolean }) {
  const { t } = useLanguage();
  const [form] = Form.useForm<ProfileInput>();
  const mutate = useRef(createSupplierMutation());
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<unknown>();
  const alive = useRef(true);
  const inFlight = useRef(false);
  useUnsavedChanges(dirty || busy);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setError(undefined); }, [record?.version]);
  async function submit(values: ProfileInput) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); busyChanged?.(true); setError(undefined);
    const content = { ...(organizationId ? { organizationId } : {}), businessCode: values.businessCode.trim(), displayName: values.displayName?.trim(), contactName: values.contactName?.trim() || undefined, contactEmail: values.contactEmail?.trim() || undefined };
    try {
      await mutate.current(`${base}${record ? `/${record.id}` : ''}`, record ? 'PUT' : 'POST', record ? { ...content, expectedVersion: record.version } : content);
      if (!alive.current) return; form.resetFields(); setDirty(false); dirtyChanged?.(false); saved();
    } catch (cause) { if (alive.current) setError(cause); }
    finally { inFlight.current = false; if (alive.current) { setBusy(false); busyChanged?.(false); } }
  }
  return <>
    {error ? <Alert type="error" showIcon title={t(supplierError(error))} description={error instanceof ApiError && error.status === 409 ? t('当前填写内容已保留，请显式重新加载后再编辑。') : undefined} /> : null}
    <Form name={record ? `supplier-profile-edit-${record.id}` : 'supplier-profile-create'} form={form} layout="vertical" initialValues={record} onValuesChange={() => { setDirty(true); dirtyChanged?.(true); }} onFinish={(values: ProfileInput) => void submit(values)} disabled={busy || disabled}>
      <div className="supplier-form-grid">
        <Form.Item name="displayName" label={t('供应商名称')} rules={[{ required: true, whitespace: true, message: t('请填写供应商名称') }]}><Input maxLength={200} /></Form.Item>
        <Form.Item name="businessCode" label={t('业务编码')} rules={[{ required: true, whitespace: true, message: t('请填写业务编码') }]}><Input maxLength={100} /></Form.Item>
        <Form.Item name="contactName" label={t('联系人')}><Input maxLength={100} /></Form.Item>
        <Form.Item name="contactEmail" label={t('联系邮箱')} rules={[{ type: 'email', message: t('请输入有效邮箱') }]}><Input maxLength={254} /></Form.Item>
      </div><Form.Item><Button type="primary" htmlType="submit" loading={busy}>{t(record ? '保存供应商资料' : '登记供应商')}</Button></Form.Item>
    </Form>
  </>;
}
