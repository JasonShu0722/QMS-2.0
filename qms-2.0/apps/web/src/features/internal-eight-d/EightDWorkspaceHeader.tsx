import { Button, Modal, Tag } from 'antd';
import type { components } from '@qms/contracts';
import type { ReactNode } from 'react';
import { useEightDText } from '../process-eight-d/eight-d';
import { EightDRiskBadge } from './EightDRiskBadge';
import styles from './eight-d-header.module.css';

type Detail = [label: string, value: string | null | undefined];
type Dates = [label: string, planned: string | null, actual: string | null];
type Plans = { details: Detail[]; dates: Dates[] };
type ReportStatus = components['schemas']['ProblemStatus'] | 'PROCESSING' | 'IN_REVIEW';

const processing = ['办理中', 'Processing', 'processing'] as const;
const inReview = ['审批中', 'In review', 'purple'] as const;
const statuses = {
  OPEN: ['待处理', 'Open', 'default'],
  IN_PROGRESS: processing,
  PENDING: inReview,
  RESOLVED: ['已解决', 'Resolved', 'success'],
  CLOSED: ['已关闭', 'Closed', 'success'],
  ARCHIVED: ['已归档', 'Archived', 'default'],
  PROCESSING: processing,
  IN_REVIEW: inReview,
} as const satisfies Record<ReportStatus, readonly [string, string, string]>;

type Props = {
  title: string;
  back?: ReactNode;
  actions: ReactNode;
  report?: { reportNumber: string; status: string; severity: string };
  plans?: Plans;
  plansOpen: boolean;
  onPlansOpenChange: (open: boolean) => void;
};

export function EightDWorkspaceHeader({ title, back, actions, report, plans, plansOpen, onPlansOpenChange }: Props) {
  const text = useEightDText();
  const plansTitle = text('责任与计划', 'Responsibility and plans');
  const status = report && Object.hasOwn(statuses, report.status) ? statuses[report.status as ReportStatus] : undefined;

  return <>
    <header className={styles.header}>
      {back}
      <h2>{title}</h2>
      {report && <div className={styles.identifiers}>
        {report.reportNumber !== title && <Tag>{report.reportNumber}</Tag>}
        <EightDRiskBadge severity={report.severity} />
        <Tag color={status?.[2]}>{status ? text(status[0], status[1]) : report.status}</Tag>
      </div>}
      <div className={styles.actions}>
        {actions}
        {plans && <Button aria-haspopup="dialog" onClick={() => onPlansOpenChange(true)}>{plansTitle}</Button>}
      </div>
    </header>
    {plans && <Modal open={plansOpen} destroyOnHidden title={plansTitle} width={680} closable={false}
      onCancel={() => onPlansOpenChange(false)}
      footer={<Button type="primary" autoInsertSpace={false} onClick={() => onPlansOpenChange(false)}>{text('关闭', 'Close')}</Button>}>
      <dl className={styles.details}>{plans.details.map(([label, value]) => <div key={label}>
        <dt>{label}</dt><dd>{value || '—'}</dd>
      </div>)}</dl>
      <table className={styles.dates} aria-label={text('计划与实际', 'Planned and actual dates')}>
        <thead><tr><th scope="col">{text('阶段', 'Stage')}</th><th scope="col">{text('计划', 'Planned')}</th><th scope="col">{text('实际', 'Actual')}</th></tr></thead>
        <tbody>{plans.dates.map(([label, planned, actual]) => <tr key={label}>
          <th scope="row">{label}</th><td>{planned || '—'}</td><td>{actual || '—'}</td>
        </tr>)}</tbody>
      </table>
    </Modal>}
  </>;
}
