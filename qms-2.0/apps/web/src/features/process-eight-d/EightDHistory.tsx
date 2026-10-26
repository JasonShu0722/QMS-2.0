import { useEffect, useState } from 'react';
import { Alert, Button, Modal, Space, Spin, Tag } from 'antd';
import { Link } from 'react-router-dom';
import type { components } from '@qms/contracts';
import { useNavigationGuard } from '../../layouts/UnsavedChanges';
import { ClosureTaskInbox } from '../tasks/ClosureTaskInbox';
import { aborted, extensionPath, roundPath, useEightDText, type EightDRead, type EightDReport } from './eight-d';
import styles from './eight-d.module.css';

type Round = components['schemas']['WorkflowClosureRoundDto'];
type Extensions = components['schemas']['WorkflowDeadlineExtensionDto'][];
type Audit = components['schemas']['ProblemAuditPageDto'];
export function EightDRounds({ problemId, read, revision, blocked, onInboxClosed }: { problemId: string; read: EightDRead; revision: number; blocked: boolean; onInboxClosed: () => void }) {
  const text = useEightDText();
  const [rounds, setRounds] = useState<Round[]>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [inboxOpen, setInboxOpen] = useState(false);
  const requestLeave = useNavigationGuard();
  useEffect(() => {
    let active = true; setError(false); setRounds(undefined);
    read<Round[]>(roundPath(problemId)).then(value => { if (active) setRounds(value); }).catch(cause => { if (active && !aborted(cause)) setError(true); });
    return () => { active = false; };
  }, [problemId, read, revision, retry]);
  const duty = (value: Round['duties'][number]['duty']) => value === 'PROFESSIONAL' ? text('专业审核', 'Professional review') : value === 'SECTION_MANAGER' ? text('科室经理', 'Section manager') : text('分管部长', 'Responsible minister');
  const status = (value: string) => ({ PENDING: text('待处理', 'Pending'), WAITING: text('等待前序', 'Waiting'), APPROVED: text('已通过', 'Approved'), RETURNED: text('已退回', 'Returned'), CANCELLED: text('已取消', 'Cancelled'), SKIPPED_SAME_PERSON: text('同人跳过并留痕', 'Skipped: same person, audited') })[value] ?? value;
  return <section className={styles.section} aria-label={text('并行审核与轮次历史', 'Parallel review and round history')}><h3>{text('并行审核与轮次历史', 'Parallel review and round history')}</h3>
    <p>{text('专业侧与管理侧并行；任一退回须整轮重审。审批在既有关闭职责待办办理，此表单不代签或绕过。', 'Professional and management reviews run in parallel. Either return restarts the whole round. Use the existing closure duty inbox; this form cannot bypass it.')}</p>
    <Space wrap><Button disabled={blocked} onClick={() => setInboxOpen(true)}>{text('打开关闭职责待办', 'Open closure duty inbox')}</Button><Link to="/app/my-tasks">{text('前往我的待办', 'Go to my tasks')}</Link></Space>
    {inboxOpen && <Modal open title={text('关闭职责待办', 'Closure duty inbox')} width={1000} footer={null} mask={{ closable: false }} onCancel={() => requestLeave(() => { setInboxOpen(false); setRetry(value => value + 1); onInboxClosed(); }, true)}><ClosureTaskInbox /></Modal>}
    {error ? <Alert type="error" title={text('轮次加载失败', 'Round history failed')} action={<Button onClick={() => setRetry(value => value + 1)}>{text('重试', 'Retry')}</Button>} /> : !rounds ? <Spin /> : !rounds.length ? <p>{text('暂无审批轮次', 'No approval rounds')}</p> : rounds.map(round => <article className={styles.row} key={round.id}>
      <h4>{text('轮次', 'Round')} {round.roundNumber} · <Tag>{status(round.status)}</Tag></h4><p>{text('固定内容版本', 'Fixed content version')} {round.contentVersion} · {text('轮次版本', 'Round version')} {round.version}</p>
      <div className={styles.parallel}>{[true, false].map(professional => <section key={String(professional)} aria-label={professional ? text('专业侧', 'Professional side') : text('管理侧', 'Management side')}><h4>{professional ? text('专业侧', 'Professional side') : text('管理侧', 'Management side')}</h4>{round.duties.filter(item => (item.duty === 'PROFESSIONAL') === professional).map(item => <div key={item.id}><p>{duty(item.duty)} · {status(item.status)} · <code>{item.userId}</code></p><p className={styles.pre}>{item.comment ?? text('暂无意见', 'No comment')}</p>{item.decidedAt && <time dateTime={item.decidedAt}>{item.decidedAt}</time>}</div>)}</section>)}</div>
    </article>)}
  </section>;
}

export function EightDHistory({ report, read }: { report: EightDReport; read: EightDRead }) {
  const text = useEightDText();
  const [extensions, setExtensions] = useState<Extensions>();
  const [audit, setAudit] = useState<Audit>();
  const [cursor, setCursor] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    read<Extensions>(extensionPath(report.problemId)).then(value => { if (active) setExtensions(value); }).catch(cause => { if (active && !aborted(cause)) setError(true); });
    return () => { active = false; };
  }, [report.problemId, read, revision]);
  useEffect(() => {
    let active = true; setLoading(true);
    const query = new URLSearchParams({ organizationId: report.organizationId, pageSize: '25' }); if (cursor) query.set('cursor', cursor);
    read<Audit>(`/api/v1/problems/${encodeURIComponent(report.problemId)}/audit-trail?${query}`).then(value => {
      if (active) setAudit(previous => ({ ...value, items: cursor ? [...(previous?.items ?? []), ...value.items.filter(item => !previous?.items.some(old => old.id === item.id))] : value.items }));
    }).catch(cause => { if (active && !aborted(cause)) setError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [report.problemId, report.organizationId, read, cursor, revision]);
  return <div className={styles.modal}>
    <Button disabled={loading} onClick={() => { setError(false); setCursor(undefined); setAudit(undefined); setExtensions(undefined); setRevision(value => value + 1); }}>{text('刷新轨迹', 'Refresh history')}</Button>
    {error && <Alert type="error" title={text('部分轨迹加载失败，请刷新', 'Some history could not be loaded. Refresh.')} />}
    <section className={styles.section}><h3>{text('期限与延期历史', 'Deadline and extension history')}</h3><p>{text('原期限在全部批准前持续有效。', 'Original deadlines remain active until full approval.')}</p>
      {!extensions ? <Spin /> : !extensions.length ? <p>{text('暂无延期申请', 'No extension requests')}</p> : extensions.map(item => <article key={item.id} className={styles.row}><h4>{item.stage} · {item.status}</h4><p>{item.originalDueAt} → {item.requestedDueAt}</p><p>{item.reason}</p>{item.leaderSkipped && <Tag>{text('上级同人跳过，质量侧仍须审批', 'Same-person leader skipped; quality review required')}</Tag>}<ol>{item.history.map((event, index) => <li key={`${event.at}:${index}`}>{event.action} · {event.userId ?? '—'} · {event.at}<p className={styles.pre}>{event.comment}</p></li>)}</ol></article>)}
    </section>
    <section className={styles.section}><h3>{text('审计轨迹', 'Audit trail')}</h3>{audit?.domainRevisionTrailAvailable === false && <Alert type="info" title={text('领域修订追溯不可用', 'Domain revision history is unavailable')} />}
      <ol>{audit?.items.map(event => <li key={event.id}><Space wrap><strong>{event.action}</strong><span>{event.outcome}</span><span>{event.actorName ?? text('系统', 'System')}</span><time dateTime={event.createdAt}>{event.createdAt}</time></Space>{event.reasonCode && <p>{event.reasonCode}</p>}</li>)}</ol>
      {audit && !audit.items.length && <p>{text('暂无审计记录', 'No audit events')}</p>}{loading && <Spin />}{audit?.nextCursor && <Button disabled={loading} onClick={() => setCursor(audit.nextCursor!)}>{text('加载更多', 'Load more')}</Button>}
    </section>
  </div>;
}
