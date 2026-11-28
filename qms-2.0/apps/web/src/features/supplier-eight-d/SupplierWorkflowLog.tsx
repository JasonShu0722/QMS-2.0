import { Alert, Button, Spin, Tag } from 'antd';
import { useEffect, useState } from 'react';
import type { components } from '@qms/contracts';
import { aborted, roundPath, useEightDText, type EightDRead } from '../process-eight-d/eight-d';
import type { SupplierReport } from './supplier-eight-d';
import styles from './supplier-eight-d.module.css';

type Round = components['schemas']['WorkflowClosureRoundDto'];
type LogRound = Round | components['schemas']['SupplierPortalEightDApprovalRoundDto'];

export function SupplierWorkflowLog({ report, base, portal, read }: {
  report: SupplierReport; base: string; portal: boolean; read: EightDRead;
}) {
  const text = useEightDText();
  const [rounds, setRounds] = useState<LogRound[]>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setRounds(undefined); setError(false);
    const path = portal ? `${base}/approval-history` : roundPath(report.problemId);
    read<LogRound[]>(path).then(value => {
      if (active) setRounds(value);
    }).catch(cause => {
      if (!active || aborted(cause)) return;
      setError(true);
    });
    return () => { active = false; };
  }, [base, portal, read, report.problemId, retry]);

  const duty = (value: string) => ({ PROFESSIONAL: 'SQE', SECTION_MANAGER: text('科室经理', 'Section manager'), MINISTER: text('部长', 'Minister') })[value] ?? value;
  const status = (value: string) => ({ PENDING: text('待处理', 'Pending'), WAITING: text('等待前序', 'Waiting'), APPROVED: text('已通过', 'Approved'), RETURNED: text('已退回', 'Returned'), CANCELLED: text('已取消', 'Cancelled'), SKIPPED_SAME_PERSON: text('同人跳过并留痕', 'Skipped: same person, audited') })[value] ?? value;
  return <section className={styles.section} aria-label={text('审批历史', 'Approval history')}>
    <h3>{text('审批历史', 'Approval history')}</h3>
    {error && <Alert type="error" title={text('审批历史加载失败', 'Approval history failed')} action={<Button onClick={() => setRetry(value => value + 1)}>{text('重试', 'Retry')}</Button>} />}
    {!error && !rounds && <Spin aria-label={text('正在加载审批历史', 'Loading approval history')} />}
    {!error && rounds && !rounds.length && <p>{text('暂无审批轮次', 'No approval rounds yet')}</p>}
    {!error && rounds?.map(round => <article className={styles.logRound} key={round.id}>
      <header><h4>{text('轮次', 'Round')} {round.roundNumber} <Tag>{status(round.status)}</Tag></h4><p>{text('创建时间', 'Created')} <time dateTime={round.createdAt}>{round.createdAt}</time> · {text('更新时间', 'Updated')} <time dateTime={round.updatedAt}>{round.updatedAt}</time></p></header>
      <div className={styles.logDuties}>{round.duties.map(item => <div key={item.id}>
        <strong>{duty(item.duty)}</strong><span> · {status(item.status)}</span>
        {!portal && 'userDisplayName' in item && item.userDisplayName && <span> · {item.userDisplayName}</span>}
        {item.decidedAt && <time dateTime={item.decidedAt}> · {item.decidedAt}</time>}
        {!portal && 'comment' in item && item.comment && <p className={styles.logComment}>{item.comment}</p>}
      </div>)}</div>
    </article>)}
  </section>;
}
