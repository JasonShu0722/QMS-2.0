import { Alert, Button, Input, Pagination, Space, Spin } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { components } from '@qms/contracts';
import { apiRequest } from '../../api/client';
import { useNavigationBusy, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { ledgerDenied, useCustomerLedgerWrite } from '../customer-quality/customer-ledger-write';
import { supplierError } from './supplierQuality';

type Props = { id: string; version: number; disabled?: boolean; onIssued: () => void; onDenied: (cause: unknown) => void; onLockChange?: (locked: boolean) => void };
type Page = components['schemas']['SupplierEightDAssignmentPageDto'];
type Option = Page['items'][number];

export function SupplierEightDIssueButton(props: Props) {
  const scope = useWorkTabsStore(state => state.sessionScope);
  return <IssueScope key={JSON.stringify([scope, props.id])} {...props} scope={scope} />;
}

function IssueScope({ id, version, disabled, onIssued, onDenied, onLockChange, scope }: Props & { scope?: string }) {
  const [allowed, setAllowed] = useState(false);
  const [denied, setDenied] = useState(false);
  const [data, setData] = useState<{ query: string; page: Page }>();
  const [selected, setSelected] = useState<Option>();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState<string>();
  const alive = useRef(true), revoked = useRef(false), clear = useRef(() => {});
  const callbacks = useRef({ onIssued, onDenied }); callbacks.current = { onIssued, onDenied };
  const current = () => alive.current && !revoked.current && scope === useWorkTabsStore.getState().sessionScope;
  const revoke = (cause: unknown) => {
    if (!current() || !ledgerDenied(cause)) return;
    revoked.current = true; clear.current(); setAllowed(false); setDenied(true); setData(undefined); setSelected(undefined); setError(undefined);
    callbacks.current.onDenied(cause);
  };
  const writer = useCustomerLedgerWrite(revoke); clear.current = writer.discard;
  const locked = !!disabled || writer.busy || writer.uncertain;
  const query = new URLSearchParams({ limit: '20', offset: String((page - 1) * 20), search }).toString();
  const result = data?.query === query ? data.page : undefined;
  useUnsavedChanges(!!selected || writer.uncertain);
  useNavigationBusy(writer.busy || writer.uncertain);
  useEffect(() => {
    onLockChange?.(writer.busy || writer.uncertain);
    return () => onLockChange?.(false);
  }, [writer.busy, writer.uncertain, onLockChange]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    apiRequest<components['schemas']['PermissionsResponseDto']>('/api/v1/system/my-permissions', { signal: controller.signal })
      .then(value => { if (current() && !controller.signal.aborted) setAllowed(value.permissions.includes('supplier-quality:issues:issue')); })
      .catch(cause => { if (current() && !controller.signal.aborted) { if (ledgerDenied(cause)) revoke(cause); else setError(supplierError(cause)); } });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController(); setError(undefined);
    apiRequest<Page>(`/api/v1/supplier-quality/eight-d/assignment-options?${query}`, { signal: controller.signal })
      .then(value => { if (current() && !controller.signal.aborted) setData({ query, page: value }); })
      .catch(cause => { if (current() && !controller.signal.aborted) { if (ledgerDenied(cause)) revoke(cause); else setError(supplierError(cause)); } });
    return () => controller.abort();
  }, [allowed, query, retry]);

  async function issue() {
    if (!selected || writer.busy || disabled || !current()) return;
    setError(undefined);
    try {
      await writer.write<components['schemas']['SupplierEightDReportDto']>(`/api/v1/supplier-quality/eight-d/drafts/${encodeURIComponent(id)}/issue`,
        { expectedVersion: version, sqeAssignmentId: selected.assignmentId }, 'POST');
      if (current()) callbacks.current.onIssued();
    } catch (cause) { if (current() && !ledgerDenied(cause)) setError(supplierError(cause)); }
  }
  if (denied) return null;
  if (!allowed) return error ? <Alert type="error" title={error} /> : null;
  const options = [...new Map([...(selected ? [selected] : []), ...(result?.items ?? [])].map(item => [item.assignmentId, item])).values()];
  return <section className="supplier-issue"><h3>完整8D发单</h3>
    <p>按科室、岗位和实际任职选择本单SQE。发单不自动释放给供应商；阶段期限由本单SQE另行设定。</p>
    {error && <Alert type="error" title={error} />}
    {writer.uncertain && <Alert type="warning" title="发单结果未知，请勿修改请求；重试使用原请求和同一幂等键。" />}
    <fieldset disabled={locked}><Input.Search aria-label="搜索SQE任职" maxLength={100} disabled={locked} onSearch={value => { setSearch(value); setPage(1); }} />
      {!result && !error && <Spin />}
      <label>SQE责任任职<select aria-label="SQE责任任职" disabled={locked} value={selected?.assignmentId ?? ''} onChange={event => setSelected(options.find(item => item.assignmentId === event.target.value))}>
        <option value="">请选择有效SQE任职</option>{options.map(item => <option key={item.assignmentId} value={item.assignmentId}>{item.departmentName} / {item.positionName} / {item.fullName || item.username}</option>)}
      </select></label>
      {result && <Pagination size="small" current={page} pageSize={20} total={result.total} showSizeChanger={false} disabled={locked} onChange={setPage} />}
      {result?.total === 0 && <p>未找到有效SQE任职，请先核对岗位及权限配置。</p>}
    </fieldset>
    <Space wrap><Button disabled={writer.busy || !!disabled || !selected} loading={writer.busy} onClick={() => void issue()}>{writer.uncertain ? '重试原发单' : '正式发起8D'}</Button>
      <Button disabled={locked} onClick={() => setRetry(value => value + 1)}>刷新任职</Button></Space>
  </section>;
}
