import { Alert, Button, Popconfirm, Space, Typography } from 'antd';
import { useState } from 'react';
import type { components } from '@qms/contracts';
import { createSupplierMutation, supplierApi, supplierError, type SupplierProblem, type SupplierWorkflowActionBody } from './supplierQuality';

type WorkflowAction = components['schemas']['SupplierWorkflowActionDto']['action'];
const actionLabels: Record<WorkflowAction, string> = { VERIFY: '验证通过', RETURN: '退回重提', REJECT: '驳回重提', REOPEN: '重新打开', CLOSE: '关闭问题' };
const unavailableLabels: Record<string, string> = {
  WORKFLOW_INDEPENDENT_VERIFICATION_REQUIRED: '关闭需由另一名内部人员验证当前修订',
  WORKFLOW_INSTANCE_NOT_FOUND: '流程尚未启动',
  WORKFLOW_NODE_FORBIDDEN: '当前节点无操作权限',
  WORKFLOW_ACTION_INVALID: '当前节点无可执行动作',
};

export function SupplierWorkflowActions({ record, changed, reload }: { record: SupplierProblem; changed: (value: SupplierProblem, notice: string) => void; reload: () => void }) {
  const [mutate] = useState(createSupplierMutation);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const actions = (record.availableActions ?? []).filter((action): action is WorkflowAction => action !== 'SUBMIT');
  async function execute(action: WorkflowAction) {
    if (busy) return;
    setBusy(true); setError(undefined);
    try {
      const body: SupplierWorkflowActionBody = { action, expectedContentVersion: record.version, ...(action === 'VERIFY' ? { accepted: true } : {}) };
      const updated = await mutate<SupplierProblem>(`${supplierApi(false)}/problems/${record.id}/workflow-actions`, 'POST', body);
      changed(updated, `${actionLabels[action]}成功`);
    } catch (cause) { setError(supplierError(cause)); }
    finally { setBusy(false); }
  }
  if (record.stage !== 'ISSUED') return null;
  return <section className="supplier-card" aria-label="内部流程动作"><Typography.Title level={3}>内部流程动作</Typography.Title>
    {error ? <Alert type="error" showIcon title={error} action={<Button onClick={reload}>重新加载</Button>} /> : null}
    <Space wrap>{actions.map((action) => <Popconfirm key={action} title={`确认${actionLabels[action]}？`} okText="确认执行" cancelText="取消" onConfirm={() => execute(action)}>
      <Button loading={busy} disabled={busy} type={action === 'VERIFY' ? 'primary' : 'default'} danger={action === 'REJECT' || action === 'CLOSE'}>{actionLabels[action]}</Button>
    </Popconfirm>)}</Space>
    {!actions.length ? <Typography.Paragraph type="secondary">{unavailableLabels[record.actionUnavailableReason ?? ''] ?? '当前没有可执行的内部动作'}</Typography.Paragraph> : null}
  </section>;
}
