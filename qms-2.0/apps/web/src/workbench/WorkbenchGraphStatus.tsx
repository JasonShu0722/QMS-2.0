import { Alert, Button, Input } from 'antd';
import type { components } from '@qms/contracts';
import { useState, type FormEvent } from 'react';
import { nodeStatuses, type GraphNode, type GraphText } from './workbench-graph';

export type StatusSaveResult = 'saved' | 'stale' | 'unavailable' | 'denied' | 'save';

type StatusEditorProps = {
  node: Pick<GraphNode, 'status' | 'statusVersion'>;
  saving: boolean;
  onSave: (payload: components['schemas']['UpdateWorkbenchGraphStatusDto']) => Promise<StatusSaveResult | undefined>;
  text: GraphText;
};

export function WorkbenchGraphStatus({ node, saving, onSave, text }: StatusEditorProps) {
  const [draft, setDraft] = useState<Pick<GraphNode, 'status' | 'statusVersion'>>();
  const [evidence, setEvidence] = useState('');
  const [failure, setFailure] = useState<Exclude<StatusSaveResult, 'saved'>>();

  const disabled = !draft || draft.status === node.status || (draft.status === 'live' && !evidence.trim());

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || disabled || saving) return;
    setFailure(undefined);
    const result = await onSave({ status: draft.status, expectedVersion: draft.statusVersion,
      ...(draft.status === 'live' ? { evidence: evidence.trim() } : {}),
    });
    if (!result) return;
    if (result !== 'save') setDraft(undefined);
    if (result !== 'saved') setFailure(result);
  }

  return <>
    {!draft && <Button size="small" disabled={saving || failure === 'denied' || failure === 'unavailable'} onClick={() => {
      setDraft({ status: node.status, statusVersion: node.statusVersion }); setFailure(undefined); setEvidence('');
    }}>{text('调整状态', 'Change status')}</Button>}
    {draft && <form className="qms-workbench-graph__status-form" onSubmit={save}>
      <label>{text('调整为', 'Change to')}
        <select disabled={saving} value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as GraphNode['status'] })}>
          {Object.entries(nodeStatuses).map(([status, label]) => <option key={status} value={status}>{text(...label)}</option>)}
        </select>
      </label>
      {draft.status === 'live' && draft.status !== node.status && <label>
        {text('上线验收依据', 'Release and acceptance evidence')}
        <Input value={evidence} maxLength={500} required disabled={saving} onChange={event => setEvidence(event.target.value)}
          placeholder={text('填写发布版本及认可记录', 'Enter the release and acceptance record')} />
      </label>}
      <div>
        <Button htmlType="submit" size="small" type="primary" loading={saving} disabled={disabled}>{text('保存状态', 'Save status')}</Button>
        <Button size="small" disabled={saving} onClick={() => { setDraft(undefined); setFailure(undefined); }}>{text('取消', 'Cancel')}</Button>
      </div>
    </form>}
    {failure && <Alert type="error" title={{
      stale: text('状态已被更新，请核对后重新调整。', 'The status changed. Review it before trying again.'),
      unavailable: text('无法读取最新状态，请重新打开图谱。', 'Could not read the current status. Reopen the graph.'),
      denied: text('当前会话无权调整状态。', 'This session cannot change the status.'),
      save: text('未能确认保存结果，请重试。', 'The save could not be confirmed. Please retry.'),
    }[failure]} />}
  </>;
}
