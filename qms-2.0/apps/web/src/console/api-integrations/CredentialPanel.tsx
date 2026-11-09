import { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, InputNumber, Modal, Popconfirm, Tag, Typography } from 'antd';
import type { components } from '@qms/contracts';
import { ApiError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { LedgerTable, useLedgerPageSize } from '../../ui/ledger';
import { integrationError, integrationPath, isAborted, useScopedIntegrationRequests, type Credential, type CredentialPage, type Endpoint, type IntegrationScope } from './integration-ui';

type Create = components['schemas']['CreateIntegrationCredentialDto'];

export function CredentialPanel({ scope, endpoint, close, changed }: { scope: IntegrationScope; endpoint: Endpoint; close: () => void; changed: () => void }) {
  const { locale } = useLanguage();
  const text = (zh: string, en: string) => locale === 'en-US' ? en : zh;
  const [pageSize, setPageSize] = useLedgerPageSize('console-integration-credentials', scope.organizationId);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CredentialPage>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<unknown>();
  const [created, setCreated] = useState<Credential>();
  const [form] = Form.useForm<Create>();
  const { read, write, current } = useScopedIntegrationRequests(scope);
  const requestLeave = useNavigationGuard();
  useUnsavedChanges(dirty); useNavigationBusy(busy);
  const canWrite = scope.permissions.includes('integration:manage') && scope.permissions.includes('integration:credentials:manage');
  useEffect(() => {
    let active = true; setLoading(true); setData(undefined);
    void read<CredentialPage>(`${integrationPath}/${endpoint.id}/credentials`, { page: String(page), limit: String(pageSize) }).then(result => {
      if (!active || !current()) return;
      if (!Array.isArray(result.items) || result.items.some(item => item.organizationId !== scope.organizationId || item.endpointId !== endpoint.id) || result.page !== page || result.limit !== pageSize || !Number.isSafeInteger(result.total) || result.total < 0) { scope.deny(); return; }
      setData(result);
    }).catch(cause => { if (active && current() && !isAborted(cause)) setError(cause); }).finally(() => { if (active && current()) setLoading(false); });
    return () => { active = false; };
  }, [endpoint.id, scope.organizationId, read, current, page, pageSize, revision]);
  async function create(values: Create) {
    if (busy || !canWrite) return;
    setBusy(true); setError(undefined); setCreated(undefined);
    try {
      const result = await write<Credential>(`${integrationPath}/${endpoint.id}/credentials`, 'POST', { organizationId: scope.organizationId, name: values.name, validityDays: values.validityDays });
      if (result.organizationId !== scope.organizationId || result.endpointId !== endpoint.id) { scope.deny(); return; }
      if (current()) { setCreated(result); setDirty(false); form.resetFields(); setRevision(value => value + 1); changed(); }
    } catch (cause) { if (current() && !isAborted(cause)) setError(cause); }
    finally { if (current()) setBusy(false); }
  }
  async function revoke(item: Credential) {
    if (busy || !canWrite) return;
    setBusy(true); setError(undefined);
    try {
      await write<Credential>(`${integrationPath}/${endpoint.id}/credentials/${item.id}/revoke`, 'POST', { organizationId: scope.organizationId });
      if (current()) { if (created?.id === item.id) setCreated(undefined); setRevision(value => value + 1); changed(); }
    } catch (cause) { if (current() && !isAborted(cause)) setError(cause); }
    finally { if (current()) setBusy(false); }
  }
  return <Modal open title={text(`${endpoint.name}凭据`, `${endpoint.name} credentials`)} width={820} footer={<Button aria-label={text('关闭', 'Close')} disabled={busy} onClick={() => requestLeave(close, true)}>{text('关闭', 'Close')}</Button>}
    closable={false} mask={{ closable: false }} keyboard={!busy} onCancel={() => { if (!busy) requestLeave(close, true); }} destroyOnHidden>
    <div className="qms-integration-section">
      {error ? <Alert role="alert" showIcon type="error" title={text(integrationError(error), 'Credential operation could not be confirmed. Retry the same request.')} description={error instanceof ApiError ? error.traceId : undefined} /> : null}
      {created && <Alert type={created.secret ? 'success' : 'warning'} showIcon title={text(created.secret ? '请立即保存凭据原文，仅本次显示' : '凭据已创建，但原文无法恢复；请撤销后创建替代凭据', created.secret ? 'Save this credential now. It is shown only once.' : 'The credential exists, but its secret cannot be recovered. Revoke it and create a replacement.')} description={created.secret
        ? <Typography.Paragraph copyable={{ text: created.secret }}><code>{created.secret}</code></Typography.Paragraph>
        : <code>{created.id}</code>} />}
      {canWrite && <Form form={form} layout="vertical" initialValues={{ name: '', validityDays: 90 }} onValuesChange={() => setDirty(true)} onFinish={values => void create(values)} disabled={busy}>
        <div className="qms-integration-form-grid">
          <Form.Item label={text('凭据名称', 'Credential name')} name="name" rules={[{ required: true, whitespace: true }]}><Input maxLength={100} /></Form.Item>
          <Form.Item label={text('有效天数', 'Validity (days)')} name="validityDays" rules={[{ required: true }]}><InputNumber min={1} max={365} precision={0} /></Form.Item>
        </div>
        <Button htmlType="submit" type="primary" loading={busy}>{text('创建凭据', 'Create credential')}</Button>
      </Form>}
      <Button onClick={() => setRevision(value => value + 1)} disabled={busy} loading={loading}>{text('刷新凭据', 'Refresh credentials')}</Button>
      <LedgerTable<Credential> ledgerId="console-integration-credentials" organizationId={scope.organizationId} rowKey="id" size="small" loading={loading} dataSource={data?.items ?? []} scroll={{ x: 620 }}
        pagination={{ current: page, pageSize, total: data?.total ?? 0, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], disabled: busy, onChange: (next, size) => { setPage(size === pageSize ? next : 1); setPageSize(size); } }}
        columns={[
          { key: 'name', title: text('名称', 'Name'), width: 170, render: (_, item) => <>{item.name}<small>{item.id}</small></> },
          { key: 'createdBy', title: text('创建人标识', 'Created by'), width: 170, render: (_, item) => item.createdById ?? text('未记录', 'Not recorded') },
          { key: 'expiresAt', title: text('失效时间', 'Expires'), width: 180, render: (_, item) => <time dateTime={item.expiresAt}>{new Date(item.expiresAt).toLocaleString(locale, { hour12: false })}</time> },
          { key: 'status', title: text('状态', 'Status'), width: 95, render: (_, item) => <Tag>{item.revokedAt ? text('已撤销', 'Revoked') : Date.parse(item.expiresAt) <= Date.now() ? text('已到期', 'Expired') : text('有效', 'Valid')}</Tag> },
          { key: 'actions', title: text('操作', 'Actions'), width: 130, render: (_, item) => canWrite && !item.revokedAt && <Popconfirm title={text('撤销后此凭据立即停止接收，确认撤销？', 'Revoking stops this credential from receiving data. Continue?')}
            onConfirm={() => void revoke(item)} okButtonProps={{ loading: busy }}><Button danger size="small" disabled={busy} aria-label={text(`撤销${item.name}`, `Revoke ${item.name}`)}>{text('撤销', 'Revoke')}</Button></Popconfirm> },
        ]} />
    </div>
  </Modal>;
}
