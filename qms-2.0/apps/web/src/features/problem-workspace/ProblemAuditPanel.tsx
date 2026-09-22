import { useEffect, useState } from 'react';
import { Alert, Button, Spin } from 'antd';
import { useLanguage } from '../../i18n/Language';
import { readProblemAudit, type ProblemAuditPage } from './problem-workspace-api';
import { ProblemError } from './problem-read';

export function ProblemAuditPanel({ problemId, organizationId }: { problemId: string; organizationId: string }) {
  const { t, locale } = useLanguage();
  const [page, setPage] = useState<ProblemAuditPage>();
  const [cursor, setCursor] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(undefined);
    readProblemAudit(problemId, organizationId, cursor, controller.signal).then((result) => {
      if (!controller.signal.aborted) setPage((previous) => ({ ...result, items: cursor ? [...(previous?.items ?? []), ...result.items.filter((item) => !previous?.items.some((entry) => entry.id === item.id))] : result.items }));
    }).catch((cause: unknown) => { if (!controller.signal.aborted) { setError(cause); setPage(undefined); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [problemId, organizationId, cursor, revision]);
  return <section aria-label={t('追溯')}><h2>{t('问题追溯')}</h2><ProblemError cause={error} />
    <Button disabled={loading} onClick={() => { setPage(undefined); setCursor(undefined); setRevision((value) => value + 1); }}>{t('刷新追溯')}</Button>
    {page && !page.domainRevisionTrailAvailable ? <Alert type="info" title={t('领域修订追溯不可用')} /> : null}
    {page ? <ol className="problem-audit">{page.items.map((event) => <li key={event.id}><strong>{event.action}</strong> · {event.outcome}<p>{new Date(event.createdAt).toLocaleString(locale)} · {event.actorName ?? t('系统')}</p><p>{event.resourceType} · <code>{event.resourceId}</code>{event.resourceVersion === null ? null : <> · v{event.resourceVersion}</>}{event.reasonCode ? <> · {event.reasonCode}</> : null}</p></li>)}</ol> : null}
    {page && !page.items.length ? <p>{t('暂无追溯记录')}</p> : null}
    {loading ? <Spin aria-label={t('正在加载')} /> : null}
    {page?.nextCursor ? <Button disabled={loading} onClick={() => setCursor(page.nextCursor!)}>{t('加载更多')}</Button> : null}
  </section>;
}
