import { Alert, Button, Input, Select, Space, Spin, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, csrfToken, safeAccountError } from '../../api/client';
import { AttachmentPanel } from '../attachments/AttachmentPanel';
import { CustomerComplaintEightDPanel } from './CustomerComplaintEightDPanel';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';

type Complaint = components['schemas']['CustomerComplaintDetailDto'];
type Event = components['schemas']['CustomerComplaintEventDto'];
type Assignees = components['schemas']['CustomerComplaintAssigneesDto'];
type Problem = components['schemas']['CustomerIssueProblemDto'];
type Category = components['schemas']['TriageCustomerComplaintDto']['category'];
type Attachment = components['schemas']['FileDto'];

const categories: { value: Category; label: string }[] = [
  { value: 'PRODUCT_QUALITY', label: '产品质量' },
  { value: 'DELIVERY', label: '交付' },
  { value: 'SERVICE', label: '服务' },
  { value: 'OTHER', label: '其他' },
];

export function CustomerComplaintProcessing({ complaint, canWrite, refresh }: { complaint: Complaint; canWrite: boolean; refresh: () => Promise<void> }) {
  const [events, setEvents] = useState<Event[]>([]);
  const [assignees, setAssignees] = useState<Assignees>();
  const [problems, setProblems] = useState<Problem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [category, setCategory] = useState<Category>((complaint.category as Category | null) ?? 'PRODUCT_QUALITY');
  const [categoryNote, setCategoryNote] = useState<string>(String(complaint.category_note ?? ''));
  const [departmentId, setDepartmentId] = useState<string>(String(complaint.responsible_department_id ?? ''));
  const [ownerId, setOwnerId] = useState<string>(String(complaint.owner_user_id ?? ''));
  const [note, setNote] = useState('');
  const [readyFileId, setReadyFileId] = useState<string>();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const requestLeave = useNavigationGuard();
  const serverAssignment = JSON.stringify([(complaint.category as Category | null) ?? 'PRODUCT_QUALITY', String(complaint.category_note ?? ''), String(complaint.responsible_department_id ?? ''), String(complaint.owner_user_id ?? '')]);
  const assignment = JSON.stringify([category, categoryNote, departmentId, ownerId]);
  const [savedAssignment, setSavedAssignment] = useState(serverAssignment);
  const assignmentDirty = assignment !== savedAssignment;
  useEffect(() => { setSavedAssignment(serverAssignment); }, [serverAssignment]);
  useUnsavedChanges(canWrite && (assignmentDirty || Boolean(note) || Boolean(readyFileId)));
  useNavigationBusy(busy);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setEvents([]);
    setProblems([]);
    setAssignees(undefined);
    setAttachments([]);
    setError(undefined);
    Promise.all([
      apiRequest<Event[]>(`/api/v1/customer-quality/complaints/${complaint.id}/events`),
      apiRequest<Problem[]>(`/api/v1/customer-quality/complaints/${complaint.id}/issues`),
      canWrite ? apiRequest<Assignees>('/api/v1/customer-quality/complaints/assignees') : Promise.resolve(undefined),
      apiRequest<Attachment[]>(`/api/v1/customer-quality/complaints/${complaint.id}/attachments`),
    ]).then(([history, linkedProblems, people, files]) => {
      if (active) { setEvents(history); setProblems(linkedProblems); setAssignees(people); setAttachments(files); }
    }).catch((cause) => { if (active) setError(cause); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [complaint.id, complaint.version, canWrite]);

  async function mutate(action: 'triage' | 'progress' | 'resolve' | 'close' | 'reopen' | 'archive') {
    if (busy) return;
    if (!note.trim() && action !== 'archive') return;
    const body = action === 'triage' ? {
      expectedVersion: complaint.version, category, categoryNote: category === 'OTHER' ? categoryNote.trim() : undefined,
      responsibleDepartmentId: departmentId, ownerUserId: ownerId, note: note.trim(),
    } : action === 'resolve' ? { expectedVersion: complaint.version, resolutionSummary: note.trim() }
      : action === 'archive' ? { expectedVersion: complaint.version }
        : { expectedVersion: complaint.version, note: note.trim(), ...(action === 'progress' && readyFileId ? { evidenceFileObjectId: readyFileId } : {}) };
    setBusy(true); setError(undefined);
    try {
      await apiRequest(`/api/v1/customer-quality/complaints/${complaint.id}/${action}`, {
        method: action === 'progress' ? 'POST' : 'PUT',
        headers: { 'x-csrf-token': await csrfToken(), 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      setNote('');
      if (action === 'triage') setSavedAssignment(assignment);
      if (action === 'progress') setReadyFileId(undefined);
      await refresh();
    } catch (cause) {
      setError(cause);
      if (cause instanceof ApiError && cause.status === 403) await refresh();
    } finally { setBusy(false); }
  }

  return <section aria-label="客诉处理">
    <Typography.Title level={4}>处理与关闭</Typography.Title>
    <Space wrap><Tag>{complaint.status}</Tag><Typography.Text>分类：{categories.find((item) => item.value === String(complaint.category))?.label ?? '未分诊'}</Typography.Text><Typography.Text>责任部门：{assignees?.departments?.find((item) => item.id === departmentId)?.name ?? (departmentId || '未分配')}</Typography.Text></Space>
    {error ? <Alert type={error instanceof ApiError && error.status === 403 ? 'warning' : 'error'} showIcon title={error instanceof ApiError ? safeAccountError(error) : '处理资料加载失败，请重试'} action={<Button disabled={busy} onClick={() => requestLeave(() => void refresh())}>刷新</Button>} /> : null}
    {canWrite && !loading && ['OPEN', 'IN_ANALYSIS'].includes(complaint.status) ? <Space orientation="vertical" style={{ width: '100%' }}>
      <Select disabled={busy} aria-label="业务分类" value={category} options={categories} onChange={setCategory} />
      {category === 'OTHER' ? <Input disabled={busy} aria-label="其他分类说明" value={categoryNote} onChange={(event) => setCategoryNote(event.target.value)} maxLength={200} /> : null}
      <Select disabled={busy} aria-label="责任部门" placeholder="选择责任部门" value={departmentId || undefined} options={assignees?.departments?.map((item) => ({ value: item.id, label: item.name })) ?? []} onChange={setDepartmentId} />
      <Select disabled={busy} aria-label="经办人" placeholder="选择经办人" value={ownerId || undefined} options={assignees?.users?.map((item) => ({ value: item.id, label: item.username })) ?? []} onChange={setOwnerId} />
    </Space> : null}
    <AttachmentPanel resource={{ resourceType: 'CustomerComplaint', resourceId: complaint.id }} fileIds={[...attachments.map((file) => file.id), ...events.flatMap((event) => event.evidence_file_object_id ? [event.evidence_file_object_id] : [])]} readOnly={!canWrite || complaint.status !== 'IN_ANALYSIS' || busy || loading} onFilesChanged={(files) => setAttachments((current) => files.reduce((next, file) => [...next.filter((item) => item.id !== file.id), file], current))} onReady={(file) => { setAttachments((current) => [...current.filter((item) => item.id !== file.id), file]); setReadyFileId((current) => current ?? file.id); }} onRemoved={(id) => { setAttachments((current) => current.filter((item) => item.id !== id)); setReadyFileId((current) => current === id ? undefined : current); }} />
    {canWrite && !['ARCHIVED'].includes(complaint.status) ? <Space orientation="vertical" style={{ width: '100%' }}>
      {complaint.status === 'IN_ANALYSIS' ? <><Select aria-label="进展附件证据" placeholder="选择一份扫描通过的附件（可选）" allowClear value={readyFileId} disabled={busy || loading} options={attachments.filter((file) => file.status === 'AVAILABLE' && file.scanStatus === 'CLEAN').map((file) => ({ value: file.id, label: file.originalName }))} onChange={setReadyFileId} /><Typography.Text type="secondary">每条进展可绑定一份附件；其他附件保留，可在刷新后继续选择。</Typography.Text></> : null}
      <Input.TextArea disabled={busy} aria-label="处理说明" value={note} onChange={(event) => setNote(event.target.value)} maxLength={10000} rows={3} />
      <div className="qms-dialog-actions" role="group" aria-label="处理与关闭">
        {['OPEN', 'IN_ANALYSIS'].includes(complaint.status) ? <Button disabled={!note.trim() || !departmentId || !ownerId || category === 'OTHER' && !categoryNote.trim() || busy || loading} onClick={() => void mutate('triage')}>分诊或改派</Button> : null}
        {complaint.status === 'IN_ANALYSIS' ? <><Button disabled={!note.trim() || busy} onClick={() => void mutate('progress')}>记录进展</Button><Button type="primary" disabled={!note.trim() || busy} onClick={() => void mutate('resolve')}>标记解决</Button></> : null}
        {complaint.status === 'RESOLVED' ? <Button type="primary" disabled={!note.trim() || busy} onClick={() => void mutate('close')}>复核关闭</Button> : null}
        {['RESOLVED', 'CLOSED'].includes(complaint.status) ? <Button disabled={!note.trim() || busy} onClick={() => void mutate('reopen')}>重新打开</Button> : null}
        {complaint.status === 'CLOSED' ? <Button disabled={busy} onClick={() => void mutate('archive')}>归档</Button> : null}
      </div>
    </Space> : null}
    <Typography.Title level={5}>处理时间线</Typography.Title>
    {loading ? <Spin /> : events.length ? <ol>{events.map((event) => <li key={event.id}>{event.seq}. {event.event_type} · {event.note}{event.evidence_file_object_id ? ' · 附件证据' : null}</li>)}</ol> : <Typography.Text type="secondary">暂无处理记录</Typography.Text>}
    <Typography.Title level={5}>关联正式问题</Typography.Title>
    {problems.length ? <ul>{problems.map((problem) => <li key={problem.id}><a href={`/app/problem-workspace/${problem.id}?organizationId=${encodeURIComponent(String(complaint.organization_id))}`}>{problem.reportNumber}</a></li>)}</ul> : <Typography.Text type="secondary">暂无正式问题</Typography.Text>}
    {problems.some((problem) => problem.workflowInstanceId) ? <CustomerComplaintEightDPanel complaintId={complaint.id} canWrite={canWrite} /> : null}
  </section>;
}
