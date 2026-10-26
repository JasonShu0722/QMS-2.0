import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Space, Tag } from 'antd';
import { ApiError, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import type { ProblemReport } from './problem-workspace-api';
import { attachmentDownload } from '../attachments/attachments';

export function useProblemRead<Value>(read: (signal: AbortSignal) => Promise<Value>, identity: string) {
  const [state, setState] = useState<{ data?: Value; error?: unknown; loading: boolean }>({ loading: true });
  const [revision, setRevision] = useState(0);
  const previousIdentity = useRef(identity);
  const activeRead = useRef<AbortController | undefined>(undefined);
  const revoked = useRef(false);
  const revoke = useCallback(() => {
    revoked.current = true;
    activeRead.current?.abort();
    setState({ loading: false });
  }, []);
  useEffect(() => {
    if (revoked.current) return;
    const controller = new AbortController();
    activeRead.current = controller;
    const sameIdentity = previousIdentity.current === identity;
    previousIdentity.current = identity;
    setState((current) => ({ data: sameIdentity ? current.data : undefined, loading: true }));
    read(controller.signal).then((data) => { if (!controller.signal.aborted) setState({ data, loading: false }); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setState({ error, loading: false }); });
    return () => controller.abort();
  }, [read, identity, revision]);
  return { ...state, revoke, refresh: () => { if (!revoked.current) setRevision((value) => value + 1); } };
}
export function ProblemError({ cause }: { cause: unknown }) {
  const { t } = useLanguage();
  if (!cause) return null;
  const message = cause instanceof ApiError && (cause.status === 409 || cause.code === 'CONCURRENCY_CONFLICT' || cause.code === 'IDEMPOTENCY_REPLAY') ? '记录已变化，请刷新预览后再次确认。'
    : cause instanceof ApiError && cause.code.startsWith('TASK_') ? '任务状态或领取资格已变化，请刷新后重试'
      : cause instanceof ApiError && /^(WORKFLOW_|PROBLEM_|FILE_)/.test(cause.code) ? '当前资源不可操作，请刷新并检查访问资格。' : safeAccountError(cause);
  return <Alert role="alert" type="error" showIcon title={t(message)} description={cause instanceof ApiError && cause.traceId ? <code>{cause.traceId}</code> : undefined} />;
}
export function ProblemSections({ sections }: { sections: ProblemReport['sections'] }) {
  return <>{sections.map((section) => <section className="problem-section" key={section.key}><h3>{section.title}</h3><dl>{section.fields.map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{field.value ?? '—'}</dd></div>)}</dl></section>)}</>;
}
export function ProblemNodes({ nodes }: { nodes: ProblemReport['nodes'] }) {
  const { t } = useLanguage();
  return <section className="problem-section"><h3>{t('流程节点事实')}</h3><ol className="problem-nodes">{nodes.map((node) => <li key={node.id}>
    <strong>{node.name}</strong> <Tag color={node.current ? 'blue' : undefined}>{t(node.current ? '当前节点' : node.visited ? '已访问' : '尚未访问')}</Tag>
    <span>{t('已记录动作')}：{node.actionCount}</span>
  </li>)}</ol></section>;
}
export function ProblemEvidence({ evidence }: { evidence: ProblemReport['evidence'] }) {
  const { t } = useLanguage();
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState<string>();
  async function download(id: string) {
    if (pending) return;
    setPending(id); setError(undefined);
    try {
      const url = await attachmentDownload(id);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.rel = 'noreferrer noopener'; anchor.referrerPolicy = 'no-referrer'; anchor.target = '_blank';
      anchor.click();
    } catch (cause) { setError(cause); }
    finally { setPending(undefined); }
  }
  return <section className="problem-section"><h3>{t('证据附件')}</h3><ProblemError cause={error} />
    {!evidence.length ? <p>{t('暂无关联证据')}</p> : <ul className="problem-evidence">{evidence.map((file) => <li key={file.id}><Space wrap>
      <strong>{file.originalName}</strong><Tag>{t(file.status === 'AVAILABLE' ? '可用' : file.status === 'DELETED' ? '已删除' : '隔离中')}</Tag>
      <span>{file.sizeBytes} B</span><Button disabled={!file.downloadable || !!pending} loading={pending === file.id} onClick={() => { void download(file.id); }}>{t('下载证据')}</Button>
    </Space></li>)}</ul>}
  </section>;
}
