import { Alert, Button, Popconfirm, Space, Table, Tag, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, csrfToken, safeAccountError } from '../../api/client';
import { auditImportFields, readAuditImportWorkbook, type AuditImportInput } from './audit-management-import';

type ImportBody = components['schemas']['ImportAuditRowDto'];
type ImportResult = components['schemas']['AuditImportRowResponseDto'];
type PreviewRow = AuditImportInput & { key: string; state: 'READY' | 'INVALID' | 'SUCCESS' | 'RETRY' | 'REJECTED'; message?: string };

function denied(cause: unknown) { return cause instanceof ApiError && (cause.status === 401 || cause.status === 403); }
function rowError(cause: unknown) {
  if (!(cause instanceof ApiError)) return '结果未知，请使用原请求重试';
  if (cause.code === 'AUDIT_IMPORT_DUPLICATE') return '外部键已存在，请在导入台账核对；本行未导入';
  if (cause.status === 409) return '请求发生冲突，请核对外部键和原请求；本行未导入';
  return safeAccountError(cause);
}

export function AuditExcelImport({ organizationId, onImported, onDenied }: {
  organizationId: string; onImported: () => void; onDenied: (cause: unknown) => void;
}) {
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const selection = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const active = useRef(false);
  const hasPending = rows.some((row) => ['READY', 'RETRY'].includes(row.state));
  const dirty = rows.some((row) => row.state !== 'SUCCESS');

  useEffect(() => () => { mounted.current = false; selection.current += 1; }, []);

  function clear() {
    selection.current += 1;
    setRows([]);
    setError(undefined);
    if (input.current) input.current.value = '';
  }

  async function selectFile(file?: File) {
    if (!file || busy) return;
    const requestId = ++selection.current;
    setLoading(true);
    setError(undefined);
    setRows([]);
    try {
      const parsed = await readAuditImportWorkbook(file);
      if (!mounted.current || selection.current !== requestId) return;
      if (parsed.errors.some((issue) => issue.rowNumber === 1)) {
        setError(parsed.errors.filter((issue) => issue.rowNumber === 1).map((issue) => `${issue.field}：${issue.message}`).join('；'));
      }
      setRows(parsed.rows.map((row) => {
        const errors = parsed.errors.filter((issue) => issue.rowNumber === row.rowNumber || issue.rowNumber === 1);
        return { ...row, key: crypto.randomUUID(), state: errors.length ? 'INVALID' : 'READY', message: errors.map((issue) => `${issue.field}：${issue.message}`).join('；') };
      }));
    } catch (cause) { if (mounted.current && selection.current === requestId) setError(cause instanceof Error ? cause.message : '文件解析失败'); }
    finally { if (mounted.current && selection.current === requestId) setLoading(false); }
  }

  async function submit() {
    if (active.current || blocked || loading || !hasPending) return;
    active.current = true;
    setBusy(true);
    let succeeded = false;
    let accessDenied = false;
    try {
      for (const row of rows) {
        if (!mounted.current || !['READY', 'RETRY'].includes(row.state)) continue;
        try {
          const body: ImportBody = { organizationId, sourceSystem: row.sourceSystem, externalKey: row.externalKey, payload: row.payload };
          await apiRequest<ImportResult>('/api/v1/audit-management/imports', {
            method: 'POST', headers: { 'x-csrf-token': await csrfToken(), 'Idempotency-Key': row.key }, body: JSON.stringify(body),
          });
          succeeded = true;
          if (mounted.current) setRows((current) => current.map((item) => item.key === row.key ? { ...item, state: 'SUCCESS', message: undefined } : item));
        } catch (cause) {
          if (denied(cause)) {
            accessDenied = true;
            if (mounted.current) { clear(); setBlocked(true); setError('导入权限已失效，请重新获取权限后再操作'); onDenied(cause); }
            break;
          }
          const rejected = cause instanceof ApiError && cause.status !== undefined && cause.status < 500;
          if (mounted.current) {
            setRows((current) => current.map((item) => item.key === row.key ? { ...item, state: rejected ? 'REJECTED' : 'RETRY', message: rowError(cause) } : item));
          }
        }
      }
    } finally {
      active.current = false;
      if (mounted.current) {
        setBusy(false);
        if (succeeded && !accessDenied) onImported();
      }
    }
  }

  function submitFromButton() {
    if (rows.some((row) => row.state === 'RETRY')) active.current = false;
    void submit();
  }

  return <section className="audit-excel-import" aria-label="审核 Excel 导入">
    <Typography.Title level={4}>Excel 逐行导入</Typography.Title>
    <Typography.Paragraph type="secondary">支持 .xlsx，最多 2 MB、100 行。必填列：sourceSystem、externalKey、finding。客户或二方来源键保存在 customerKey，供复核追溯。错误行保留反馈，成功行不重复提交。</Typography.Paragraph>
    <Typography.Paragraph type="secondary">可用列：{auditImportFields.join('、')}。来源使用 CUSTOMER 或 SECOND_PARTY；日期时间带时区。</Typography.Paragraph>
    <Space wrap>
      <input ref={input} type="file" aria-label="审核 Excel 文件" accept=".xlsx" disabled={busy || loading || blocked || rows.length > 0} onChange={(event) => void selectFile(event.target.files?.[0])} />
      {rows.length > 0 ? <Popconfirm title={dirty ? '清除预览将丢失未成功行的重试记录。确定清除？' : '确定清除预览？'} onConfirm={clear} disabled={busy}><Button disabled={busy}>清除预览</Button></Popconfirm> : null}
      <Button type="primary" disabled={!hasPending || blocked} onClick={submitFromButton}>{rows.some((row) => row.state === 'RETRY') ? '重试未成功行' : '导入待处理行'}</Button>
    </Space>
    {error ? <Alert type="error" showIcon title={error} /> : null}
    {rows.length ? <Table<PreviewRow> rowKey="key" size="small" dataSource={rows} pagination={false} scroll={{ x: 780 }} columns={[
      { title: 'Excel 行', dataIndex: 'rowNumber', width: 80 },
      { title: '来源', dataIndex: 'sourceSystem', width: 110 },
      { title: '外部键', dataIndex: 'externalKey', width: 160 },
      { title: '发现', render: (_, row) => String((row.payload as Record<string, unknown>).finding ?? ''), ellipsis: true },
      { title: '结果', width: 260, render: (_, row) => <Space orientation="vertical" size={0}><Tag color={row.state === 'SUCCESS' ? 'green' : ['INVALID', 'REJECTED'].includes(row.state) ? 'red' : 'orange'}>{({ READY: '待导入', INVALID: '校验失败', SUCCESS: '已导入', RETRY: '待重试', REJECTED: '服务端拒绝' })[row.state]}</Tag>{row.message ? <Typography.Text type="secondary">{row.message}</Typography.Text> : null}</Space> },
    ]} /> : null}
  </section>;
}
