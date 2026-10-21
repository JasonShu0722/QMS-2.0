import type { components } from '@qms/contracts';
import { Alert, Button, Checkbox, Form, Input, Space, Tag, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest, csrfToken, safeAccountError } from '../../api/client';
import { AttachmentPanel } from '../attachments/AttachmentPanel';

import { useNavigationBusy, useUnsavedChanges } from '../../layouts/UnsavedChanges';

type EightD = components['schemas']['CustomerComplaintEightDDto'];
type Content = Omit<EightD, 'complaintId' | 'version' | 'status' | 'approvalLevel' | 'submittedAt' | 'approvedAt'>;
const fields: { key: keyof Content; label: string }[] = [
  { key: 'what', label: 'What · 发生了什么' }, { key: 'why', label: 'Why · 为什么' }, { key: 'where', label: 'Where · 发生地点' },
  { key: 'when', label: 'When · 发生时间' }, { key: 'who', label: 'Who · 涉及人员' }, { key: 'how', label: 'How · 如何发生' }, { key: 'howMuch', label: 'How much · 影响数量' },
  { key: 'containment', label: '围堵措施' }, { key: 'rootCause', label: 'D4 根本原因' }, { key: 'verification', label: 'D6 验证结果' },
  { key: 'preventiveAction', label: 'D7 预防措施' }, { key: 'horizontalDeployment', label: 'D8 水平展开' }, { key: 'lessonsLearned', label: '经验教训' },
];
const checklist = ['SOURCE_CONFIRMED', 'CONTAINMENT_VERIFIED', 'ROOT_CAUSE_VERIFIED', 'PREVENTION_DEPLOYED', 'HORIZONTAL_DEPLOYMENT_RECORDED', 'EVIDENCE_COMPLETE'];

export function CustomerComplaintEightDPanel({ complaintId, canWrite }: { complaintId: string; canWrite: boolean }) {
  const [record, setRecord] = useState<EightD>(); const [error, setError] = useState<string>(); const [busy, setBusy] = useState(false); const [evidenceIds, setEvidenceIds] = useState<string[]>([]); const [checked, setChecked] = useState<string[]>([]); const [approvalNote, setApprovalNote] = useState(''); const [form] = Form.useForm<Content>(); const idempotencyKey = useRef<string | undefined>(undefined);
  const [contentDirty, setContentDirty] = useState(false);
  const submitting = useRef(false);
  useUnsavedChanges(contentDirty || Boolean(approvalNote));
  useNavigationBusy(busy);
  async function load() { try { setRecord(await apiRequest<EightD>(`/api/v1/customer-quality/complaints/${complaintId}/8d`)); } catch (cause) { setError(safeAccountError(cause)); } }
  useEffect(() => { void load(); }, [complaintId]);
  useEffect(() => { if (record) { form.setFieldsValue(record); setChecked(record.archiveChecklist ?? []); setEvidenceIds(record.verificationEvidenceFileIds ?? []); } }, [record]);
  async function mutate(action: 'draft' | 'submit' | 'approve') {
    if (!record || submitting.current) return; submitting.current = true; setBusy(true); setError(undefined);
    try { const token = await csrfToken(); const content = { ...form.getFieldsValue(), verificationEvidenceFileIds: evidenceIds, archiveChecklist: checked }; if (action === 'submit' && checked.length !== checklist.length) { setError('提交前请逐项确认归档检查表'); return; } const body = action === 'approve' ? { expectedVersion: record.version, note: approvalNote.trim() } : { expectedVersion: record.version, content }; idempotencyKey.current ??= crypto.randomUUID(); const result = await apiRequest<EightD>(`/api/v1/customer-quality/complaints/${complaintId}/8d/${action}`, { method: action === 'draft' ? 'PUT' : action === 'approve' ? 'PUT' : 'POST', headers: { 'x-csrf-token': token, 'Idempotency-Key': idempotencyKey.current }, body: JSON.stringify(body) }); idempotencyKey.current = undefined; setRecord(result); form.setFieldsValue(result); if (action === 'approve') setApprovalNote(''); else setContentDirty(false); }
    catch (cause) { setError(cause instanceof ApiError && cause.status === 409 ? '记录已更新，请刷新后重试，当前输入已保留' : safeAccountError(cause)); } finally { submitting.current = false; setBusy(false); }
  }
  return <section aria-label="客诉 8D 详细控制"><Typography.Title level={4}>8D 详细控制</Typography.Title>{error ? <Alert type="error" showIcon title={error} /> : null}{record ? <><Space><Tag>{record.status}</Tag><Tag>审批级别 {record.approvalLevel ?? '由流程节点决定'}</Tag></Space><Form form={form} layout="vertical" onValuesChange={() => setContentDirty(true)}>{fields.map((field) => <Form.Item key={field.key} name={field.key} label={field.label}><Input.TextArea rows={2} maxLength={10000} showCount disabled={!canWrite || busy || record.status !== 'DRAFT'} /></Form.Item>)}<AttachmentPanel resource={{ resourceType: 'CustomerComplaint', resourceId: complaintId }} fileIds={evidenceIds} readOnly={!canWrite || busy || record.status !== 'DRAFT'} onReady={(file) => { setEvidenceIds((current) => [...new Set([...current, file.id])]); setContentDirty(true); }} onRemoved={(id) => { setEvidenceIds((current) => current.filter((item) => item !== id)); setContentDirty(true); }} onFilesChanged={(files) => setEvidenceIds((current) => current.filter((id) => !files.some((file) => file.id === id && (file.status !== 'AVAILABLE' || file.scanStatus !== 'CLEAN'))))} /><Typography.Text strong>归档检查表</Typography.Text><Checkbox.Group options={checklist.map((value) => ({ label: value, value }))} value={checked} onChange={(values) => { setChecked(values as string[]); setContentDirty(true); }} disabled={!canWrite || busy || record.status !== 'DRAFT'} /><div className="qms-dialog-actions" role="group" aria-label="8D 详细控制">{canWrite && record.status === 'DRAFT' ? <><Button loading={busy} onClick={() => void mutate('draft')}>保存 8D 草稿</Button><Button type="primary" loading={busy} onClick={() => void mutate('submit')}>提交分级审批</Button></> : null}{canWrite && record.status === 'SUBMITTED' ? <><Input aria-label="8D 审批意见" disabled={busy} value={approvalNote} onChange={(event) => setApprovalNote(event.target.value)} maxLength={2000} placeholder="填写审批意见" /><Button type="primary" loading={busy} disabled={busy || !approvalNote.trim()} onClick={() => void mutate('approve')}>审批通过</Button></> : null}</div></Form></> : <Typography.Text type="secondary">正在加载 8D 控制...</Typography.Text>}</section>;
}
