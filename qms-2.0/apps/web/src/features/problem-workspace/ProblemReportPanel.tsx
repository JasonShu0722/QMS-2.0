import { useCallback } from 'react';
import { Alert, Button, Spin } from 'antd';
import { useLanguage } from '../../i18n/Language';
import { readReport } from './problem-workspace-api';
import { ProblemError, ProblemEvidence, ProblemNodes, ProblemSections, useProblemRead } from './problem-read';

export function ProblemReportPanel({ problemId, organizationId, instanceId }: { problemId: string; organizationId: string; instanceId?: string }) {
  const { t, locale } = useLanguage();
  const read = useCallback((signal: AbortSignal) => readReport(problemId, organizationId, instanceId, signal), [problemId, organizationId, instanceId]);
  const state = useProblemRead(read, `${problemId}:${organizationId}:${instanceId}`);
  const report = state.data;
  return <section aria-label={t('报告预览')}><ProblemError cause={state.error} /><Button onClick={state.refresh} disabled={state.loading}>{t('刷新报告')}</Button>
    {state.loading ? <Spin aria-label={t('正在加载')} /> : report ? <>
      <h2>{report.problem.reportNumber}</h2><p>{t('生成时间')}：{new Date(report.generatedAt).toLocaleString(locale)}</p>
      {report.dataAvailability !== 'AVAILABLE' ? <Alert type="warning" title={t('历史数据不可用')} description={report.unavailableFields.join(', ')} /> : null}
      {report.revision ? <p>{t('领域修订')}：<code>{report.revision.id}</code> · {t('实例版本')} {report.revision.instanceVersion}</p> : null}
      {report.instance ? <p>{t('固定流程版本')}：<code>{report.instance.workflowVersionId}</code></p> : null}
      {report.summary ? <><h3>{report.summary.title}</h3><p>{report.summary.description}</p></> : null}
      {report.snapshot ? <dl><div><dt>{t('问题类型')}</dt><dd>{report.snapshot.problemType ?? '—'}</dd></div><div><dt>{t('状态')}</dt><dd>{report.snapshot.status ?? '—'}</dd></div><div><dt>{t('严重度')}</dt><dd>{report.snapshot.severity ?? '—'}</dd></div><div><dt>{t('责任方')}</dt><dd>{report.snapshot.responsibleParty ?? '—'}</dd></div><div><dt>{t('负责人')}</dt><dd>{report.snapshot.ownerId ?? '—'}</dd></div><div><dt>{t('截止时间')}</dt><dd>{report.snapshot.dueAt ? new Date(report.snapshot.dueAt).toLocaleString(locale) : '—'}</dd></div></dl> : null}
      <ProblemSections sections={report.sections} /><ProblemNodes nodes={report.nodes} /><ProblemEvidence evidence={report.evidence} />
      <section className="problem-section"><h3>{t('升级记录')}</h3><ul>{report.upgrades.map((entry) => <li key={entry.id}>{entry.reason} · {new Date(entry.createdAt).toLocaleString(locale)} · <code>{entry.beforeDomainRevisionId}</code> → <code>{entry.afterDomainRevisionId}</code></li>)}</ul></section>
    </> : null}
  </section>;
}
