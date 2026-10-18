import { Alert, Button, Form, Input, Modal, Space, Table, Typography } from 'antd';
import type { components } from '@qms/contracts';
import { useEffect, useRef, useState } from 'react';
import { apiRequest, ApiError, csrfToken, safeAccountError } from '../../api/client';
import { MaterialMasterImport } from './MaterialMasterImport';
import { useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useLanguage } from '../../i18n/Language';

type Material = components['schemas']['MaterialMasterDto'];
type Create = components['schemas']['CreateMaterialMasterDto'];
type Update = components['schemas']['UpdateMaterialMasterDto'];
type Permissions = components['schemas']['PermissionsResponseDto'];
type Props = { organizationId?: string; organizationPermissions?: string[] };
const base = '/api/v1/material-masters';

export function MaterialMasterPage(props: Props = {}) {
  return <MaterialMasterContent key={props.organizationId ?? 'current'} {...props} />;
}

function MaterialMasterContent({ organizationId, organizationPermissions }: Props) {
  const { t } = useLanguage();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [error, setError] = useState<unknown>();
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [creating, setCreating] = useState(false);
  const [edit, setEdit] = useState<{ item: Material; materialName: string }>();
  const [form] = Form.useForm<Create>();
  const [modal, contextHolder] = Modal.useModal();
  const mounted = useRef(true);
  const sequence = useRef(0);
  const inFlight = useRef(false);
  const pending = useRef<{ signature: string; key: string } | undefined>(undefined);
  const granted = organizationPermissions ?? permissions;
  const canRead = !denied && granted.includes('material-master:read');
  const canWrite = granted.includes('material-master:write');
  const canImport = granted.includes('material-master:import');
  useUnsavedChanges(busy || dirty || Boolean(edit && edit.materialName !== edit.item.materialName));
  const scoped = (path: string) => organizationId ? `${path}?organizationId=${encodeURIComponent(organizationId)}` : path;

  async function refresh(reloadEdit = false, reportFailure = false) {
    const request = ++sequence.current;
    const editedId = reloadEdit ? edit?.item.id : undefined;
    setLoading(true);
    try {
      const result = await apiRequest<Material[]>(scoped(base));
      if (mounted.current && sequence.current === request) {
        setMaterials(result); setError(undefined); setDenied(false);
        if (reloadEdit) {
          setEdit((current) => {
            if (!current || current.item.id !== editedId) return current;
            const item = result.find((row) => row.id === current.item.id);
            return item ? { ...current, item } : undefined;
          });
          pending.current = undefined;
        }
      }
    } catch (cause) {
      if (!mounted.current || sequence.current !== request) return;
      setMaterials([]); setError(cause);
      if (cause instanceof ApiError && [401, 403].includes(cause.status ?? 0)) { setDenied(true); setEdit(undefined); }
      else if (cause instanceof ApiError && cause.status === 404) setEdit(undefined);
      if (reportFailure) throw cause;
    } finally { if (mounted.current && sequence.current === request) setLoading(false); }
  }
  useEffect(() => {
    mounted.current = true;
    if (organizationPermissions) { if (organizationPermissions.includes('material-master:read')) void refresh(); }
    else void apiRequest<Permissions>(scoped('/api/v1/system/my-permissions')).then((result) => {
      if (!mounted.current) return; setPermissions(result.permissions);
      if (result.permissions.includes('material-master:read')) void refresh();
    }, (cause) => { if (mounted.current) { setPermissions([]); setMaterials([]); setError(cause); } });
    return () => { mounted.current = false; sequence.current++; };
  }, []);
  useEffect(() => {
    if (!dirty && (!edit || edit.materialName === edit.item.materialName)) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, edit]);

  async function mutate(path: string, method: 'POST' | 'PATCH', values: Create | Update) {
    const body = { ...values, ...(organizationId ? { organizationId } : {}) };
    const signature = JSON.stringify([path, method, body]);
    if (pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
    const attempt = pending.current;
    await apiRequest<Material>(path, { method, headers: { 'x-csrf-token': await csrfToken(), 'Idempotency-Key': attempt.key }, body: JSON.stringify(body) });
    if (pending.current === attempt) pending.current = undefined;
  }
  async function save(values?: Create) {
    if (!canWrite || inFlight.current || (!values && !edit)) return;
    inFlight.current = true; setBusy(true); setError(undefined);
    try {
      if (values) await mutate(base, 'POST', { materialCode: values.materialCode.trim(), materialName: values.materialName.trim() });
      else if (edit) await mutate(`${base}/${edit.item.id}`, 'PATCH', { materialName: edit.materialName.trim(), expectedVersion: edit.item.version });
      if (!mounted.current) return;
      if (values) { form.resetFields(); setDirty(false); setCreating(false); } else setEdit(undefined);
      if (canRead) await refresh();
    } catch (cause) { if (mounted.current) setError(cause); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  function cancelEdit() {
    if (busy) return;
    if (edit && edit.materialName !== edit.item.materialName) modal.confirm({ title: t('放弃未保存的物料名称？'), okText: t('放弃修改'), cancelText: t('继续编辑'), onOk: () => setEdit(undefined) });
    else setEdit(undefined);
  }
  function cancelCreate() {
    if (busy) return;
    if (dirty) modal.confirm({ title: t('当前草稿尚未保存，继续将放弃修改。'), okText: t('放弃修改'), cancelText: t('继续编辑'), onOk: () => { form.resetFields(); setDirty(false); setCreating(false); } });
    else setCreating(false);
  }
  async function exportCurrent() {
    if (!canRead || loading || exporting || !materials.length) return;
    setExporting(true); setError(undefined);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet(t('物料'));
      sheet.addRow([t('物料编码'), t('物料名称')]);
      materials.forEach((item) => sheet.addRow([item.materialCode, item.materialName]));
      sheet.columns.forEach((column) => { column.width = 30; column.numFmt = '@'; });
      const bytes = await workbook.xlsx.writeBuffer();
      if (!mounted.current) return;
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const link = document.createElement('a'); link.href = url; link.download = `${t('物料清单')}.xlsx`; link.click(); URL.revokeObjectURL(url);
    } catch (cause) { if (mounted.current) setError(cause); }
    finally { if (mounted.current) setExporting(false); }
  }

  return <section className="customer-quality-card" aria-label={t('物料主数据')}>
    {contextHolder}<Typography.Title level={3}>{t('物料主数据')}</Typography.Title>
    <Typography.Paragraph>{t('一期仅维护物料编码和物料名称；编码区分大小写，前导 0 原样保留。')}</Typography.Paragraph>
    {error ? <Alert showIcon type="error" title={t(safeAccountError(error))} action={canRead ? <Button onClick={() => void refresh(true)}>{t('重试')}</Button> : undefined} /> : null}
    {canRead ? <Space wrap><Button onClick={() => void refresh(true)} loading={loading} disabled={busy}>{t('刷新物料')}</Button><Button onClick={() => void exportCurrent()} loading={exporting} disabled={loading || busy || !materials.length}>{t('导出当前物料清单')}</Button></Space> : <Alert type="info" title={t('没有物料查看权限')} />}
    <Space wrap>{canWrite ? <Button onClick={() => setCreating(true)}>{t('新增物料')}</Button> : null}{canImport ? <MaterialMasterImport organizationId={organizationId} onImported={canRead ? () => refresh(false, true) : () => undefined} /> : null}</Space>
    {canWrite ? <Modal title={t('新增物料')} open={creating} footer={null} onCancel={cancelCreate} closable={!busy} keyboard={!busy} mask={{ closable: false }}><Form form={form} layout="vertical" onValuesChange={() => setDirty(true)} onFinish={(values: Create) => void save(values)}>
      <Form.Item name="materialCode" rules={[{ required: true, whitespace: true }]}><Input aria-label={t('物料编码')} placeholder={t('物料编码')} maxLength={100} disabled={busy} /></Form.Item>
      <Form.Item name="materialName" rules={[{ required: true, whitespace: true }]}><Input aria-label={t('物料名称')} placeholder={t('物料名称')} maxLength={200} disabled={busy} /></Form.Item>
      {error ? <Alert showIcon type="error" title={t(safeAccountError(error))} /> : null}
      <Button htmlType="submit" loading={busy}>{t('保存')}</Button>
    </Form></Modal> : null}
    {canRead ? <Table<Material> loading={loading} rowKey="id" size="small" scroll={{ x: true }} dataSource={materials} pagination={{ pageSize: 20 }} columns={[{ title: t('物料编码'), dataIndex: 'materialCode' }, { title: t('物料名称'), dataIndex: 'materialName' }, ...(canWrite ? [{ title: t('操作'), render: (_: unknown, item: Material) => <Button disabled={busy} onClick={() => setEdit({ item, materialName: item.materialName })}>{t('改名')}</Button> }] : [])]} /> : null}
    <Modal title={t('修改物料名称')} open={Boolean(edit)} onCancel={cancelEdit} footer={null} destroyOnHidden>
      <Typography.Paragraph>{edit?.item.materialCode}</Typography.Paragraph>
      <Input aria-label={t('编辑物料名称')} maxLength={200} disabled={busy || loading} value={edit?.materialName ?? ''} onChange={(event) => setEdit((current) => current ? { ...current, materialName: event.target.value } : current)} />
      {error ? <Alert type="error" title={t(safeAccountError(error))} description={error instanceof ApiError && error.code === 'CONCURRENCY_CONFLICT' ? t('物料已更新，请重新加载版本后保存。当前名称草稿会保留。') : undefined} /> : null}
      <Space><Button onClick={cancelEdit} disabled={busy}>{t('取消')}</Button>{canRead ? <Button disabled={busy} loading={loading} onClick={() => void refresh(true)}>{t('重新加载物料版本')}</Button> : null}<Button type="primary" onClick={() => void save()} disabled={!edit?.materialName.trim() || loading} loading={busy}>{t('保存')}</Button></Space>
    </Modal>
  </section>;
}
