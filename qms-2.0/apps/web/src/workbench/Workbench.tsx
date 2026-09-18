const metrics = [
  '个人待办',
  '待审批',
  '即将逾期',
  '高风险',
  '关键指标',
] as const;

export function Workbench() {
  return (
    <section className="workbench" aria-label="内部工作台">
      {metrics.map((label) => (
        <article className="metric-tile" key={label}>
          <span>{label}</span>
          <strong>待接入</strong>
        </article>
      ))}
    </section>
  );
}
