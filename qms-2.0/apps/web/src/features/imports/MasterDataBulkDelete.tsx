import { useEffect, useRef, useState, type Key } from 'react';
import { Alert, Button, Modal, type TableProps } from 'antd';
import type { components } from '@qms/contracts';
import { ApiError, createAdminMutation, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useNavigationBusy } from '../../layouts/UnsavedChanges';
import { getLedgerSessionEpoch, useLedgerSessionEpoch } from '../../ui/ledger/preferences';
import './master-data-bulk-delete.css';

type Body = components['schemas']['MasterDataBulkDeleteDto'];
type Result = components['schemas']['MasterDataBulkDeleteResultDto'];
type RecordVersion = { id: string; version: number };
type Selection = Record<string, RecordVersion>;
type Options = {
  organizationId?: string; allowed: boolean; disabled: boolean; path: string; noun: string;
  selection: Selection; setSelection: (selection: Selection) => void; label?: (id: string) => string;
  onDeleted: (ids: string[]) => void | Promise<void>; onDenied?: (cause: ApiError) => void;
};

export function useMasterDataBulkDelete(options: Options) {
  const { locale } = useLanguage();
  const text = (zh: string, en: string) => locale === 'en-US' ? en : zh;
  const noun = locale === 'en-US' ? ({ '供应商档案': 'supplier profiles', '客户档案': 'customer profiles', '物料': 'materials', '组件项目映射': 'component mappings' }[options.noun] ?? options.noun) : options.noun;
  const epoch = useLedgerSessionEpoch();
  const scope = useRef({ organizationId: options.organizationId, epoch, allowed: options.allowed, generation: 0 });
  if (scope.current.organizationId !== options.organizationId || scope.current.epoch !== epoch || scope.current.allowed !== options.allowed) {
    scope.current = { organizationId: options.organizationId, epoch, allowed: options.allowed, generation: scope.current.generation + 1 };
  }
  const generation = scope.current.generation;
  const mounted = useRef(false);
  const controller = useRef<AbortController | undefined>(undefined);
  const mutation = useRef(createAdminMutation({ replayAfterReauthentication: false }));
  const pending = useRef<number | undefined>(undefined);
  const labels = useRef<Record<string, string>>({});
  const [command, setCommand] = useState<Body>();
  const [deleting, setDeleting] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [error, setError] = useState<unknown>();
  const [result, setResult] = useState<Result>();
  const current = () => mounted.current && generation === scope.current.generation && epoch === getLedgerSessionEpoch() && options.allowed;
  const busy = deleting || unknown;
  const locked = busy || Boolean(command);
  useNavigationBusy(busy);
  useEffect(() => {
    mounted.current = true;
    controller.current = new AbortController();
    mutation.current = createAdminMutation({ replayAfterReauthentication: false });
    setCommand(undefined); setDeleting(false); setUnknown(false); setError(undefined); setResult(undefined);
    options.setSelection({});
    return () => { mounted.current = false; controller.current?.abort(); };
  }, [generation]);

  function rowSelection<Row extends RecordVersion>(rows: Row[], preserveSelectedRowKeys = false): TableProps<Row>['rowSelection'] {
    if (!options.allowed) return undefined;
    const selectedIds = Object.keys(options.selection);
    const disabled = options.disabled || locked || !current();
    const all = rows.length > 0 && rows.every(row => selectedIds.includes(row.id));
    function select(keys: readonly Key[]) {
      if (disabled || keys.length > 1000) return;
      const next: Selection = {};
      for (const key of keys) {
        const id = String(key);
        const row = options.selection[id] ?? rows.find(item => item.id === id);
        if (row) next[id] = { id, version: row.version };
      }
      options.setSelection(next);
    }
    return {
      selectedRowKeys: selectedIds, preserveSelectedRowKeys,
      onChange: select,
      getCheckboxProps: row => ({ disabled: disabled || !options.selection[row.id] && selectedIds.length >= 1000 }),
      columnTitle: <input type="checkbox" aria-label={text('选择当前页', 'Select current page')} disabled={disabled || !all && new Set([...selectedIds, ...rows.map(row => row.id)]).size > 1000}
        checked={all} ref={node => { if (node) node.indeterminate = !all && rows.some(row => selectedIds.includes(row.id)); }}
        onChange={event => select(event.target.checked ? preserveSelectedRowKeys ? [...new Set([...selectedIds, ...rows.map(row => row.id)])] : rows.map(row => row.id) : preserveSelectedRowKeys ? selectedIds.filter(id => !rows.some(row => row.id === id)) : [])} />,
    };
  }
  function confirm() {
    const records = Object.values(options.selection).map(row => ({ id: row.id, expectedVersion: row.version }));
    if (!current() || options.disabled || locked || !records.length || records.length > 1000) return;
    setError(undefined); setResult(undefined);
    labels.current = Object.fromEntries(records.map(row => [row.id, options.label?.(row.id) ?? row.id]));
    setCommand({ ...(options.organizationId ? { organizationId: options.organizationId } : {}), records });
  }
  async function execute() {
    if (!command || !current() || pending.current === generation) return;
    pending.current = generation; setDeleting(true); setError(undefined);
    try {
      const ids = command.records.map(item => item.id);
      const next = await mutation.current<Result>(options.path, 'POST', command, controller.current?.signal, value => {
        if (!Array.isArray(value.items) || value.items.length !== ids.length || new Set(value.items.map(row => row.id)).size !== ids.length || value.items.some(row => !ids.includes(row.id) || !['DELETED', 'REFERENCED', 'CONFLICT', 'NOT_FOUND'].includes(row.status))) throw new Error('Invalid deletion result');
        for (const [field, status] of [['deleted', 'DELETED'], ['referenced', 'REFERENCED'], ['conflicted', 'CONFLICT'], ['notFound', 'NOT_FOUND']] as const) {
          if (value[field] !== value.items.filter(row => row.status === status).length) throw new Error('Invalid deletion counts');
        }
      });
      if (!current()) return;
      const deleted = next.items.filter(row => row.status === 'DELETED').map(row => row.id);
      options.setSelection(Object.fromEntries(Object.entries(options.selection).filter(([id]) => !deleted.includes(id))));
      setResult(next); setUnknown(false); setCommand(undefined);
      if (deleted.length) { try { await options.onDeleted(deleted); } catch (cause) { if (current()) setError(cause); } }
    } catch (cause) {
      if (!current()) return;
      const known = !unknown && cause instanceof ApiError && (cause.code === 'CLIENT_REAUTHENTICATION_COMPLETED' || cause.status !== undefined && cause.status >= 400 && cause.status < 500 && ![408, 425].includes(cause.status));
      setError(cause); setUnknown(!known);
      if (known) setCommand(undefined);
      if (cause instanceof ApiError && cause.code !== 'AUTH_REAUTHENTICATION_REQUIRED' && [401, 403].includes(cause.status ?? 0)) { options.setSelection({}); options.onDenied?.(cause); }
    } finally { if (pending.current === generation) pending.current = undefined; if (current()) setDeleting(false); }
  }
  const count = Object.keys(options.selection).length;
  const errorText = unknown ? text('删除结果未确认，请使用原请求重试；期间请勿离开页面。', 'Deletion result is unknown. Retry the original request; do not leave this page.') : error instanceof ApiError && error.code === 'CLIENT_REAUTHENTICATION_COMPLETED' ? text('身份验证已完成，请重新提交删除操作', 'Reauthentication completed. Submit the deletion again.') : safeAccountError(error);
  const feedback = current() ? <>
    {error && <Alert type="error" showIcon title={errorText} description={error instanceof ApiError ? error.traceId : undefined} />}
    {result && <div role="status" className="qms-master-delete-results"><strong>{text('删除结果', 'Deletion results')}</strong><ul>{result.items.map(row => <li key={row.id}>{labels.current[row.id] ?? row.id}：{row.status === 'DELETED' ? text('已删除', 'Deleted') : row.status === 'CONFLICT' ? text('版本已变化，请刷新后重新选择', 'Version changed. Refresh and select again.') : row.status === 'REFERENCED' ? text('仍有业务引用，不能删除', 'Still referenced; cannot delete') : text('记录不存在或不可删除', 'Record unavailable or cannot be deleted')}</li>)}</ul></div>}
  </> : null;
  const controls = current() ? <>
    {count > 0 && <div role="toolbar" aria-label={text(`已选${options.noun}`, `Selected ${noun}`)} className="qms-master-delete-bar">
      <span>{text(`已选择 ${count} 条`, `${count} selected`)}</span>
      <Button disabled={locked || options.disabled} onClick={() => options.setSelection({})}>{text('取消选择', 'Clear selection')}</Button>
      <Button danger disabled={locked || options.disabled} onClick={confirm}>{text('删除所选', 'Delete selected')}</Button>
    </div>}
    <Modal title={text(`删除${options.noun}`, `Delete ${noun}`)} open={Boolean(command)} onCancel={() => { if (!busy) setCommand(undefined); }}
      closable={!busy} keyboard={!busy} mask={{ closable: !busy }} cancelButtonProps={{ disabled: busy, 'aria-label': text('取消', 'Cancel') }}
      okText={text(unknown ? '重试删除' : '删除', unknown ? 'Retry delete' : 'Delete')} cancelText={text('取消', 'Cancel')}
      okButtonProps={{ danger: true, loading: deleting, 'aria-label': text(unknown ? '重试删除' : '删除', unknown ? 'Retry delete' : 'Delete') }} onOk={() => void execute()}>
      <p>{text(`确认删除选中的 ${command?.records.length ?? 0} 条${options.noun}？删除后不可恢复。`, `Delete ${command?.records.length ?? 0} selected ${noun}? This cannot be undone.`)}</p>
      {unknown && <Alert type="error" showIcon title={errorText} />}
    </Modal>
  </> : null;
  return { busy: locked, rowSelection, feedback, controls, selectedClass: count ? 'qms-master-delete--selected' : undefined };
}
