import { Alert, Button, Space, Table, Typography } from 'antd';
import type { components } from '@qms/contracts';
import { useEffect, useRef, useState } from 'react';
import { apiRequest, csrfToken, safeAccountError } from '../../api/client';
import { readXlsxFile } from '../imports/read-xlsx';
import { useLanguage } from '../../i18n/Language';

type ImportBody = components['schemas']['MaterialMasterImportDto'];
type Result = components['schemas']['MaterialMasterImportResultDto'];
type Props = { organizationId?: string; onImported: () => void | Promise<void> };
const headers = ['物料编码', '物料名称'];
const statuses = { CREATED: '新增成功', SKIPPED_DUPLICATE: '重复跳过', FAILED: '失败' };

export function parseMaterialMasterRows(sheet: readonly (readonly unknown[])[], t = (text: string) => text): ImportBody['rows'] {
  const columns = Array.from(sheet[0] ?? [], (cell) => typeof cell === 'string' ? headers.find((header) => header === cell.trim() || t(header) === cell.trim()) ?? '' : '');
  if (columns.length !== 2 || headers.some((header) => !columns.includes(header))) throw new Error(t('表头必须且只能包含物料编码、物料名称'));
  const rows: ImportBody['rows'] = [];
  for (let index = 1; index < sheet.length; index++) {
    const cells = sheet[index] ?? [];
    if (cells.every((cell) => cell == null || cell === '')) continue;
    const code = cells[columns.indexOf(headers[0]!)];
    const name = cells[columns.indexOf(headers[1]!)];
    if (cells.some((cell, column) => (column > 1 && cell != null && cell !== '') || (cell != null && typeof cell === 'object'))) throw new Error(t('第 {row} 行：不支持公式或额外数据列').replace('{row}', String(index + 1)));
    rows.push({ rowNumber: index + 1, materialCode: typeof code === 'string' ? code.trim() : '', materialName: typeof name === 'string' ? name.trim() : '' });
  }
  if (!rows.length || rows.length > 100) throw new Error(t('每次需要 1–100 条非空数据行'));
  return rows;
}

export function MaterialMasterImport(props: Props) {
  return <ImportForm key={props.organizationId ?? 'current'} {...props} />;
}

function ImportForm({ organizationId, onImported }: Props) {
  const { t } = useLanguage();
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
      const parsed = parseMaterialMasterRows(await readXlsxFile(file), t);
      if (mounted.current && request === fileRequest.current) setRows(parsed);
    } catch (cause) { if (mounted.current && request === fileRequest.current) setError(cause instanceof Error ? cause.message : t('Excel 文件无法解析')); }
  }
  async function downloadTemplate() {
    setError(undefined);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet(t('物料'));
      sheet.addRow(headers.map(t)); sheet.columns.forEach((column) => { column.width = 24; column.numFmt = '@'; });
      const bytes = await workbook.xlsx.writeBuffer();
      if (!mounted.current) return;
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const link = document.createElement('a'); link.href = url; link.download = `${t('物料导入模板')}.xlsx`; link.click(); URL.revokeObjectURL(url);
    } catch { if (mounted.current) setError(t('模板下载失败，请重试')); }
  }
  async function submit() {
    if (inFlight.current || !rows.length || result) return;
    inFlight.current = true; setBusy(true); setError(undefined);
    const body: ImportBody = { ...(organizationId ? { organizationId } : {}), rows };
    const signature = JSON.stringify(body);
    if (pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
    const key = pending.current.key;
    try {
      const response = await apiRequest<Result>('/api/v1/material-masters/import', { method: 'POST', headers: { 'x-csrf-token': await csrfToken(), 'Idempotency-Key': key }, body: signature });
      if (mounted.current) { setResult(response); pending.current = undefined; await onImported(); }
    } catch (cause) { if (mounted.current) setError(safeAccountError(cause)); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  return <section aria-label={t('物料批量新增')}>
    <Typography.Paragraph>{t('只新增物料编码和名称；重复编码跳过，不覆盖已有名称。每次最多 100 行，编码请使用文本保留前导 0。')}</Typography.Paragraph>
    <Space wrap><Button onClick={() => void downloadTemplate()}>{t('下载物料模板')}</Button><input aria-label={t('物料清单文件')} type="file" accept=".xlsx" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void readFile(file); }} /><Button onClick={() => void submit()} loading={busy} disabled={busy || !rows.length || Boolean(result)}>{t('导入物料')}</Button></Space>
    {error ? <Alert showIcon type="error" title={t(error)} /> : null}
    {rows.length > 0 ? <Table rowKey="rowNumber" size="small" scroll={{ x: true }} dataSource={rows} pagination={false} columns={[{ title: t('行号'), dataIndex: 'rowNumber' }, { title: t('物料编码'), dataIndex: 'materialCode' }, { title: t('物料名称'), dataIndex: 'materialName' }, { title: t('校验提示'), render: (_, row) => !row.materialCode ? t('编码需文本；该行将交由服务器校验。') : '' }]} /> : null}
    {result ? <><Alert type={result.failed ? 'warning' : 'success'} title={t('新增 {created}，重复跳过 {skipped}，失败 {failed}').replace('{created}', String(result.created)).replace('{skipped}', String(result.skipped)).replace('{failed}', String(result.failed))} /><Table rowKey="rowNumber" size="small" scroll={{ x: true }} dataSource={result.items} pagination={false} columns={[{ title: t('行号'), dataIndex: 'rowNumber' }, { title: t('物料编码'), dataIndex: 'code' }, { title: t('结果'), dataIndex: 'status', render: (status: Result['items'][number]['status']) => t(statuses[status]) }, { title: t('说明'), render: (_, row) => row.status === 'FAILED' ? t('该行未新增，请检查编码和名称后重新上传') : '' }]} /></> : null}
  </section>;
}
