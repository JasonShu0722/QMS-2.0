import { useState } from 'react';
import { Alert, Button, Form, Input, InputNumber, Modal, Select, Space, Switch } from 'antd';
import type { components } from '@qms/contracts';
import { ApiError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { integrationError, integrationPath, isAborted, useScopedIntegrationRequests, type Endpoint, type IntegrationScope } from './integration-ui';

type Create = components['schemas']['CreateIntegrationEndpointDto'];
type Update = components['schemas']['UpdateIntegrationEndpointDto'];
type FormValues = Omit<Create, 'capacityBytes' | 'allowedIps'> & { capacityMiB: number; allowedIpsText: string; status?: Endpoint['status'] };
const mebibyte = 1048576;

export function EndpointEditor({ scope, endpoint, close, saved }: { scope: IntegrationScope; endpoint?: Endpoint; close: () => void; saved: () => void }) {
  const { locale } = useLanguage();
  const text = (zh: string, en: string) => locale === 'en-US' ? en : zh;
  const requests = useScopedIntegrationRequests(scope);
  const [form] = Form.useForm<FormValues>();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const requestLeave = useNavigationGuard();
  useUnsavedChanges(dirty); useNavigationBusy(busy);
  async function save(values: FormValues) {
    if (busy) return;
    setBusy(true); setError(undefined);
    const mutable = { name: values.name, description: values.description ?? '', returnReceipt: values.returnReceipt,
      maxBodyBytes: values.maxBodyBytes, ratePerMinute: values.ratePerMinute, bodyRetentionDays: values.bodyRetentionDays,
      capacityBytes: values.capacityMiB * mebibyte, allowedIps: values.allowedIpsText.split(/\r?\n/).map(value => value.trim()).filter(Boolean) };
    try {
      if (endpoint) {
        const body: Update = { ...mutable, organizationId: scope.organizationId, status: values.status, expectedVersion: endpoint.version };
        await requests.write<Endpoint>(`${integrationPath}/${endpoint.id}`, 'PATCH', body);
      } else {
        const body: Create = { ...mutable, organizationId: scope.organizationId, code: values.code, sourceCode: values.sourceCode, sourceName: values.sourceName };
        await requests.write<Endpoint>(integrationPath, 'POST', body);
      }
      if (requests.current()) { setDirty(false); saved(); }
    } catch (cause) { if (requests.current() && !isAborted(cause)) setError(cause); }
    finally { if (requests.current()) setBusy(false); }
  }
  const initial: FormValues = { code: endpoint?.code ?? '', name: endpoint?.name ?? '', sourceCode: endpoint?.sourceCode ?? '', sourceName: endpoint?.sourceName ?? '',
    description: endpoint?.description ?? '', returnReceipt: endpoint?.returnReceipt ?? true, maxBodyBytes: endpoint?.maxBodyBytes ?? mebibyte,
    ratePerMinute: endpoint?.ratePerMinute ?? 60, bodyRetentionDays: endpoint?.bodyRetentionDays ?? 7, capacityMiB: (endpoint?.capacityBytes ?? 256 * mebibyte) / mebibyte,
    allowedIpsText: endpoint?.allowedIps.join('\n') ?? '', status: endpoint?.status };
  return <Modal open title={text(endpoint ? '编辑接收接口' : '新增接收接口', endpoint ? 'Edit receiving interface' : 'New receiving interface')} footer={null}
    width={680} destroyOnHidden mask={{ closable: false }} closable={!busy} keyboard={!busy} onCancel={() => { if (!busy) requestLeave(close, true); }}>
    <Form form={form} layout="vertical" initialValues={initial} disabled={busy} onValuesChange={() => setDirty(true)} onFinish={values => void save(values)}>
      <div className="qms-integration-form-grid">
        <Form.Item label={text('接口编码', 'Interface code')} name="code" rules={[{ required: true, whitespace: true }]}><Input disabled={!!endpoint || busy} maxLength={64} /></Form.Item>
        <Form.Item label={text('接口名称', 'Interface name')} name="name" rules={[{ required: true, whitespace: true }]}><Input maxLength={120} /></Form.Item>
        <Form.Item label={text('来源系统编码', 'Source system code')} name="sourceCode" rules={[{ required: true, whitespace: true }]}><Input disabled={!!endpoint || busy} maxLength={64} /></Form.Item>
        <Form.Item label={text('来源系统名称', 'Source system name')} name="sourceName" rules={[{ required: true, whitespace: true }]}><Input disabled={!!endpoint || busy} maxLength={120} /></Form.Item>
      </div>
      <Form.Item label={text('用途说明', 'Description')} name="description"><Input.TextArea maxLength={1000} autoSize={{ minRows: 2, maxRows: 4 }} /></Form.Item>
      <div className="qms-integration-form-grid">
        {endpoint && <Form.Item label={text('接口状态', 'Interface status')} name="status"><Select options={[
          { value: 'DRAFT', label: text('草稿', 'Draft') }, { value: 'ENABLED', label: text('启用', 'Enabled') }, { value: 'DISABLED', label: text('停用', 'Disabled') },
        ]} /></Form.Item>}
        <Form.Item label={text('返回接收回执', 'Return receipt')} name="returnReceipt" valuePropName="checked" extra={text('关闭后成功返回200空正文，接收记录仍保留', 'When off, success returns 200 with an empty body and records remain available')}><Switch aria-label={text('返回接收回执', 'Return receipt')} /></Form.Item>
        <Form.Item label={text('单次请求上限（字节）', 'Maximum request size (bytes)')} name="maxBodyBytes" rules={[{ required: true }]}><InputNumber min={1} max={mebibyte} precision={0} /></Form.Item>
        <Form.Item label={text('每分钟请求上限', 'Requests per minute')} name="ratePerMinute" rules={[{ required: true }]}><InputNumber min={1} max={300} precision={0} /></Form.Item>
        <Form.Item label={text('正文保留天数', 'Payload retention (days)')} name="bodyRetentionDays" rules={[{ required: true }]}><InputNumber min={1} max={30} precision={0} /></Form.Item>
        <Form.Item label={text('正文容量（MiB）', 'Payload capacity (MiB)')} name="capacityMiB" rules={[{ required: true }, { type: 'integer', min: 16, max: 5120 }]}><InputNumber min={16} max={5120} precision={0} /></Form.Item>
      </div>
      <Form.Item label={text('允许来源IP / CIDR', 'Allowed source IP / CIDR')} name="allowedIpsText" extra={text('每行一个；留空不按来源IP限制', 'One per line; leave empty for no source IP restriction')}><Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} maxLength={4096} /></Form.Item>
      {error ? <Alert role="alert" showIcon type="error" title={text(integrationError(error), 'Unable to save. Check the current configuration and retry.')} description={error instanceof ApiError && error.traceId ? <code>{error.traceId}</code> : undefined} /> : null}
      <Space className="qms-integration-actions"><Button onClick={() => requestLeave(close, true)} disabled={busy}>{text('取消', 'Cancel')}</Button><Button type="primary" htmlType="submit" loading={busy}>{text('保存', 'Save')}</Button></Space>
    </Form>
  </Modal>;
}
