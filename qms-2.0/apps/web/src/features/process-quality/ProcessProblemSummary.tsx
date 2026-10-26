import type { components } from '@qms/contracts';
import { Tag } from 'antd';
import { useLanguage } from '../../i18n/Language';
import './process-quality.css';

export function processSummaryValue(summary: components['schemas']['ProblemDomainSummaryDto'], key: string) {
  return summary.fields?.find(field => field.key === key)?.value ?? null;
}

export function ProcessProblemTitle({ summary }: { summary: components['schemas']['ProblemDomainSummaryDto'] }) {
  const characters = Array.from(summary.description);
  const excerpt = characters.length > 200 ? `${characters.slice(0, 200).join('')}…` : summary.description;
  return <span className="process-quality-problem-title" title={summary.description}>{excerpt || '—'}</span>;
}

export function ProcessProblemDeadlines({ problem }: { problem: components['schemas']['ProblemIndexResponseDto'] }) {
  const { t, locale } = useLanguage();
  const closed = problem.status === 'CLOSED' || problem.status === 'ARCHIVED';
  const deadlines = [
    { key: 'analysisDueAt', label: '分析期限' },
    { key: 'submissionDueAt', label: '完整提交期限' },
    { key: 'closureDueAt', label: '关闭期限' },
  ];
  const analysis = problem.summary.fields?.find(field => field.key === 'analysisCompletedAt');
  const submission = problem.summary.fields?.find(field => field.key === 'submittedAt');
  const current = closed || !analysis || !submission ? undefined : deadlines[submission.value ? 2 : analysis.value ? 1 : 0];
  function dateFor(key: string) {
    const value = processSummaryValue(problem.summary, key);
    const date = value ? new Date(value) : undefined;
    return date && Number.isFinite(date.getTime()) ? date : undefined;
  }
  const currentDate = current ? dateFor(current.key) : undefined;
  return <div className="process-quality-deadlines">
    <div className="process-quality-current-deadline" role="group" aria-label={t('当前期限')}>
      <span>{t(current?.label ?? '当前期限')}</span>
      <strong>{currentDate ? <time dateTime={currentDate.toISOString()}>{currentDate.toLocaleString(locale)}</time> : '—'}</strong>
      {currentDate && currentDate.getTime() < Date.now() ? <Tag color="warning">{t('已逾期')}</Tag> : null}
    </div>
    <details><summary>{t('全部阶段期限')}</summary><dl>{deadlines.map(item => {
      const date = dateFor(item.key);
      return <div key={item.key}><dt>{t(item.label)}</dt><dd>{date ? <time dateTime={date.toISOString()}>{date.toLocaleString(locale)}</time> : '—'}</dd></div>;
    })}</dl></details>
  </div>;
}
