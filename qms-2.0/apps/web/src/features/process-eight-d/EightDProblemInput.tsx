import { Link } from 'react-router-dom';
import type { InternalEightDDomain } from '../internal-eight-d/domain';
import { useEightDSeverityText, useEightDText, type EightDReport } from './eight-d';
import styles from './eight-d.module.css';

type Source = EightDReport['sources'][number] | { sourceId: string; sourceVersion: number; sourceSnapshot: Record<string, unknown>; sourceDomain: string; sourceType: string };
type SourceProps = { sources: Source[]; domain?: InternalEightDDomain; organizationId?: string };

function sourceFacts(source: Source, domain: InternalEightDDomain) {
  const snapshot = 'sourceSnapshot' in source ? source.sourceSnapshot : source.snapshot;
  const normalized = snapshot?.normalized as Record<string, unknown> | undefined;
  return domain === 'customer' ? {
    observation: normalized?.defectDescription, operation: undefined, line: undefined,
    date: normalized?.occurredOn, quantity: normalized?.quantity, reference: snapshot?.complaintNumber,
  } : {
    observation: snapshot?.description, operation: snapshot?.operationName, line: snapshot?.lineName,
    date: snapshot?.occurredAt, quantity: snapshot?.defectQuantity, reference: snapshot?.traceCode ?? snapshot?.workOrderCode,
  };
}

function asText(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }

export function useEightDProblemFacts(sources: Source[], domain: InternalEightDDomain) {
  const text = useEightDText();
  const facts = sources.map(source => sourceFacts(source, domain));
  const quantities = facts.map(fact => fact.quantity).filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  const join = (values: string[]) => [...new Set(values.filter(Boolean))].join(text('、', ', '));
  return [
    [text('初始现象', 'Initial observation'), join(facts.map(fact => asText(fact.observation)))],
    [text('工序', 'Operation'), join(facts.map(fact => asText(fact.operation)))],
    [text('产线', 'Line'), join(facts.map(fact => asText(fact.line)))],
    [text('发生日期', 'Occurrence dates'), join(facts.map(fact => asText(fact.date).slice(0, 10)).sort())],
    [quantities.length === sources.length ? text('不良数量合计', 'Total defect quantity') : text('已记录不良数量合计', 'Recorded defect quantity'), quantities.length ? String(quantities.reduce((sum, value) => sum + value, 0)) : ''],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
}

function sourceDestination(source: Source, domain: InternalEightDDomain, organizationId?: string) {
  const id = 'sourceId' in source ? source.sourceId : source.defectId;
  const snapshot = 'sourceSnapshot' in source ? source.sourceSnapshot : source.snapshot;
  const recordId = domain === 'new-product' ? asText(snapshot?.id) : id;
  if (!organizationId || !/^[0-9a-f-]{36}$/i.test(recordId)) return undefined;
  const key = domain === 'customer' ? 'complaintId' : 'defectId';
  return `/app/${domain === 'customer' ? 'customer-quality' : 'process-quality'}?${new URLSearchParams({ organizationId, [key]: recordId })}`;
}

export function EightDSourceSummary({ sources, domain = 'process', organizationId }: SourceProps) {
  const text = useEightDText();
  const facts = useEightDProblemFacts(sources, domain);
  return <>
    <ul className={styles.factGrid} aria-label={text('来源摘要', 'Source summary')}>
      {facts.map(([label, value]) => <li key={label}><span>{label}</span><strong>{value}</strong></li>)}
    </ul>
    {!!sources.length && <details>
      <summary>{text('查看来源明细', 'View source details')} ({sources.length})</summary>
      <ul className={styles.sourceList}>{sources.map((source, index) => {
        const id = 'sourceId' in source ? source.sourceId : source.defectId;
        const fact = sourceFacts(source, domain);
        const destination = sourceDestination(source, domain, organizationId);
        const name = asText(fact.reference) || asText(fact.observation) || `${text('来源', 'Source')} ${index + 1}`;
        return <li key={id}>
          {destination ? <Link to={destination}>{name}</Link> : <strong>{name}</strong>}
          <span>{[asText(fact.date).slice(0, 10), asText(fact.operation), asText(fact.line), typeof fact.quantity === 'number' ? `${text('不良数', 'Defects')} ${fact.quantity}` : ''].filter(Boolean).join(' · ')}</span>
        </li>;
      })}</ul>
    </details>}
    {!sources.length && <p>{text('未记录来源', 'No sources recorded')}</p>}
  </>;
}

export function EightDProblemInput({ severity, observation, ...props }: SourceProps & { severity?: string; observation?: string }) {
  const text = useEightDText();
  const severityText = useEightDSeverityText();
  return <div className={styles.problemInput}>
    <section><h4>{text('问题输入', 'Problem input')}</h4>{observation ? <p>{observation}</p> : <EightDSourceSummary {...props} />}</section>
    <section><h4>{text('风险评估', 'Risk assessment')}</h4>
      <p>{severity && ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(severity) ? severityText(severity as EightDReport['severity']) : text('未记录', 'Not recorded')}</p>
    </section>
  </div>;
}
