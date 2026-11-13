import { useState } from 'react';
import { Button, Modal, Space, Tag, type TableProps } from 'antd';
import { RefreshCw } from 'lucide-react';
import type { components } from '@qms/contracts';
import { LedgerTable, useLedgerPageSize } from '../../ui/ledger';
import type { IntegrationScope } from '../api-integrations/integration-ui';
import { IngestionError, ingestionPath, label, useIngestionMutation, useIngestionPage, useIngestionText, type Endpoint, type Rule } from './ingestion-ui';
import { RuleEditor } from './RuleEditor';
import { ImportPreview } from './ImportPreview';

export function RuleList({ scope, endpoints, endpointsLoading, canReceipts }: { scope: IntegrationScope; endpoints: Endpoint[]; endpointsLoading: boolean; canReceipts: boolean }) {
  const text = useIngestionText(); const english = text('zh', 'en') === 'en';
  const [pageSize, setPageSize] = useLedgerPageSize('console-ingestion-rules', scope.organizationId); const [page, setPage] = useState(1); const [revision, setRevision] = useState(0);
  const result = useIngestionPage<components['schemas']['IngestionRulePageDto']>(scope, `${ingestionPath}/rules`, page, pageSize, revision);
  const [editing, setEditing] = useState<{ rule?: Rule }>(); const [preview, setPreview] = useState<{ rule: Rule; history: boolean }>(); const [deleting, setDeleting] = useState<Rule>();
  const canManage = scope.permissions.includes('ingestion:manage'); const canRun = scope.permissions.includes('ingestion:run');
  const reload = () => setRevision(value => value + 1);
  const columns: TableProps<Rule>['columns'] = [
    { key: 'name', title: text('规则名称', 'Rule name'), width: 190, dataIndex: 'name' },
    { key: 'target', title: text('目标档案', 'Target record'), width: 140, dataIndex: 'target', render: value => label(value, english) },
    { key: 'endpoint', title: text('接收接口', 'Receiving interface'), width: 180, render: (_, rule) => endpoints.find(endpoint => endpoint.id === rule.endpointId)?.name ?? text('接口已停用或不可用', 'Interface unavailable') },
    { key: 'enabled', title: text('状态', 'Status'), width: 90, render: (_, rule) => <Tag color={rule.enabled ? 'success' : undefined}>{rule.enabled ? text('启用', 'Enabled') : text('停用', 'Disabled')}</Tag> },
    { key: 'mode', title: text('已有记录处理', 'Existing records'), width: 190, dataIndex: 'mode', render: value => label(value, english) },
    { key: 'version', title: text('版本', 'Version'), width: 70, dataIndex: 'version' },
    { key: 'actions', title: text('操作', 'Actions'), width: 370, render: (_, rule) => <Space wrap size="small">
      {canManage && <Button size="small" aria-label={text(`编辑${rule.name}`, `Edit ${rule.name}`)} onClick={() => setEditing({ rule })}>{text('编辑', 'Edit')}</Button>}
      {canRun && <><Button size="small" disabled={!canReceipts} onClick={() => setPreview({ rule, history: false })}>{text('单条试处理', 'Single preview')}</Button><Button size="small" disabled={!canReceipts} onClick={() => setPreview({ rule, history: true })}>{text('历史批量导入', 'Historical import')}</Button></>}
      {canManage && <Button danger size="small" aria-label={text(`删除${rule.name}`, `Delete ${rule.name}`)} onClick={() => setDeleting(rule)}>{text('删除', 'Delete')}</Button>}
    </Space> },
  ];
  return <div className="qms-ingestion-section">
    <Space wrap><Button icon={<RefreshCw size={15} />} loading={result.loading} onClick={reload}>{text('刷新规则', 'Refresh rules')}</Button>{canManage && <Button type="primary" disabled={endpointsLoading || !endpoints.length} onClick={() => setEditing({})}>{text('新增规则', 'New rule')}</Button>}</Space>
    <IngestionError error={result.error} />
    <LedgerTable<Rule> ledgerId="console-ingestion-rules" organizationId={scope.organizationId} requiredColumnKeys={['name', 'actions']} rowKey="id" loading={result.loading || endpointsLoading} dataSource={result.data?.items ?? []} columns={columns} scroll={{ x: 1230 }} pagination={{ current: page, pageSize, total: result.data?.total ?? 0, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], onChange: (next, size) => { setPage(size === pageSize ? next : 1); setPageSize(size); } }} />
    {editing && <RuleEditor scope={scope} rule={editing.rule} endpoints={endpoints} endpointsLoading={endpointsLoading} close={() => setEditing(undefined)} saved={() => { setEditing(undefined); reload(); }} />}
    {preview && <ImportPreview scope={scope} rule={preview.rule} history={preview.history} canReceipts={canReceipts} close={() => setPreview(undefined)} />}
    {deleting && <DeleteRule scope={scope} rule={deleting} close={() => setDeleting(undefined)} saved={() => { setDeleting(undefined); reload(); }} />}
  </div>;
}
function DeleteRule({ scope, rule, close, saved }: { scope: IntegrationScope; rule: Rule; close: () => void; saved: () => void }) {
  const text = useIngestionText(); const mutation = useIngestionMutation(scope);
  const remove = () => { const body: components['schemas']['DeleteIngestionRuleDto'] = { organizationId: scope.organizationId, expectedVersion: rule.version }; void mutation.execute<void>({ path: `${ingestionPath}/rules/${rule.id}`, method: 'DELETE', body }, saved); };
  return <Modal open title={text(`删除规则：${rule.name}`, `Delete rule: ${rule.name}`)} mask={{ closable: false }} closable={!mutation.locked} keyboard={!mutation.locked} onCancel={() => { if (!mutation.locked) close(); }} footer={<Space><Button disabled={mutation.locked} onClick={close}>{text('取消', 'Cancel')}</Button><Button danger type="primary" loading={mutation.busy} onClick={mutation.unknown ? mutation.retry : remove}>{mutation.unknown ? text('重试原请求', 'Retry original request') : text('确认删除', 'Confirm deletion')}</Button></Space>}>
    <p>{text('删除后停止新增自动任务，既有任务和处理记录保留。', 'Deletion stops new automatic jobs and preserves existing jobs and results.')}</p>
    <IngestionError error={mutation.error} unknown={mutation.unknown} />
  </Modal>;
}
