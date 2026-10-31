import { Alert, Button, Space, Table, Typography } from 'antd';
import type { components } from '@qms/contracts';
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest, csrfToken, safeAccountError } from '../../api/client';
import { readXlsxFile } from '../imports/read-xlsx';
import { scopePath } from './admin';
import { useLanguage } from '../../i18n/Language';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { useNavigationBusy, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { loadPositionDirectory, previewPositions, type AuthorizationPreview } from './position-authorization';

type Row = components['schemas']['AdminUserBatchRowDto'];
type Body = components['schemas']['CreateAdminUserBatchDto'];
type Result = components['schemas']['AdminUserBatchResultDto'];
type ResultRow = Result['rows'][number];
type TemporaryPassword = components['schemas']['TemporaryPasswordDto'];
type ParsedRow = Row & { positionCodes: string[] };
const headers = ['用户名', '邮箱', '账号类型', '岗位代码'] as const;
const cell = (value: unknown) => value == null ? '' : String(value).trim();
// Rejected previews must remain uncommittable even if permissions change before submit.
const rejectedPreviewBaseline = 'POSITION_PREVIEW_REJECTED';

export function parseUserBatchRows(sheet: readonly (readonly unknown[])[]): ParsedRow[] {
  const columns = Array.from(sheet[0] ?? [], cell);
  if (columns.length !== headers.length || headers.some((header, index) => columns[index] !== header)) throw new Error('请使用包含岗位代码的新版模板');
  const rows: ParsedRow[] = [];
  for (let index = 1; index < sheet.length; index += 1) {
    const values = sheet[index] ?? [];
    if (values.every((value) => cell(value) === '')) continue;
    if (values.some((value, column) => (column >= headers.length && value != null && value !== '') || (value != null && typeof value === 'object') || (typeof value === 'string' && /^[=+\-@]/.test(value.trim())))) throw new Error(`第 ${index + 1} 行：不支持公式、对象或额外数据列`);
    const [username, email, accountType, codes] = values.map(cell);
    const positionCodes = (codes ?? '').split(';').map(code => code.trim());
    rows.push({ rowNumber: index + 1, username: username ?? '', email: email || null, accountType: accountType ?? '', positionCodes });
  }
  if (!rows.length || rows.length > 100) throw new Error('每次需要 1–100 条非空数据行');
  return rows;
}

function safeCell(value: string) { return /^[=+\-@]/.test(value) ? `'${value}` : value; }

type BatchProps = { organizationId: string; canReadPasswords?: boolean; canAuthorize?: boolean; busyChanged?: (busy: boolean) => void };

export function UserBatchCreate({ organizationId, canReadPasswords = true, canAuthorize = true, busyChanged }: BatchProps) {
  const identity = useWorkTabsStore((state) => state.sessionScope);
  return <BatchForm key={`${identity}:${organizationId}:${canReadPasswords}:${canAuthorize}`} organizationId={organizationId} canReadPasswords={canReadPasswords} canAuthorize={canAuthorize} busyChanged={busyChanged} />;
}

function BatchForm({ organizationId, canReadPasswords, canAuthorize, busyChanged }: BatchProps & { canReadPasswords: boolean }) {
  const { t } = useLanguage();
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [prepared, setPrepared] = useState<Row[]>([]);
  const [previews, setPreviews] = useState<AuthorizationPreview[]>([]);
  const [prechecks, setPrechecks] = useState<Map<number, string>>(new Map());
  const [result, setResult] = useState<Result>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const requestVersion = useRef(0);
  const preparation = useRef<AbortController | undefined>(undefined);
  const pending = useRef<{ signature: string; key: string } | undefined>(undefined);
  useUnsavedChanges(rows.length > 0 && !result);
  useNavigationBusy(busy);
  function reportBusy(value: boolean) { setBusy(value); busyChanged?.(value); }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; requestVersion.current++; preparation.current?.abort(); }; }, []);
  useEffect(() => () => busyChanged?.(false), [busyChanged]);
  async function readFile(file: File) {
    if (inFlight.current || !canAuthorize || pending.current) return;
    const version = ++requestVersion.current;
    reportBusy(true);
    setRows([]); setPrepared([]); setPreviews([]); setPrechecks(new Map()); setResult(undefined); setError(undefined); pending.current = undefined;
    try {
      const parsed = parseUserBatchRows(await readXlsxFile(file));
      if (!mounted.current || version !== requestVersion.current) return;
      setRows(parsed);
      await prepare(parsed, version);
    } catch (cause) { if (mounted.current && version === requestVersion.current) setError(cause instanceof ApiError ? safeAccountError(cause) : cause instanceof Error ? cause.message : 'Excel 文件无法解析'); }
    finally { if (mounted.current && version === requestVersion.current) reportBusy(false); }
  }
  async function prepare(parsed: ParsedRow[], version = ++requestVersion.current) {
    if (!canAuthorize) return;
    preparation.current?.abort();
    const controller = new AbortController(); preparation.current = controller;
    const active = () => mounted.current && version === requestVersion.current;
    const directory = await loadPositionDirectory(organizationId, controller.signal);
    const checks = new Map<number, string>();
    const cache = new Map<string, AuthorizationPreview | string>();
    const next: Row[] = [];
    for (const row of parsed) {
      if (!active()) return;
      const preparedRow: Row = { rowNumber: row.rowNumber, username: row.username, email: row.email, accountType: row.accountType, positionIds: [], authorizationBaseline: rejectedPreviewBaseline };
      if (!row.positionCodes.length || row.positionCodes.some(code => !code) || row.positionCodes.length > 100 || new Set(row.positionCodes).size !== row.positionCodes.length) {
        checks.set(row.rowNumber, t('每行必须填写 1–100 个不重复的岗位代码，多个使用英文分号分隔'));
        next.push(preparedRow);
        continue;
      }
      const matches = row.positionCodes.map(code => directory.positions.filter(position => position.code === code && position.status === 'ACTIVE' && (position.departmentId === null || directory.departments.some(department => department.id === position.departmentId && department.status === 'ACTIVE'))));
      const invalid = matches.findIndex(positions => positions.length !== 1);
      const positionIds = invalid >= 0 ? [] : matches.map(positions => positions[0]!.id).sort();
      preparedRow.positionIds = positionIds;
      if (invalid >= 0) {
        checks.set(row.rowNumber, `${t('岗位代码不存在或不可用')} · ${row.positionCodes[invalid]}`);
        next.push(preparedRow);
        continue;
      }
      const signature = JSON.stringify(positionIds);
      let preview = cache.get(signature);
      if (preview === undefined) {
        try { preview = await previewPositions(organizationId, positionIds, undefined, controller.signal); }
        catch (cause) {
          if (!(cause instanceof ApiError) || cause.status !== 403 || cause.code !== 'POSITION_GRANT_CEILING_DENIED') throw cause;
          preview = safeAccountError(cause);
        }
        cache.set(signature, preview);
      }
      if (typeof preview === 'string') checks.set(row.rowNumber, preview);
      else preparedRow.authorizationBaseline = preview.authorizationBaseline;
      next.push(preparedRow);
    }
    if (active()) { setPrepared(next); setPreviews([...cache.values()].filter((preview): preview is AuthorizationPreview => typeof preview !== 'string')); setPrechecks(checks); pending.current = undefined; }
  }
  async function refreshPreview() {
    if (inFlight.current || !rows.length || !canAuthorize) return;
    inFlight.current = true; reportBusy(true); setError(undefined); setPrepared([]); setPreviews([]); setPrechecks(new Map());
    try { await prepare(rows); } catch (cause) { if (mounted.current) setError(cause instanceof ApiError ? safeAccountError(cause) : cause instanceof Error ? cause.message : safeAccountError(cause)); }
    finally { inFlight.current = false; if (mounted.current) reportBusy(false); }
  }
  async function submit() {
    if (inFlight.current || busy || !prepared.length || result || !canAuthorize) return;
    inFlight.current = true;
    reportBusy(true); setError(undefined);
    try {
      const body: Body = { organizationId, rows: prepared };
      const signature = JSON.stringify(body);
      if (pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
      const response = await apiRequest<Result>('/api/v1/admin/users/batch', { method: 'POST', headers: { 'x-csrf-token': await csrfToken(), 'Idempotency-Key': pending.current.key }, body: signature });
      if (mounted.current) { pending.current = undefined; setResult(response); }
    } catch (cause) { if (mounted.current) { setError(safeAccountError(cause)); if (cause instanceof ApiError && cause.status === 409) { setPrepared([]); setPreviews([]); } } }
    finally { inFlight.current = false; if (mounted.current) reportBusy(false); }
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
    inFlight.current = true; reportBusy(true); setError(undefined);
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
    finally { inFlight.current = false; if (mounted.current) reportBusy(false); }
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
    try { await saveWorkbook([[...headers], ['example.user', '', 'INTERNAL', 'QA;QE']], '账号导入模板.xlsx'); }
    catch { if (mounted.current) setError('模板下载失败，请重试'); }
  }
  async function download(passwordsOnly: boolean) {
    if (!result || inFlight.current) return;
    inFlight.current = true; reportBusy(true); setError(undefined);
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
    finally { inFlight.current = false; if (mounted.current) reportBusy(false); }
  }
  const precheckNote = (rowNumber: number) => prechecks.has(rowNumber) ? <Typography.Text type="warning">{t('本地预检')}：{prechecks.get(rowNumber)}</Typography.Text> : null;
  return <section aria-label={t('批量创建账号')}>
    <Typography.Paragraph>{t('读取首个工作表；岗位代码须匹配当前组织，多个岗位用英文分号分隔。')}</Typography.Paragraph>
    <Typography.Paragraph>{t('临时密码有效期为 7 天；改密或到期后不可再查询。已下载到本机的文件无法撤回，请安全保管。')}</Typography.Paragraph>
    {!canAuthorize && <Alert showIcon type="warning" title={t('缺少岗位授权所需权限，无法创建内部账号')} />}
    <Space wrap><Button disabled={busy} onClick={() => void template()}>{t('下载账号模板')}</Button><input aria-label={t('账号清单文件')} type="file" accept=".xlsx" disabled={busy || !canAuthorize || !!pending.current} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void readFile(file); }} /><Button type="primary" loading={busy} disabled={!prepared.length || busy || Boolean(result) || !canAuthorize} onClick={() => void submit()}>{t('创建账号')}</Button>{rows.length > 0 && !prepared.length && !result && <Button disabled={busy || !canAuthorize} onClick={() => void refreshPreview()}>{t('重新预览授权')}</Button>}{result && <><Button disabled={busy} onClick={() => void download(false)}>{t('下载账号清单')}</Button>{canReadPasswords && <Button disabled={busy} onClick={() => void download(true)}>{t('下载有效临时密码')}</Button>}</>}</Space>
    {error && <Alert showIcon type="error" title={t(error)} />}
    {previews.length > 0 && !result && <section aria-label={t('权限预览')}>{previews.map(preview => <div key={preview.authorizationBaseline}>
      <Typography.Text strong>{preview.positions.map(position => `${position.department?.name ?? t('组织直属')} · ${position.name} (${position.code})`).join('; ')}</Typography.Text>
      <Typography.Paragraph>{t('有效权限')}：{preview.effectivePermissionCodes.join(', ') || t('无系统权限')}</Typography.Paragraph>
      <Typography.Paragraph>{t('MFA 要求')}：{t(preview.effectiveMfaRequired ? '需要 MFA' : '不要求 MFA')}</Typography.Paragraph>
      {preview.positions.flatMap(position => position.historicalSources.map(source => <Typography.Paragraph key={`${position.id}:${source.roleId}`}>{t('历史兼容授权')} · {source.name} · {source.permissionCodes.join(', ') || t('无系统权限')}</Typography.Paragraph>))}
      {!preview.effectivePermissionCodes.length && <Alert showIcon type="warning" title={t('该岗位未配置系统权限')} />}
    </div>)}</section>}
    {rows.length > 0 && !result && <Table rowKey="rowNumber" size="small" pagination={false} scroll={{ x: 650 }} dataSource={rows} columns={[{ title: t('行号'), dataIndex: 'rowNumber' }, { title: t('用户名'), dataIndex: 'username' }, { title: t('邮箱'), dataIndex: 'email' }, { title: t('账号类型'), dataIndex: 'accountType' }, { title: t('岗位代码'), render: (_, row) => <Space orientation="vertical">{row.positionCodes.join(';')}{precheckNote(row.rowNumber)}</Space> }]} />}
    {result && <Table<ResultRow> rowKey="rowNumber" size="small" scroll={{ x: 750 }} pagination={false} dataSource={result.rows} columns={[{ title: t('行号'), dataIndex: 'rowNumber' }, { title: t('用户名'), render: (_, row) => <Space>{row.username}<Button disabled={busy} onClick={() => void copy(row, false)}>{t('复制账号')}</Button></Space> }, { title: t('结果'), render: (_, row) => <Space orientation="vertical">{row.status === 'SUCCESS' ? t('成功') : `${t('失败')} · ${row.code ?? ''}`}{precheckNote(row.rowNumber)}</Space> }, { title: t('临时密码'), render: (_, row) => row.temporaryPassword?.status === 'AVAILABLE' ? <Space><code>{row.temporaryPassword.temporaryPassword}</code><Button disabled={busy} size="small" onClick={() => void copy(row, true)}>{t('复制临时密码')}</Button></Space> : t(row.temporaryPassword?.status === 'EXPIRED' ? '已过期' : '不可用') }]} />}
  </section>;
}
