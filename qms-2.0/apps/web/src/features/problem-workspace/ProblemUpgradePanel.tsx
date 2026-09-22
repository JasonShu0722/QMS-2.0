import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Space, Spin } from 'antd';
import { ApiError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { previewUpgrade, submitUpgrade, type UpgradeRequest } from './problem-workspace-api';
import { ProblemError, useProblemRead } from './problem-read';

export function ProblemUpgradePanel({ problemId, organizationId, onSuccess, onClose }: { problemId: string; organizationId: string; onSuccess: () => void; onClose: () => void }) {
  const { t } = useLanguage();
  const read = useCallback((signal: AbortSignal) => previewUpgrade(problemId, organizationId, signal), [problemId, organizationId]);
  const state = useProblemRead(read, `${problemId}:${organizationId}`);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [denied, setDenied] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const writing = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const attempt = useRef<{ body: UpgradeRequest; key: string } | undefined>(undefined);
  const preview = state.data;
  async function upgrade() {
    if (writing.current || !preview?.canUpgrade || !preview.instanceId || !preview.currentNodeId || preview.expectedInstanceVersion === null || preview.expectedDomainVersion === null || !reason.trim() || conflict || denied) return;
    if (!attempt.current) attempt.current = { key: crypto.randomUUID(), body: { organizationId, instanceId: preview.instanceId, currentNodeId: preview.currentNodeId, expectedProblemVersion: preview.expectedProblemVersion, expectedInstanceVersion: preview.expectedInstanceVersion, expectedDomainVersion: preview.expectedDomainVersion, reason: reason.trim() } };
    writing.current = true; setPending(true); setError(undefined);
    try { await submitUpgrade(problemId, attempt.current.body, attempt.current.key); if (active.current) onSuccess(); }
    catch (cause) {
      if (!active.current) return;
      setError(cause);
      const definitive = cause instanceof ApiError && (cause.status === undefined || cause.status < 500);
      if (cause instanceof ApiError) {
        setConflict(definitive);
        setDenied(cause.status === 401 || cause.status === 403 || /(?:DENIED|SESSION|DISABLED)/.test(cause.code));
      }
      setUncertain(!definitive);
    } finally { writing.current = false; if (active.current) setPending(false); }
  }
  const mappingLabel = { COPIED: '复制', PRESERVED: '保留已有值', UNMAPPED: '未映射' };
  return <section className="problem-upgrade" aria-label={t('升级预览')}><h2>{t('升级预览')}</h2><ProblemError cause={state.error ?? error} />
    {state.loading ? <Spin aria-label={t('正在加载')} /> : preview ? <>
      {!preview.canUpgrade ? <Alert type="warning" title={t('当前问题不可升级')} description={preview.reasonCode} /> : null}
      <p>{t('报告编号保持不变')}：{preview.reportNumber}</p><p>{t('目标问题类型')}：{preview.targetProblemType ?? '—'}</p>
      <p>{t('固定目标流程')}：<code>{preview.targetVersionId ?? '—'}</code> · {t('映射版本')} {preview.mappingVersion ?? '—'}</p>
      <ul>{preview.mappingSummary.map((entry) => <li key={entry.fieldId}>{entry.fieldId}：{t(mappingLabel[entry.outcome])}</li>)}</ul>
      <label>{t('升级原因')}<textarea aria-label={t('升级原因')} maxLength={1000} value={reason} disabled={pending || uncertain || denied} onChange={(event) => setReason(event.target.value)} /></label>
      {uncertain && !conflict && !denied ? <p>{t('结果尚未确认，重试将复用本次请求。')}</p> : null}
      <Button type="primary" loading={pending} disabled={!preview.canUpgrade || !reason.trim() || conflict || denied} onClick={() => { void upgrade(); }}>{t('确认升级')}</Button>
    </> : null}
    <Space><Button disabled={pending || denied} onClick={() => { setError(undefined); setConflict(false); setUncertain(false); attempt.current = undefined; state.refresh(); }}>{t('刷新预览')}</Button><Button disabled={pending} onClick={onClose}>{t('关闭')}</Button></Space>
  </section>;
}
