import { Alert, Button, Space, Table, Typography } from 'antd';
import type { components } from '@qms/contracts';
import { useEffect, useRef, useState } from 'react';
import { apiRequest, csrfToken, safeAccountError } from '../../api/client';
import { readXlsxFile } from '../imports/read-xlsx';
import { scopePath } from './admin';
import { useLanguage } from '../../i18n/Language';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';

type Row = components['schemas']['AdminUserBatchRowDto'];
type Body = components['schemas']['CreateAdminUserBatchDto'];
type Result = components['schemas']['AdminUserBatchResultDto'];
type ResultRow = Result['rows'][number];
type TemporaryPassword = components['schemas']['TemporaryPasswordDto'];
const headers = ['用户名', '邮箱', '账号类型'] as const;
const cell = (value: unknown) => value == null ? '' : String(value).trim();

export function parseUserBatchRows(sheet: readonly (readonly unknown[])[]): Row[] {
  const columns = Array.from(sheet[0] ?? [], cell);
  if (columns.length !== headers.length || headers.some((header, index) => columns[index] !== header)) throw new Error('表头必须为用户名、邮箱、账号类型');
  const rows: Row[] = [];
  for (let index = 1; index < sheet.length; index += 1) {
    const values = sheet[index] ?? [];
    if (values.every((value) => cell(value) === '')) continue;
    if (values.some((value, column) => (column >= headers.length && value != null && value !== '') || (value != null && typeof value === 'object') || (typeof value === 'string' && /^[=+\-@]/.test(value.trim())))) throw new Error(`第 ${index + 1} 行：不支持公式、对象或额外数据列`);
    const [username, email, accountType] = values.map(cell);
    rows.push({ rowNumber: index + 1, username: username ?? '', email: email || null, accountType: accountType ?? '' });
  }
  if (!rows.length || rows.length > 100) throw new Error('每次需要 1–100 条非空数据行');
  return rows;
}

function safeCell(value: string) { return /^[=+\-@]/.test(value) ? `'${value}` : value; }

export function UserBatchCreate({ organizationId, canReadPasswords = true }: { organizationId: string; canReadPasswords?: boolean }) {
  const identity = useWorkTabsStore((state) => state.sessionScope);
  return <BatchForm key={`${identity}:${organizationId}:${canReadPasswords}`} organizationId={organizationId} canReadPasswords={canReadPasswords} />;
}

function BatchForm({ organizationId, canReadPasswords }: { organizationId: string; canReadPasswords: boolean }) {
  const { t } = useLanguage();
  const [rows, setRows] = useState<Row[]>([]);
  const [result, setResult] = useState<Result>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const requestVersion = useRef(0);
  const pending = useRef<{ signature: string; key: string } | undefined>(undefined);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; requestVersion.current++; }; }, []);
  async function readFile(file: File) {
    const version = ++requestVersion.current;
    setRows([]); setResult(undefined); setError(undefined); pending.current = undefined;
    try { const parsed = parseUserBatchRows(await readXlsxFile(file)); if (mounted.current && version === requestVersion.current) setRows(parsed); }
    catch (cause) { if (mounted.current && version === requestVersion.current) setError(cause instanceof Error ? cause.message : 'Excel 文件无法解析'); }
  }
  async function submit() {
    if (inFlight.current || !rows.length || result) return;
    inFlight.current = true;
    setBusy(true); setError(undefined);
    try {
      const body: Body = { organizationId, rows };
      const signature = JSON.stringify(body);
      if (pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
      const response = await apiRequest<Result>('/api/v1/admin/users/batch', { method: 'POST', headers: { 'x-csrf-token': await csrfToken(), 'Idempotency-Key': pending.current.key }, body: signature });
      if (mounted.current) setResult(response);
    } catch (cause) { if (mounted.current) setError(safeAccountError(cause)); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  async function currentPassword(row: ResultRow): Promise<TemporaryPassword> {
    if (!row.userId || !canReadPasswords) throw new Error('无权读取临时密码');
    const current = await apiRequest<TemporaryPassword>(scopePath(`users/${row.userId}/temporary-password/read`, organizationId), { method: 'POST', headers: { 'x-csrf-token': await csrfToken() }, body: '{}' });
    if (!mounted.current) throw new Error('页面已关闭');
    setResult((previous) => previous && ({ ...previous, rows: previous.rows.map((item) => item.userId === row.userId ? { ...item, temporaryPassword: current } : item) }));
    return current;
  }
  async function copy(row: ResultRow, password: boolean) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(undefined);
    try {
      const refreshed = password ? await currentPassword(row) : undefined;
      if (refreshed && refreshed.status !== 'AVAILABLE') return;
      const value = refreshed?.temporaryPassword ?? row.username;
      if (!value) throw new Error('临时密码已失效');
      if (mounted.current) await navigator.clipboard.writeText(value);
    } catch (cause) {
      if (mounted.current) {
        setResult((previous) => previous && ({ ...previous, rows: previous.rows.map((item) => item.userId === row.userId ? { ...item, temporaryPassword: { userId: item.userId ?? '', status: 'UNAVAILABLE' } } : item) }));
        setError(safeAccountError(cause));
      }
    }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  async function saveWorkbook(values: (string | number)[][], name: string) {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('账号');
    values.forEach((row) => sheet.addRow(row));
    sheet.columns.forEach((column) => { column.width = 28; column.numFmt = '@'; });
    const bytes = await workbook.xlsx.writeBuffer();
    if (!mounted.current) return;
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
  }
  async function template() {
    try { await saveWorkbook([[...headers], ['example.user', '', 'INTERNAL']], '账号导入模板.xlsx'); }
    catch { if (mounted.current) setError('模板下载失败，请重试'); }
  }
  async function download(passwordsOnly: boolean) {
    if (!result || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(undefined);
    try {
      const values: (string | number)[][] = [passwordsOnly ? ['行号', '用户名', '临时密码'] : ['行号', '用户名', '状态', '错误']];
      for (const row of result.rows) {
        if (passwordsOnly) {
          if (row.status !== 'SUCCESS') continue;
          const current = await currentPassword(row);
          if (current.status === 'AVAILABLE' && current.temporaryPassword) values.push([row.rowNumber, safeCell(row.username), safeCell(current.temporaryPassword)]);
        } else values.push([row.rowNumber, safeCell(row.username), row.status, safeCell(row.code ?? '')]);
      }
      await saveWorkbook(values, passwordsOnly ? '有效临时密码.xlsx' : '账号清单.xlsx');
    } catch (cause) { if (mounted.current) setError(safeAccountError(cause)); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  return <section aria-label="批量创建账号">
    <Typography.Paragraph>上传首表，按行创建内部账号。有效临时密码仅在当前受保护页面显示，不写入浏览器存储。</Typography.Paragraph>
    <Typography.Paragraph>{t('临时密码有效期为 7 天；改密或到期后不可再查询。已下载到本机的文件无法撤回，请安全保管。')}</Typography.Paragraph>
    <Space wrap><Button disabled={busy} onClick={() => void template()}>{t('下载账号模板')}</Button><input aria-label={t('账号清单文件')} type="file" accept=".xlsx" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void readFile(file); }} /><Button type="primary" loading={busy} disabled={!rows.length || busy || Boolean(result)} onClick={() => void submit()}>{t('创建账号')}</Button>{result && <><Button disabled={busy} onClick={() => void download(false)}>{t('下载账号清单')}</Button>{canReadPasswords && <Button disabled={busy} onClick={() => void download(true)}>{t('下载有效临时密码')}</Button>}</>}</Space>
    {error && <Alert showIcon type="error" title={error} />}
    {rows.length > 0 && !result && <Table rowKey="rowNumber" size="small" pagination={false} dataSource={rows} columns={[{ title: '行号', dataIndex: 'rowNumber' }, { title: '用户名', dataIndex: 'username' }, { title: '邮箱', dataIndex: 'email' }, { title: '账号类型', dataIndex: 'accountType' }]} />}
    {result && <Table<ResultRow> rowKey="rowNumber" size="small" scroll={{ x: 750 }} pagination={false} dataSource={result.rows} columns={[{ title: t('行号'), dataIndex: 'rowNumber' }, { title: t('用户名'), render: (_, row) => <Space>{row.username}<Button disabled={busy} onClick={() => void copy(row, false)}>{t('复制账号')}</Button></Space> }, { title: t('结果'), render: (_, row) => row.status === 'SUCCESS' ? t('成功') : `${t('失败')} · ${row.code ?? ''}` }, { title: t('临时密码'), render: (_, row) => row.temporaryPassword?.status === 'AVAILABLE' ? <Space><code>{row.temporaryPassword.temporaryPassword}</code><Button disabled={busy} size="small" onClick={() => void copy(row, true)}>{t('复制临时密码')}</Button></Space> : t(row.temporaryPassword?.status === 'EXPIRED' ? '已过期' : '不可用') }]} />}
  </section>;
}
