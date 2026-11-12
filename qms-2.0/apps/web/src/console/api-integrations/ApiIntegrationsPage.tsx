import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Empty, Popconfirm, Space, Tabs, Tag, Typography, type TableProps } from 'antd';
import { RefreshCw } from 'lucide-react';
import type { components } from '@qms/contracts';
import { ApiError } from '../../api/client';
import { subscribeSessionSignals } from '../../features/auth/session-invalidation';
import { useLanguage } from '../../i18n/Language';
import { useNavigationBusy, useNavigationGuard } from '../../layouts/UnsavedChanges';
import { LedgerTable, useLedgerPageSize } from '../../ui/ledger';
import { useLedgerSessionEpoch } from '../../ui/ledger/preferences';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { useConsoleContext } from '../ConsoleLayout';
import type { ConsoleContext } from '../console-navigation';
import { EndpointEditor } from './EndpointEditor';
import { CredentialPanel } from './CredentialPanel';
import { ConnectionCopy } from './ConnectionCopy';
import { ReceiptList } from './ReceiptList';
import { integrationError, integrationPath, isAborted, useScopedIntegrationRequests, type Endpoint, type EndpointPage, type IntegrationScope } from './integration-ui';
import './api-integrations.css';

export function ApiIntegrationsPage() {
  const { context, invalidate } = useConsoleContext();
  const session = useWorkTabsStore(state => state.sessionScope);
  const epoch = useLedgerSessionEpoch();
  const { locale } = useLanguage();
  const [retired, setRetired] = useState(false);
  useEffect(() => { setRetired(false); }, [context]);
  useEffect(() => useWorkTabsStore.subscribe((next, previous) => { if (next.sessionScope !== previous.sessionScope) { setRetired(true); invalidate(); } }), [invalidate]);
  const organization = context.targetOrganization;
  const key = JSON.stringify([session, epoch, context.actor.id, context.actor.homeOrganization.id, [organization.id, organization.type, organization.status, organization.configurationRequired], context.modules]);
  if (retired) return <Alert role="alert" type="error" showIcon title={locale === 'en-US' ? 'API integration access denied' : '无权访问API接口管理'} />;
  return <IntegrationPage key={key} context={context} session={session} epoch={epoch} invalidate={invalidate} />;
}

function IntegrationPage({ context, session, epoch, invalidate }: { context: ConsoleContext; session?: string; epoch: number; invalidate: () => void }) {
  const { locale } = useLanguage();
  const text = (zh: string, en: string) => locale === 'en-US' ? en : zh;
  const [denied, setDenied] = useState(false);
  const deny = useCallback(() => { setDenied(true); invalidate(); }, [invalidate]);
  const module = context.modules.find(item => item.key === 'api-integrations' && item.scope === 'TARGET' && item.coverage === 'ORGANIZATION' && item.organizationId === context.targetOrganization.id);
  const permissions = module?.permissions ?? [];
  const valid = !denied && session === `INTERNAL:${context.actor.homeOrganization.id}:${context.actor.id}` && context.actor.accountType === 'INTERNAL'
    && context.targetOrganization.type === 'INTERNAL' && context.targetOrganization.status === 'ACTIVE' && !context.targetOrganization.configurationRequired;
  const scope = useMemo<IntegrationScope>(() => ({ organizationId: context.targetOrganization.id, session: session ?? '', epoch, permissions, deny }), [context.targetOrganization.id, session, epoch, module, deny]);
  const canRead = permissions.includes('integration:read');
  const canReadReceipts = permissions.includes('integration:receipts:read');
  const [tab, setTab] = useState(canRead ? 'endpoints' : 'receipts');
  const requestLeave = useNavigationGuard();
  useEffect(() => subscribeSessionSignals(signal => { if (signal === 'invalidate') deny(); }), [deny]);
  if (!valid || !canRead && !canReadReceipts) return <Alert role="alert" type="error" showIcon title={text('无权访问API接口管理', 'API integration access denied')} />;
  return <section className="qms-integration-page" aria-label={text('API接口管理', 'API integrations')}>
    <Tabs activeKey={tab} destroyOnHidden onChange={next => requestLeave(() => setTab(next))} items={[
      { key: 'endpoints', label: text('接收接口', 'Receiving interfaces'), disabled: !canRead, children: canRead ? <EndpointList scope={scope} /> : null },
      { key: 'receipts', label: text('接收记录', 'Receiving records'), disabled: !canReadReceipts, children: tab === 'receipts' && canReadReceipts ? <ReceiptList scope={scope} /> : null },
      { key: 'outbound', label: text('发出接口', 'Outbound interfaces'), children: <Empty description={text('后续开放', 'Available in a future phase')} /> },
    ]} />
  </section>;
}

function EndpointList({ scope }: { scope: IntegrationScope }) {
  const { locale } = useLanguage();
  const text = (zh: string, en: string) => locale === 'en-US' ? en : zh;
  const [pageSize, setPageSize] = useLedgerPageSize('console-integration-endpoints', scope.organizationId);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<EndpointPage>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ endpoint?: Endpoint }>();
  const [credentials, setCredentials] = useState<Endpoint>();
  const [instructions, setInstructions] = useState<Endpoint>();
  const [deleting, setDeleting] = useState<{ endpoint: Endpoint; unknown: boolean }>();
  const [deleteError, setDeleteError] = useState<unknown>();
  const deletePending = useRef(false);
  const { read, write, current } = useScopedIntegrationRequests(scope);
  const canManage = scope.permissions.includes('integration:manage');
  const canCredentials = scope.permissions.includes('integration:credentials:manage');
  const deleteBusy = !!deleting;
  useNavigationBusy(deleteBusy);
  useEffect(() => {
    let active = true; setLoading(true); setData(undefined); setError(undefined);
    void read<EndpointPage>(integrationPath, { page: String(page), limit: String(pageSize) }).then(result => {
      if (!active || !current()) return;
      if (!Array.isArray(result.items) || result.items.some(item => item.organizationId !== scope.organizationId) || result.page !== page || result.limit !== pageSize || !Number.isSafeInteger(result.total) || result.total < 0) { scope.deny(); return; }
      setData(result);
    }).catch(cause => { if (active && current() && !isAborted(cause)) setError(cause); }).finally(() => { if (active && current()) setLoading(false); });
    return () => { active = false; };
  }, [scope.organizationId, page, pageSize, revision, read, current]);
  const reload = () => setRevision(value => value + 1);
  async function remove(endpoint: Endpoint) {
    if (deletePending.current || deleting && deleting.endpoint !== endpoint || editing || credentials || !canManage || !current()) return;
    deletePending.current = true; setDeleting({ endpoint, unknown: false }); setDeleteError(undefined);
    try {
      const body: components['schemas']['DeleteIntegrationEndpointDto'] = { organizationId: scope.organizationId, expectedVersion: endpoint.version };
      await write<void>(`${integrationPath}/${endpoint.id}`, 'DELETE', body);
      if (!current()) return;
      setDeleting(undefined); setEditing(value => value?.endpoint?.id === endpoint.id ? undefined : value);
      setCredentials(value => value?.id === endpoint.id ? undefined : value);
      setInstructions(value => value?.id === endpoint.id ? undefined : value); reload();
    } catch (cause) {
      if (!current() || isAborted(cause)) return;
      const knownClientFailure = cause instanceof ApiError && cause.status !== undefined && cause.status >= 400 && cause.status < 500;
      if (knownClientFailure) { setDeleting(undefined); setDeleteError(cause); }
      else { setDeleting({ endpoint, unknown: true }); setDeleteError(cause); }
    } finally { if (current()) deletePending.current = false; }
  }
  const status = (value: Endpoint['status']) => value === 'ENABLED' ? text('启用', 'Enabled') : value === 'DISABLED' ? text('停用', 'Disabled') : text('草稿', 'Draft');
  const columns: TableProps<Endpoint>['columns'] = [
    { key: 'identity', title: text('接收接口', 'Receiving interface'), width: 210, render: (_, item) => <><strong>{item.name}</strong><small>{item.code}</small></> },
    { key: 'source', title: text('来源系统', 'Source system'), width: 170, render: (_, item) => <>{item.sourceName}<small>{item.sourceCode}</small></> },
    { key: 'status', title: text('状态', 'Status'), width: 100, render: (_, item) => <Tag color={item.status === 'ENABLED' ? 'success' : undefined}>{status(item.status)}</Tag> },
    { key: 'receipt', title: text('接收回执', 'Receipt'), width: 115, render: (_, item) => item.returnReceipt ? text('返回回执', 'Return receipt') : text('空响应200', 'Empty response 200') },
    { key: 'capacity', title: text('正文容量', 'Payload capacity'), width: 170, render: (_, item) => <span className={item.usedBodyBytes >= item.capacityBytes * .8 ? 'qms-integration-capacity-warning' : undefined}>{(item.usedBodyBytes / 1048576).toFixed(1)} / {(item.capacityBytes / 1048576).toFixed(0)} MiB</span> },
    { key: 'actions', title: text('操作', 'Actions'), width: 330, render: (_, item) => <Space wrap size="small">
      <Button size="small" disabled={deleteBusy} aria-label={text(`查看${item.name}调用说明`, `View ${item.name} instructions`)} onClick={() => setInstructions(item)}>{text('调用说明', 'Instructions')}</Button>
      {canManage && <Button size="small" disabled={deleteBusy} aria-label={text(`编辑${item.name}`, `Edit ${item.name}`)} onClick={() => setEditing({ endpoint: item })}>{text('编辑', 'Edit')}</Button>}
      {canCredentials && <Button size="small" disabled={deleteBusy} aria-label={text(`管理${item.name}凭据`, `Manage ${item.name} credentials`)} onClick={() => setCredentials(item)}>{text('凭据', 'Credentials')}</Button>}
      {canManage && (deleting?.endpoint.id === item.id && deleting.unknown
        ? <Button danger size="small" disabled={deletePending.current} aria-label={text(`重试删除${item.name}`, `Retry deleting ${item.name}`)} onClick={() => void remove(deleting.endpoint)}>{text('重试删除', 'Retry delete')}</Button>
        : <Popconfirm title={text('删除后将停止接收、撤销全部凭据并保留历史，确认删除？', 'Deletion stops receiving, revokes all credentials, and preserves history. Continue?')} okText={text('确认删除', 'Confirm deletion')} cancelText={text('取消', 'Cancel')} cancelButtonProps={{ 'aria-label': text('取消', 'Cancel') }} okButtonProps={{ danger: true, loading: deleting?.endpoint.id === item.id }} onConfirm={() => remove(item)}>
          <Button danger size="small" disabled={deleteBusy || !!editing || !!credentials} aria-label={text(`删除${item.name}`, `Delete ${item.name}`)}>{text('删除', 'Delete')}</Button>
        </Popconfirm>)}
    </Space> },
  ];
  return <div className="qms-integration-section">
    <Space wrap><Button icon={<RefreshCw size={15} />} disabled={deleteBusy} onClick={reload} loading={loading}>{text('刷新接口', 'Refresh interfaces')}</Button>{canManage && <Button type="primary" disabled={deleteBusy} onClick={() => setEditing({})}>{text('新增接收接口', 'New receiving interface')}</Button>}</Space>
    {error ? <Alert role="alert" showIcon type="error" title={text(integrationError(error), 'Unable to read interfaces. Retry.')} description={error instanceof ApiError ? error.traceId : undefined} /> : null}
    {deleteError && !deleting?.unknown ? <Alert role="alert" showIcon type="error" title={text(integrationError(deleteError), 'Unable to delete this interface. Retry after refreshing.')} description={deleteError instanceof ApiError ? deleteError.traceId : undefined} /> : null}
    {deleting?.unknown && <Alert role="alert" showIcon type="error" title={text('删除结果未确认，请使用原请求重试；期间请勿进行其他维护操作或离开页面。', 'Deletion result is unknown. Retry the original request; do not perform other maintenance or leave this page.')} description={deleteError instanceof ApiError ? deleteError.traceId : undefined} />}
    <LedgerTable<Endpoint> ledgerId="console-integration-endpoints" organizationId={scope.organizationId} requiredColumnKeys={['identity', 'actions']} rowKey="id" loading={loading}
      dataSource={data?.items ?? []} columns={columns} scroll={{ x: 1090 }} pagination={{ current: page, pageSize, total: data?.total ?? 0, disabled: deleteBusy, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100],
        onChange: (next, size) => { if (!deleteBusy) { setPage(size === pageSize ? next : 1); setPageSize(size); } } }} />
    {editing && <EndpointEditor scope={scope} endpoint={editing.endpoint} close={() => setEditing(undefined)} saved={() => { setEditing(undefined); reload(); }} />}
    {credentials && <CredentialPanel scope={scope} endpoint={credentials} close={() => setCredentials(undefined)} changed={reload} />}
    {instructions && !deleteBusy && <Instructions key={instructions.id} scope={scope} endpoint={instructions} close={() => setInstructions(undefined)} />}
  </div>;
}

function Instructions({ scope, endpoint, close }: { scope: IntegrationScope; endpoint: Endpoint; close: () => void }) {
  const { locale } = useLanguage();
  const text = (zh: string, en: string) => locale === 'en-US' ? en : zh;
  const example = `curl --request POST "${endpoint.publicUrl}" --header "Authorization: Bearer <credentialId>.<secret>" --header "Content-Type: application/json" --data-binary "@payload.json"`;
  return <div className="qms-integration-instructions" role="region" aria-label={text('调用说明', 'Calling instructions')}>
    <Space wrap><strong>{endpoint.name}</strong><Button onClick={close}>{text('关闭说明', 'Close instructions')}</Button></Space>
    <Typography.Paragraph><code>{endpoint.publicUrl}</code></Typography.Paragraph>
    <ConnectionCopy scope={scope} endpoint={endpoint} />
    <p>{text('POST · application/json · JSON对象数组', 'POST · application/json · JSON object array')}</p>
    <pre>{`Authorization: Bearer <credentialId>.<secret>\nContent-Type: application/json`}</pre>
    <pre aria-label={text('调用示例', 'Request example')}>{example}</pre>
    <pre aria-label={text('正文示例', 'Body example')}>{'[{"example":true}]'}</pre>
    <p>{text(endpoint.returnReceipt ? '接收成功返回200及本次接收编号。' : '接收成功返回200空正文。', endpoint.returnReceipt ? 'Success: 200 with this receipt ID.' : 'Success: 200 with an empty body.')}</p>
    <p>{text('每次请求独立保存，重试可能新增记录；网络中断或5xx后先检索接收记录再决定重试。', 'Each request is saved independently. Retrying may create another record; after network failure or 5xx, check received records before retrying.')}</p>
    <p>{text('消息编号由系统分配；请求追踪号用于排查，网关错误可能没有JSON正文。', 'Message IDs are assigned by the server. Request IDs support investigation; gateway errors may not contain JSON.')}</p>
  </div>;
}
