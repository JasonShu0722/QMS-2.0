import { StrictMode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, Button, Card, Space } from 'antd';
import type { components as problemBrowserComponents } from '@qms/contracts/testing/problem-browser';
import { App } from '../../src/App';
import { apiRequest, csrfToken, safeAccountError } from '../../src/api/client';
import { AttachmentPanel } from '../../src/features/attachments/AttachmentPanel';
import { ProblemDomainUiProvider, type ProblemDomainUiProps } from '../../src/features/problem-workspace/problem-ui';
import 'antd/dist/reset.css';

type ProcessRequest = problemBrowserComponents['schemas']['NeutralProblemProcessRequestDto'];
type ReviewRequest = problemBrowserComponents['schemas']['NeutralProblemReviewRequestDto'];
type ActionResponse = problemBrowserComponents['schemas']['NeutralProblemProcessResponseDto'];

function NeutralProblemUi({ workspace, refresh }: ProblemDomainUiProps) {
  const [resolution, setResolution] = useState('');
  const [readyFileIds, setReadyFileIds] = useState<string[]>(workspace.evidence.filter((file) => file.downloadable).map((file) => file.id));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const [recorded, setRecorded] = useState<ActionResponse>();
  const [recordedLabel, setRecordedLabel] = useState('中性处理已记录');
  const [reviewNote, setReviewNote] = useState('');
  const processAttempt = useRef<{ key: string; body: ProcessRequest } | undefined>(undefined);
  const reviewAttempt = useRef<{ key: string; path: 'approve' | 'verify'; body: ReviewRequest } | undefined>(undefined);
  const processAction = workspace.actions.find((entry) => entry.actionKey === 'neutral.process');
  const approveAction = workspace.actions.find((entry) => entry.actionKey === 'neutral.approve');
  const verifyAction = workspace.actions.find((entry) => entry.actionKey === 'neutral.verify');
  const selected = workspace.selectedInstance;
  const canSubmit = !!processAction?.enabled && !!selected?.current && !!selected.currentNodeId && !!workspace.domain
    && readyFileIds.length > 0 && !!resolution.trim() && !pending;
  const review = approveAction?.enabled ? { path: 'approve' as const, label: '通过审批', inputLabel: '审批意见' }
    : verifyAction?.enabled ? { path: 'verify' as const, label: '通过验证', inputLabel: '验证意见' } : undefined;
  const canReview = !!review && !!selected?.current && !!selected.currentNodeId && !!workspace.domain && !!reviewNote.trim() && !pending;

  async function submit() {
    if (!canSubmit || !selected?.currentNodeId || !workspace.domain) return;
    if (!processAttempt.current) {
      processAttempt.current = {
        key: crypto.randomUUID(),
        body: {
          instanceId: selected.id,
          workflowVersionId: selected.workflowVersionId,
          currentNodeId: selected.currentNodeId,
          expectedProblemVersion: workspace.problem.version,
          expectedInstanceVersion: selected.version,
          expectedDomainVersion: workspace.domain.domainVersion,
          resolution: resolution.trim(),
          evidenceFileIds: [...readyFileIds].sort(),
        },
      };
    }
    setPending(true); setError(undefined);
    try {
      const token = await csrfToken();
      const response = await apiRequest<ActionResponse>(`/api/v1/test/neutral-problems/${workspace.problem.id}/process?organizationId=${encodeURIComponent(workspace.problem.organizationId)}`, {
        method: 'POST',
        headers: { 'x-csrf-token': token, 'Idempotency-Key': processAttempt.current.key },
        body: JSON.stringify(processAttempt.current.body),
      });
      processAttempt.current = undefined;
      setRecorded(response);
      setRecordedLabel('中性处理已记录');
      refresh();
    } catch (cause) {
      setError(cause);
    } finally {
      setPending(false);
    }
  }

  async function submitReview() {
    if (!canReview || !review || !selected?.currentNodeId || !workspace.domain) return;
    if (!reviewAttempt.current || reviewAttempt.current.path !== review.path) {
      reviewAttempt.current = { key: crypto.randomUUID(), path: review.path, body: {
        instanceId: selected.id,
        workflowVersionId: selected.workflowVersionId,
        currentNodeId: selected.currentNodeId,
        expectedProblemVersion: workspace.problem.version,
        expectedInstanceVersion: selected.version,
        expectedDomainVersion: workspace.domain.domainVersion,
        note: reviewNote.trim(),
      } };
    }
    setPending(true); setError(undefined);
    try {
      const token = await csrfToken();
      const response = await apiRequest<ActionResponse>(`/api/v1/test/neutral-problems/${workspace.problem.id}/${review.path}?organizationId=${encodeURIComponent(workspace.problem.organizationId)}`, {
        method: 'POST', headers: { 'x-csrf-token': token, 'Idempotency-Key': reviewAttempt.current.key },
        body: JSON.stringify(reviewAttempt.current.body),
      });
      reviewAttempt.current = undefined;
      setReviewNote('');
      setRecorded(response);
      setRecordedLabel(review.path === 'approve' ? '中性审批已记录' : '中性验证已记录');
      refresh();
    } catch (cause) { setError(cause); }
    finally { setPending(false); }
  }

  const fileIds = [...new Set([...workspace.evidence.map((file) => file.id), ...readyFileIds])];
  return <Card title="中性测试域处理" aria-label="中性测试域处理">
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      {error ? <Alert role="alert" type="error" title={safeAccountError(error)} /> : null}
      {recorded ? <Alert type="success" title={recordedLabel} description={`revision ${recorded.revisionId} · domain v${recorded.domainVersion}`} /> : null}
      {processAction?.enabled ? <>
        <label>中性处理结论<textarea aria-label="中性处理结论" maxLength={1000} value={resolution} disabled={pending} onChange={(event) => {
          setResolution(event.target.value); processAttempt.current = undefined;
        }} /></label>
        <AttachmentPanel resource={{ resourceType: 'NeutralProblemEvidence', resourceId: workspace.problem.sourceId }} fileIds={fileIds}
          onReady={(file) => setReadyFileIds((current) => current.includes(file.id) ? current : [...current, file.id])}
          onRemoved={(id) => setReadyFileIds((current) => current.filter((entry) => entry !== id))} />
        <Button type="primary" loading={pending} disabled={!canSubmit} onClick={() => { void submit(); }}>记录中性处理结果</Button>
      </> : null}
      {review ? <>
        <label>{review.inputLabel}<textarea aria-label={review.inputLabel} maxLength={1000} value={reviewNote} disabled={pending} onChange={(event) => {
          setReviewNote(event.target.value); reviewAttempt.current = undefined;
        }} /></label>
        <Button type="primary" loading={pending} disabled={!canReview} onClick={() => { void submitReview(); }}>{review.label}</Button>
      </> : null}
    </Space>
  </Card>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><ProblemDomainUiProvider registry={{ 'neutral-browser-test': NeutralProblemUi }}><App /></ProblemDomainUiProvider></StrictMode>,
);
