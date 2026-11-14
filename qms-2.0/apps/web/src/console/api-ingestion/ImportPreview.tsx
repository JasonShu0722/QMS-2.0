import { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, InputNumber, Modal, Select, Space, Tag } from 'antd';
import type { components } from '@qms/contracts';
import { useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { isAborted, useScopedIntegrationRequests, type IntegrationScope } from '../api-integrations/integration-ui';
import { IngestionError, IngestionFields, ingestionIssue, ingestionPath, label, useIngestionMutation, useIngestionText, type Rule } from './ingestion-ui';

type Preview = components['schemas']['IngestionPreviewDto'];
type Receipt = components['schemas']['IntegrationReceiptDto'];
type Values = { receiptId?: string; row: number; from?: string; to?: string; reprocessReason?: string };
export function ImportPreview({ scope, rule, history, canReceipts, close, viewJobs }: { scope: IntegrationScope; rule: Rule; history: boolean; canReceipts: boolean; close: () => void; viewJobs?: () => void }) {
  const text = useIngestionText(); const english = text('zh', 'en') === 'en';
  const [form] = Form.useForm<Values>(); const requestLeave = useNavigationGuard();
  const { read, current } = useScopedIntegrationRequests(scope);
  const [preview, setPreview] = useState<Preview>(); const [submitted, setSubmitted] = useState<components['schemas']['IngestionImportResultDto']>();
  const [dirty, setDirty] = useState(false); const [expired, setExpired] = useState(false);
  const [receipts, setReceipts] = useState<Receipt[]>([]); const [receiptPage, setReceiptPage] = useState(1); const [receiptTotal, setReceiptTotal] = useState(0);
  const [receiptsLoading, setReceiptsLoading] = useState(false); const [receiptError, setReceiptError] = useState<unknown>(); const [revision, setRevision] = useState(0);
  const previewMutation = useIngestionMutation(scope, { recoverableUnknown: true }); const submitMutation = useIngestionMutation(scope);
  const locked = previewMutation.locked || submitMutation.locked;
  useUnsavedChanges(dirty && !submitted);
  useEffect(() => { setPreview(undefined); setSubmitted(undefined); }, [rule.id, rule.version]);
  useEffect(() => {
    if (history || !canReceipts) return;
    let active = true; setReceiptsLoading(true); setReceiptError(undefined);
    void read<components['schemas']['IntegrationReceiptPageDto']>('/api/v1/admin/integrations/receipts', { endpointId: rule.endpointId, page: String(receiptPage), limit: '20' }).then(result => {
      if (!active || !current()) return;
      if (!Array.isArray(result.items) || result.items.some(item => item.organizationId !== scope.organizationId || item.endpointId !== rule.endpointId) || result.page !== receiptPage || result.limit !== 20 || !Number.isSafeInteger(result.total) || result.total < 0) { scope.deny(); return; }
      setReceipts(previous => receiptPage === 1 ? result.items : [...previous.filter(item => !result.items.some(next => next.id === item.id)), ...result.items]); setReceiptTotal(result.total);
    }).catch(cause => { if (active && current() && !isAborted(cause)) setReceiptError(cause); }).finally(() => { if (active && current()) setReceiptsLoading(false); });
    return () => { active = false; };
  }, [read, current, scope.deny, scope.organizationId, rule.endpointId, history, canReceipts, receiptPage, revision]);
  useEffect(() => {
    if (!preview) { setExpired(false); return; }
    const remaining = new Date(preview.expiresAt).getTime() - Date.now();
    setExpired(remaining <= 0);
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => setExpired(true), Math.min(remaining, 2147483647));
    return () => window.clearTimeout(timer);
  }, [preview]);
  function generate(values: Values) {
    if (locked || submitted || !canReceipts) return;
    setPreview(undefined);
    if (history) {
      const body: components['schemas']['IngestionHistoryPreviewInputDto'] = { organizationId: scope.organizationId, ruleId: rule.id, ruleVersion: rule.version, from: new Date(values.from!).toISOString(), to: new Date(values.to!).toISOString() };
      void previewMutation.execute<Preview>({ path: `${ingestionPath}/imports/preview`, method: 'POST', body }, setPreview);
    } else {
      const body: components['schemas']['IngestionPreviewInputDto'] = { organizationId: scope.organizationId, ruleId: rule.id, ruleVersion: rule.version, receiptId: values.receiptId!, rowIndex: values.row - 1 };
      void previewMutation.execute<Preview>({ path: `${ingestionPath}/preview`, method: 'POST', body }, setPreview);
    }
  }
  function submit() {
    if (!preview || locked || submitted || !canReceipts || new Date(preview.expiresAt).getTime() <= Date.now()) return;
    const reason = form.getFieldValue('reprocessReason')?.trim();
    const body: components['schemas']['SubmitIngestionImportDto'] = { organizationId: scope.organizationId, previewId: preview.previewId, confirmed: true, ...(reason ? { reprocessReason: reason } : {}) };
    void submitMutation.execute<components['schemas']['IngestionImportResultDto']>({ path: `${ingestionPath}/imports`, method: 'POST', body }, result => { setDirty(false); setSubmitted(result); setPreview(undefined); });
  }
  return <Modal open title={`${text(history ? '历史批量导入' : '单条试处理', history ? 'Historical import' : 'Single preview')} · ${rule.name}`} width={760} footer={null} destroyOnHidden mask={{ closable: false }} closable={!locked} keyboard={!locked} onCancel={() => { if (!locked) requestLeave(close, true); }}>
    <Form className="qms-ingestion-form" form={form} layout="vertical" initialValues={{ row: 1 }} disabled={locked || !!submitted} onFinish={generate} onValuesChange={changed => { setDirty(true); if (!Object.hasOwn(changed, 'reprocessReason')) setPreview(undefined); }}>
      {history ? <div className="qms-ingestion-grid">
        <Form.Item name="from" label={text('接收时间起', 'Received from')} rules={[{ required: true }, { validator: async (_, value) => { if (value && !Number.isFinite(new Date(value).getTime())) throw new Error(text('请选择有效时间', 'Choose a valid date')); } }]}><Input type="datetime-local" /></Form.Item>
        <Form.Item name="to" label={text('接收时间止', 'Received to')} dependencies={['from']} rules={[{ required: true }, { validator: async (_, value) => { if (value && (!Number.isFinite(new Date(value).getTime()) || new Date(value) <= new Date(form.getFieldValue('from')))) throw new Error(text('截止时间须晚于开始时间', 'End time must follow the start')); if (value && new Date(value).getTime() > Date.now()) throw new Error(text('截止时间不能晚于当前时间', 'End time cannot be in the future')); } }]}><Input type="datetime-local" /></Form.Item>
      </div> : <>
        {!canReceipts && <Alert type="warning" showIcon title={text('需要接收记录查看权限', 'Receiving record permission is required')} />}
        <Form.Item name="receiptId" label={text('接收记录', 'Receiving record')} rules={[{ required: true }]}><Select showSearch optionFilterProp="label" loading={receiptsLoading} disabled={locked || !canReceipts || !!submitted} options={receipts.map(receipt => ({ value: receipt.id, label: `${new Date(receipt.receivedAt).toLocaleString(english ? 'en-US' : 'zh-CN')} / ${receipt.messageId}${receipt.bodyAvailable ? '' : text('（正文已清理）', ' (payload expired)')}`, disabled: !receipt.bodyAvailable }))} /></Form.Item>
        <Space wrap>{receipts.length < receiptTotal && <Button disabled={locked || !!submitted} loading={receiptsLoading} onClick={() => setReceiptPage(value => value + 1)}>{text('加载更多接收记录', 'Load more receiving records')}</Button>}{!!receiptError && <Button disabled={locked} onClick={() => setRevision(value => value + 1)}>{text('重试加载记录', 'Retry receiving records')}</Button>}</Space>
        <IngestionError error={receiptError} />
        <Form.Item name="row" label={text('数组行号', 'Array row')} rules={[{ required: true }, { type: 'integer', min: 1, max: 10000 }]}><InputNumber min={1} max={10000} precision={0} /></Form.Item>
      </>}
      {!submitted && <Form.Item name="reprocessReason" label={text('重新处理原因（仅需另建处理记录时填写）', 'Reprocessing reason (only when creating a new processing record)')}><Input.TextArea maxLength={300} autoSize={{ minRows: 1, maxRows: 3 }} /></Form.Item>}
      <IngestionError error={previewMutation.error} unknown={previewMutation.unknown} />
      {!submitted && <Space className="qms-ingestion-actions"><Button type="primary" htmlType="submit" loading={previewMutation.busy} disabled={submitMutation.locked || !canReceipts}>{text('生成预览', 'Generate preview')}</Button></Space>}
    </Form>
    {preview && <div className="qms-ingestion-section qms-ingestion-actions" role="region" aria-label={text('入库预览', 'Ingestion preview')}>
      <div className="qms-ingestion-counts"><span>{text('接收份数', 'Receiving records')}: {preview.receiptCount}</span><span>{text('数据条数', 'Rows')}: {preview.rowCount}</span>{preview.action && <Tag>{label(preview.action, english)}</Tag>}</div>
      <span className="qms-ingestion-secondary">{text('预览有效期至', 'Preview expires at')} {new Date(preview.expiresAt).toLocaleString(english ? 'en-US' : 'zh-CN')}</span>
      {preview.errorCode && <Alert type="warning" showIcon title={text('该行未通过校验', 'This row did not pass validation')} description={<>{ingestionIssue(preview.errorCode, english)}{preview.errorField && <div className="qms-ingestion-secondary">{text('字段', 'Field')}: <code>{preview.errorField}</code></div>}</>} />}
      <IngestionFields fields={preview.fields} differences={preview.differences} />
      {expired && <Alert type="warning" title={text('预览已过期，请重新生成', 'Preview expired. Generate a new preview.')} />}
      {!submitMutation.unknown && <Button type="primary" disabled={locked || expired || preview.rowCount === 0 || preview.action === 'VALIDATION_FAILED'} loading={submitMutation.busy} onClick={submit}>{text('确认导入', 'Confirm import')}</Button>}
    </div>}
    <IngestionError error={submitMutation.error} unknown={submitMutation.unknown} unknownTitle={text('导入结果未确认，可能已经提交。请重试原请求，或查看处理任务核对；核对前请勿重新导入。', 'The import outcome is unknown and may have been submitted. Retry the original request or check processing jobs. Do not start another import before checking.')} />
    {submitMutation.unknown && <><Button className="qms-ingestion-actions" type="primary" loading={submitMutation.busy} onClick={submitMutation.retry}>{text('重试原请求', 'Retry original request')}</Button>{viewJobs && <Button className="qms-ingestion-actions" disabled={submitMutation.busy} onClick={viewJobs}>{text('关闭并查看处理任务', 'Close and view processing jobs')}</Button>}</>}
    {submitted && <Alert role="status" className="qms-ingestion-actions" type="success" showIcon title={submitted.reused ? text('已复用原处理任务', 'Existing processing jobs reused') : text('已提交处理任务', 'Processing jobs submitted')} description={<><div>{text('任务数', 'Jobs')}: {submitted.jobIds.length} · {text('数据条数', 'Rows')}: {submitted.rowCount}</div>{viewJobs && <Button type="link" onClick={viewJobs}>{text('查看处理任务', 'View processing jobs')}</Button>}</>} />}
    <Button className="qms-ingestion-actions" disabled={locked} onClick={() => requestLeave(close, true)}>{text('关闭', 'Close')}</Button>
  </Modal>;
}
