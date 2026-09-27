import { Alert, Button, Form, Input, InputNumber, Modal, Select, Switch } from 'antd';
import { useEffect, useState } from 'react';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, csrfToken, safeAccountError } from '../../api/client';

type Customer = components['schemas']['CustomerMasterDto'];
type CreateComplaint = components['schemas']['CreateComplaintDto'];
type Complaint = components['schemas']['CustomerComplaintDto'];
type FormValues = Omit<CreateComplaint, 'severitySnapshot' | 'purchaseDate'> & { severitySnapshotText: string; purchaseDate?: string };

export function CustomerComplaintEntry({ onCreated }: { onCreated: (id: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [form] = Form.useForm<FormValues>();
  const complaintType = Form.useWatch('complaintType', form);

  useEffect(() => {
    if (!open) return;
    let active = true;
    apiRequest<Customer[]>('/api/v1/customer-quality/customers')
      .then((result) => { if (active) setCustomers(result.filter((customer) => customer.active)); })
      .catch((cause) => { if (active) setError(cause); });
    return () => { active = false; };
  }, [open]);

  async function save(values: FormValues) {
    setBusy(true); setError(undefined);
    try {
      const parsed: unknown = JSON.parse(values.severitySnapshotText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('严重度策略快照必须是 JSON 对象');
      const { severitySnapshotText: _snapshotText, ...rest } = values;
      const body: CreateComplaint = { ...rest, severitySnapshot: parsed as CreateComplaint['severitySnapshot'] };
      const created = await apiRequest<Complaint>('/api/v1/customer-quality/complaints', {
        method: 'POST', headers: { 'x-csrf-token': await csrfToken(), 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body),
      });
      setOpen(false); form.resetFields(); await onCreated(created.id);
    } catch (cause) { setError(cause); }
    finally { setBusy(false); }
  }

  return <>
    <Button type="primary" onClick={() => { setError(undefined); setOpen(true); }}>人工登记客诉</Button>
    <Modal open={open} title="人工登记客诉" width={720} okText="登记" onOk={() => void form.submit()} okButtonProps={{ loading: busy }} cancelButtonProps={{ disabled: busy }} onCancel={() => { if (!busy) setOpen(false); }}>
      {error ? <Alert type="error" showIcon title={error instanceof ApiError ? safeAccountError(error) : error instanceof Error ? error.message : '登记失败'} /> : null}
      <Form form={form} layout="vertical" onFinish={(values) => void save(values)} initialValues={{ complaintType: 'ZERO_KM', severity: 'LOW', returnRequired: false, physicalAnalysisRequired: false }}>
        <Form.Item name="customerId" label="客户" rules={[{ required: true, message: '请选择客户' }]}><Select aria-label="登记客户" showSearch optionFilterProp="label" options={customers.map((customer) => ({ value: customer.id, label: `${customer.code} · ${customer.name}` }))} /></Form.Item>
        <Form.Item name="complaintType" label="客诉类型" rules={[{ required: true }]}><Select aria-label="客诉类型" options={[{ value: 'ZERO_KM', label: '0KM' }, { value: 'AFTER_SALES', label: '售后' }]} /></Form.Item>
        <Form.Item name="defectDescription" label="不良描述" rules={[{ required: true }]}><Input.TextArea aria-label="不良描述" rows={3} maxLength={10000} /></Form.Item>
        <Form.Item name="productCode" label="产品代码"><Input aria-label="产品代码" maxLength={100} /></Form.Item>
        {complaintType === 'AFTER_SALES' ? <>
          <Form.Item name="vin" label="VIN"><Input aria-label="VIN" maxLength={100} /></Form.Item>
          <Form.Item name="mileage" label="里程"><InputNumber aria-label="里程" min={0} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="purchaseDate" label="购车日期"><Input aria-label="购车日期" type="date" /></Form.Item>
        </> : null}
        <Form.Item name="severity" label="严重度" rules={[{ required: true }]}><Select aria-label="严重度" options={['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((value) => ({ value, label: value }))} /></Form.Item>
        <Form.Item name="severityPolicyVersion" label="严重度策略版本" rules={[{ required: true }]}><Input aria-label="严重度策略版本" maxLength={100} /></Form.Item>
        <Form.Item name="severitySnapshotText" label="严重度策略快照 JSON" rules={[{ required: true }]}><Input.TextArea aria-label="严重度策略快照 JSON" rows={2} placeholder='{"level":"LOW","policyVersion":"v1"}' /></Form.Item>
        <Form.Item name="returnRequired" label="需要退件" valuePropName="checked"><Switch aria-label="需要退件" /></Form.Item>
        <Form.Item name="physicalAnalysisRequired" label="需要实物解析" valuePropName="checked"><Switch aria-label="需要实物解析" /></Form.Item>
      </Form>
    </Modal>
  </>;
}
