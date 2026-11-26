import { InternalEightDSourceFacts } from '../internal-eight-d/InternalEightDSourceFacts';
import { useEightDSeverityText, useEightDText } from './eight-d';

type SourceProps = Pick<Parameters<typeof InternalEightDSourceFacts>[0], 'sources'>;
type Props = SourceProps & { severity?: string };

const summaryFields = [
  ['description', '初始现象', 'Initial observation'],
  ['operationCode', '工序', 'Operation'],
  ['lineCode', '产线', 'Line'],
  ['occurredAt', '发生时间', 'Occurrence time'],
] as const;

export function EightDSourceSummary({ sources }: SourceProps) {
  const text = useEightDText();
  const snapshots = sources.map(source => 'sourceSnapshot' in source ? source.sourceSnapshot : source.snapshot);
  const quantities = snapshots.map(snapshot => snapshot?.defectQuantity)
    .filter((quantity): quantity is number => typeof quantity === 'number' && Number.isFinite(quantity) && quantity >= 0);

  return <>
    <ul aria-label={text('来源摘要', 'Source summary')}>
      <li>{text('来源条数', 'Source count')}：<span>{sources.length}</span></li>
      {!!quantities.length && <li>{quantities.length === sources.length ? text('不良数量合计', 'Total defect quantity') : text('已记录不良数量合计', 'Recorded defect quantity')}：<span>{quantities.reduce((sum, quantity) => sum + quantity, 0)}</span></li>}
      {summaryFields.map(([key, zh, en]) => {
        const values = snapshots.map(snapshot => snapshot?.[key]);
        const recorded = values.filter((value): value is string => typeof value === 'string' && !!value.trim()).map(value => value.trim());
        const unique = [...new Set(recorded)];
        if (!unique.length) return null;
        const value = unique.length > 1 ? text(`来源有差异（${unique.length} 种值）`, `Sources differ (${unique.length} values)`) : unique[0];
        return <li key={key}>{text(zh, en)}：<span>{value}</span>{recorded.length < sources.length && ` · ${text('部分来源未记录', 'Some sources have no recorded value')}`}</li>;
      })}
    </ul>
    {!!sources.length && <details>
      <summary>{text('查看来源明细', 'View source details')}</summary>
      <InternalEightDSourceFacts domain="process" sources={sources} />
    </details>}
  </>;
}

export function EightDProblemInput({ sources, severity }: Props) {
  const text = useEightDText();
  const severityText = useEightDSeverityText();
  return <>
    <section>
      <h4>{text('问题输入', 'Problem input')}</h4>
      <EightDSourceSummary sources={sources} />
    </section>
    <section>
      <h4>{text('风险评估', 'Risk assessment')}</h4>
      <p>{severity && ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(severity) ? severityText(severity as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL') : text('未记录', 'Not recorded')}</p>
    </section>
  </>;
}
