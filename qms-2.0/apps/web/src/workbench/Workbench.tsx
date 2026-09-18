const metrics = [
  ['个人待办', '12'],
  ['待审批', '5'],
  ['即将逾期', '3'],
  ['高风险', '2'],
  ['关键指标', '98.6%'],
] as const;

export function Workbench() {
  return (
    <section className="workbench" aria-label="内部工作台">
      {metrics.map(([label, value]) => (
        <article className="metric-tile" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </article>
      ))}
    </section>
  );
}

