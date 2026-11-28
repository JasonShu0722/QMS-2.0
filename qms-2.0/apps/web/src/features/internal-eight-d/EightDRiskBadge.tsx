import { Tag } from 'antd';
import { useEightDSeverityText, useEightDText, type EightDReport } from '../process-eight-d/eight-d';

const colors = { LOW: 'success', MEDIUM: 'processing', HIGH: 'warning', CRITICAL: 'error' } satisfies Record<EightDReport['severity'], string>;

export function EightDRiskBadge({ severity }: { severity?: string | null }) {
  const text = useEightDText();
  const severityText = useEightDSeverityText();
  const level = severity && Object.hasOwn(colors, severity) ? severity as EightDReport['severity'] : undefined;
  return <Tag color={level ? colors[level] : undefined} style={{ marginInlineEnd: 0 }}>
    {level ? severityText(level) : text('未记录', 'Not recorded')}
  </Tag>;
}
