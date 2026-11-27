import { useState } from 'react';
import { Button, Modal, Space } from 'antd';
import { useEightDText } from './eight-d';
import styles from './eight-d.module.css';

export function EightDDescriptionTools({ value, facts, disabled, onApply }: {
  value: string; facts: readonly (readonly [string, string])[]; disabled: boolean; onApply: (value: string) => void;
}) {
  const text = useEightDText();
  const [proposal, setProposal] = useState<string>();
  const sentence = (line: string) => /[。！？.!?；;]$/.test(line) ? line : `${line}${text('。', '.')}`;
  const separator = text('：', ': ');
  const buildFromFacts = () => facts.map(([label, fact]) => sentence(`${label}${separator}${fact}`)).join(text('', ' '));
  const polish = () => {
    const fields = [
      { label: text('发生时间', 'Occurrence time'), pattern: /^(?:时间|发生(?:时间|日期)|(?:occurrence )?(?:time|dates?))$/i },
      { label: text('工序', 'Operation'), pattern: /^(?:工序|operation)$/i },
      { label: text('产线', 'Line'), pattern: /^(?:线体|产线|(?:production )?line)$/i },
      { label: text('不良现象', 'Defect observed'), pattern: /^(?:(?:初始|不良|问题)?现象|defect|(?:initial )?observation|defect observed)$/i },
      { label: text('已记录不良数量', 'Recorded defect quantity'), pattern: /^(?:(?:已记录)?不良(?:数|数量)(?:合计)?|(?:(?:total|recorded) )?defect quantity)$/i },
      { label: text('影响范围', 'Affected scope'), pattern: /^(?:影响范围|范围|(?:affected )?scope)$/i },
    ];
    const grouped = fields.map(({ label }) => ({ label, entries: [] as string[] }));
    const notes: string[] = [];
    for (const line of value.split(/\r?\n/)) {
      const normalized = line.trim().replace(/^[•●▪]\s*/, '');
      if (!normalized) continue;
      const field = /^(.+?)\s*[:：]\s*(\S.*)$/.exec(normalized);
      const index = field ? fields.findIndex(({ pattern }) => pattern.test(field[1])) : -1;
      if (field && index >= 0) grouped[index].entries.push(field[2]);
      else notes.push(normalized);
    }
    return [
      ...grouped.filter(({ entries }) => entries.length).map(({ label, entries }) => sentence(`${label}${separator}${entries.join(' / ')}`)),
      ...notes.map(sentence),
    ].join('\n');
  };
  if (disabled) return null;
  return <>
    <Space wrap>
      <Button disabled={!facts.length} onClick={() => setProposal(buildFromFacts())}>{text('根据问题输入生成 D2', 'Generate D2 from problem input')}</Button>
      <Button disabled={!value.trim()} onClick={() => setProposal(polish())}>{text('整理为质量工程表述', 'Format as a quality engineering description')}</Button>
    </Space>
    <Modal open={proposal !== undefined} title={text('预览问题描述', 'Preview problem description')} okText={text('使用此描述', 'Use this description')} cancelText={text('取消', 'Cancel')}
      onCancel={() => setProposal(undefined)} onOk={() => { if (proposal !== undefined) onApply(proposal); setProposal(undefined); }}>
      <p className={styles.pre}>{proposal}</p>
    </Modal>
  </>;
}
