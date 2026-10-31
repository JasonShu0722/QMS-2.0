import type { components } from '@qms/contracts';
import { Alert, Button, Form, Input, Modal, Select } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { ProcessError, useProcessWrite, verificationLabels, type Defect } from './process-ledger';

type Values = components['schemas']['ReopenProcessDefectDto'] & Partial<components['schemas']['VerifyProcessDefectMaterialDto']>;
export function ProcessLedgerAction({ mode, record, materialId, onClose, onSaved, onDenied }: { mode: 'close' | 'reopen' | 'verification'; record: Defect; materialId?: string; onClose: () => void; onSaved: (record: Defect) => void; onDenied: () => void }) {
  const [form] = Form.useForm<Values>();
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<unknown>();
  const writer = useProcessWrite(onDenied);
  const alive = useRef(true);
  const submitting = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const requestLeave = useNavigationGuard();
  useUnsavedChanges(dirty || writer.uncertain);
  useNavigationBusy(writer.busy);
  const title = mode === 'close' ? '确认关闭' : mode === 'reopen' ? '确认恢复跟进' : '保存物料复核';
  async function submit(values: Values) {
    if (submitting.current) return;
    submitting.current = true; setError(undefined);
    try {
      const body = mode === 'verification' ? { expectedVersion: record.version, verification: values.verification!, verificationNotes: values.verificationNotes?.trim() || null } satisfies components['schemas']['VerifyProcessDefectMaterialDto']
        : mode === 'close' ? { expectedVersion: record.version, reason: values.reason?.trim() || null } satisfies components['schemas']['CloseProcessDefectDto']
          : { expectedVersion: record.version, reason: values.reason.trim() } satisfies components['schemas']['ReopenProcessDefectDto'];
      const suffix = mode === 'verification' ? `materials/${materialId}/verification` : mode;
      const result = await writer.write<Defect>(`/api/v1/process-quality/defects/${record.id}/${suffix}`, body);
      if (alive.current) { setDirty(false); onSaved(result); }
    } catch (cause) { if (alive.current) setError(cause); }
    finally { submitting.current = false; }
  }
  return <Modal open title={title} onCancel={() => { if (!writer.busy) requestLeave(onClose, true); }} closable={!writer.busy} keyboard={!writer.busy} mask={{ closable: !writer.busy }} footer={null}>
    <ProcessError cause={error} fallback="操作失败，草稿已保留，请重试。" />
    {writer.uncertain ? <Alert type="warning" title="操作结果未知，仅能使用原请求重试。" /> : null}
    <Form form={form} layout="vertical" disabled={writer.busy || writer.uncertain} onValuesChange={() => setDirty(true)} onFinish={values => void submit(values)}>
      {mode === 'verification' ? <><Form.Item name="verification" label="复核结论" rules={[{ required: true, message: '请明确选择复核结论' }]}><Select options={Object.entries(verificationLabels).filter(([value]) => value !== 'UNREVIEWED').map(([value, label]) => ({ value, label }))} /></Form.Item><Form.Item name="verificationNotes" label="复核说明"><Input.TextArea maxLength={2000} /></Form.Item></> : <Form.Item name="reason" label={mode === 'reopen' ? '恢复原因' : '关闭说明'} rules={mode === 'reopen' ? [{ required: true, whitespace: true, message: '请说明恢复原因' }] : []}><Input.TextArea maxLength={2000} /></Form.Item>}
      <Button htmlType="submit" type="primary" loading={writer.busy} disabled={writer.busy}>{writer.uncertain ? '同请求重试' : title}</Button>
    </Form>
  </Modal>;
}
