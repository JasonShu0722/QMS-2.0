import { Alert, Button, Space, Table, Typography } from 'antd';
import type { components } from '@qms/contracts';
import { useEffect, useRef, useState } from 'react';
import { apiRequest, csrfToken, safeAccountError } from '../../api/client';
import { readXlsxFile } from '../imports/read-xlsx';

type ImportBody = components['schemas']['CustomerMasterImportDto'];
type Result = components['schemas']['CustomerMasterImportResultDto'];
type Props = { organizationId?: string; onImported: () => void | Promise<void> };
const headers = ['客户编码', '客户名称'];
const statuses = { CREATED: '新增成功', SKIPPED_DUPLICATE: '重复跳过', FAILED: '失败' };

export function parseCustomerMasterRows(sheet: readonly (readonly unknown[])[]): ImportBody['rows'] {
  const columns = Array.from(sheet[0] ?? [], (cell) => typeof cell === 'string' ? cell.trim() : '');
  if (columns.length !== 2 || headers.some((header) => !columns.includes(header))) throw new Error('表头必须且只能包含客户编码、客户名称');
  const rows: ImportBody['rows'] = [];
  for (let index = 1; index < sheet.length; index++) {
    const cells = sheet[index] ?? [];
    if (cells.every((cell) => cell == null || cell === '')) continue;
    const code = cells[columns.indexOf(headers[0]!)];
    const name = cells[columns.indexOf(headers[1]!)];
    if (cells.some((cell, column) => column > 1 && cell != null && cell !== '') || typeof code !== 'string' || typeof name !== 'string' || !code.trim() || !name.trim() || code.trim().length > 100 || name.trim().length > 200) throw new Error(`第 ${index + 1} 行：客户编码和名称需为文本且必填（编码最多 100 字、名称最多 200 字），不支持公式或额外数据列`);
    rows.push({ rowNumber: index + 1, code: code.trim(), name: name.trim() });
  }
  if (!rows.length || rows.length > 100) throw new Error('每次需要 1–100 条非空数据行');
  return rows;
}

export function CustomerMasterImport(props: Props) {
  return <ImportForm key={props.organizationId ?? 'current'} {...props} />;
}

function ImportForm({ organizationId, onImported }: Props) {
  const [rows, setRows] = useState<ImportBody['rows']>([]);
  const [result, setResult] = useState<Result>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ signature: string; key: string } | undefined>(undefined);
  const inFlight = useRef(false);
  const fileRequest = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; fileRequest.current++; }; }, []);

  async function readFile(file: File) {
    const request = ++fileRequest.current;
    setRows([]); setResult(undefined); setError(undefined);
    try {
      const parsed = parseCustomerMasterRows(await readXlsxFile(file));
      if (mounted.current && request === fileRequest.current) setRows(parsed);
    } catch (cause) { if (mounted.current && request === fileRequest.current) setError(cause instanceof Error ? cause.message : 'Excel 文件无法解析'); }
  }
  async function downloadTemplate() {
    setError(undefined);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('客户');
      sheet.addRow(headers); sheet.columns.forEach((column) => { column.width = 24; column.numFmt = '@'; });
      const bytes = await workbook.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const link = document.createElement('a'); link.href = url; link.download = '客户导入模板.xlsx'; link.click(); URL.revokeObjectURL(url);
    } catch { if (mounted.current) setError('模板下载失败，请重试'); }
  }
  async function submit() {
    if (inFlight.current || !rows.length || result) return;
    inFlight.current = true; setBusy(true); setError(undefined);
    const body: ImportBody = { ...(organizationId ? { organizationId } : {}), rows };
    const signature = JSON.stringify(body);
    if (pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
    const key = pending.current.key;
    try {
      const response = await apiRequest<Result>('/api/v1/customer-quality/customers/import', { method: 'POST', headers: { 'x-csrf-token': await csrfToken(), 'Idempotency-Key': key }, body: signature });
      if (mounted.current) { setResult(response); pending.current = undefined; await onImported(); }
    } catch (cause) { if (mounted.current) setError(safeAccountError(cause)); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  return <section aria-label="客户批量新增">
    <Typography.Paragraph>只新增客户编码和名称；重复编码跳过，不覆盖已有名称或关系。每次最多 100 行，编码请使用文本保留前导 0。</Typography.Paragraph>
    <Space wrap><Button onClick={() => void downloadTemplate()}>下载客户模板</Button><input aria-label="客户清单文件" type="file" accept=".xlsx" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void readFile(file); }} /><Button onClick={() => void submit()} loading={busy} disabled={busy || !rows.length || Boolean(result)}>导入客户</Button></Space>
    {error ? <Alert showIcon type="error" title={error} /> : null}
    {rows.length > 0 ? <Table rowKey="rowNumber" size="small" scroll={{ x: true }} dataSource={rows} pagination={false} columns={[{ title: '行号', dataIndex: 'rowNumber' }, { title: '客户编码', dataIndex: 'code' }, { title: '客户名称', dataIndex: 'name' }]} /> : null}
    {result ? <><Alert type={result.failed ? 'warning' : 'success'} title={`新增 ${result.created}，重复跳过 ${result.skipped}，失败 ${result.failed}`} /><Table rowKey="rowNumber" size="small" scroll={{ x: true }} dataSource={result.items} pagination={false} columns={[{ title: '行号', dataIndex: 'rowNumber' }, { title: '客户编码', dataIndex: 'code' }, { title: '结果', dataIndex: 'status', render: (status: Result['items'][number]['status']) => statuses[status] }, { title: '说明', render: (_, row) => row.status === 'FAILED' ? '该行未新增，请检查编码和名称后重新上传' : '' }]} /></> : null}
  </section>;
}
