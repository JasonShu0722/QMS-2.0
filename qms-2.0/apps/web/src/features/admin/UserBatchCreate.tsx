import { Alert, Button, Space, Table, Typography } from 'antd';
import type { components } from '@qms/contracts';
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest, csrfToken, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useNavigationBusy, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { readXlsxFile } from '../imports/read-xlsx';

type AccountType = components['schemas']['CreateAdminUserDto']['accountType'];
type PreviewBody = components['schemas']['CreateAdminUserBatchPreviewDto'];
type PreviewResult = components['schemas']['AdminUserBatchPreviewResultDto'];
type ConfirmBody = components['schemas']['AdminUserBatchConfirmDto'];
type ConfirmResult = components['schemas']['AdminUserBatchConfirmResultDto'];
type PreviewRow = {
  rowNumber: number;
  username: string;
  fullName: string;
  accountType: AccountType | undefined;
  organizationCode: string;
  organizationName?: string;
  issues: string[];
};
type Preview = { id?: string; rows: PreviewRow[] };
type PreviewAttempt = { file: File; key: string };
type Receipt = Pick<PreviewRow, 'rowNumber' | 'username' | 'issues'> & {
  status: '成功' | '跳过' | '失败';
  configurationRequired?: boolean;
};

const headers = ['用户名', '姓名', '账号类型', '主组织', '密码'];
const batchPath = '/api/v1/admin/users/batch';
const rowIssues = new Map([
  ['ORGANIZATION_NOT_FOUND', '主组织代码无法识别或无权管理'],
  ['ORGANIZATION_SCOPE_DENIED', '无权访问该组织'],
  ['ORGANIZATION_CONFIGURATION_REQUIRED', '主组织待配置'],
  ['ADMIN_ACCOUNT_TYPE_ORGANIZATION_MISMATCH', '账号类型与主组织类型不一致'],
  ['ADMIN_USER_DUPLICATE', '用户名已存在'],
  ['ORGANIZATION_DISABLED', '组织已停用'],
  ['CONCURRENCY_CONFLICT', '数据已变化，请重新导入'],
  ['FEATURE_PERMISSION_DENIED', '无权执行此操作'],
  ['AUTH_PASSWORD_POLICY_INVALID', '密码不符合安全要求'],
  ['ADMIN_BATCH_ROW_INVALID', '请检查账号导入行的填写内容'],
]);

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function accountTypeOf(value: string): AccountType | undefined {
  if (value === 'INTERNAL' || value === '内部账号') return 'INTERNAL';
  if (value === 'SUPPLIER' || value === '供应商账号') return 'SUPPLIER';
}

function parseRows(sheet: readonly (readonly unknown[])[]) {
  const columns = sheet[0] ?? [];
  if (columns.length !== headers.length || headers.some((header, index) => text(columns[index]) !== header)) {
    return { error: '请下载并使用新版五列账号模板' } as const;
  }
  const rows: PreviewRow[] = [];
  const candidates: PreviewBody['rows'] = [];
  sheet.slice(1).forEach((values, index) => {
    if (values.every(value => value == null || typeof value === 'string' && !value.trim())) return;
    const [username = '', fullName = '', type = '', organizationCode = ''] = values.slice(0, 4).map(text);
    const accountType = accountTypeOf(type);
    const password = typeof values[4] === 'string' ? values[4] : '';
    const rowNumber = index + 2;
    const issues: string[] = [];
    const malformed = values.some((value, column) => value != null && (column >= headers.length ? value !== '' : typeof value === 'object'));
    if (malformed) {
      issues.push('不支持公式、对象或额外数据列');
    } else {
      if (!username) issues.push('请填写用户名');
      else if (!/^[a-zA-Z0-9._-]{1,100}$/.test(username)) issues.push('用户名须为 1–100 个字母、数字、点、下划线或连字符');
      if (!fullName) issues.push('请填写姓名');
      else if (fullName.length > 100 || /\p{Cc}/u.test(fullName)) issues.push('姓名须为 1–100 个字符且不能包含控制字符');
      if (!type) issues.push('请填写账号类型');
      else if (!accountType) issues.push('账号类型须为内部账号或供应商账号');
      if (!organizationCode) issues.push('请填写主组织代码');
      else if (organizationCode.length > 64 || /\p{Cc}/u.test(organizationCode)) issues.push('主组织代码须为 1–64 个字符且不能包含控制字符');
      if (values[4] != null && typeof values[4] !== 'string') issues.push('请使用文本格式填写密码');
      else if (!password.trim()) issues.push('请填写密码');
      else if ([...password].length < 12 || [...password].length > 256) issues.push('密码须为 12–256 个字符');
    }
    const row = { rowNumber, username, fullName, accountType, organizationCode, issues };
    rows.push(row);
    if (accountType && !issues.length) candidates.push({ rowNumber, username, fullName, accountType, organizationCode, password });
  });
  if (!rows.length || rows.length > 100) return { error: '每次需要 1–100 条非空数据行' } as const;
  return { rows, candidates };
}

function responseRows<Row extends { rowNumber: number }>(response: { rows: Row[] }) {
  if (!Array.isArray(response?.rows)) throw new Error('Missing batch rows');
  return new Map(response.rows.map(row => [row.rowNumber, row] as const));
}

function rowIssue(code: unknown, fallback: string): string {
  return typeof code === 'string' ? rowIssues.get(code) ?? fallback : fallback;
}

function safeCell(value: string) { return /^[=+\-@]/.test(value) ? `'${value}` : value; }

type BatchProps = {
  organizationId: string;
  canReadPasswords?: boolean;
  canAuthorize?: boolean;
  busyChanged?: (busy: boolean) => void;
};

export function UserBatchCreate({ organizationId, busyChanged }: BatchProps) {
  const identity = useWorkTabsStore(state => state.sessionScope);
  return <BatchForm key={`${identity}:${organizationId}`} organizationId={organizationId} busyChanged={busyChanged} />;
}

function BatchForm({ organizationId, busyChanged }: Pick<BatchProps, 'organizationId' | 'busyChanged'>) {
  const { t } = useLanguage();
  const [preview, setPreview] = useState<Preview>();
  const [previewRetry, setPreviewRetry] = useState<PreviewAttempt>();
  const [result, setResult] = useState<Receipt[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const operation = useRef<AbortController | undefined>(undefined);
  const confirmKey = useRef<string | undefined>(undefined);
  const readyCount = preview?.rows.filter(row => !row.issues.length).length ?? 0;
  useUnsavedChanges(readyCount > 0 && !result);
  useNavigationBusy(busy);

  useEffect(() => () => operation.current?.abort(), []);
  useEffect(() => () => busyChanged?.(false), [busyChanged]);

  function reportBusy(value: boolean) { setBusy(value); busyChanged?.(value); }

  async function run(action: (signal: AbortSignal) => Promise<void>, onError: (cause: unknown) => string = safeAccountError) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    reportBusy(true);
    setError(undefined);
    try { await action(controller.signal); }
    catch (cause) { if (!controller.signal.aborted) setError(onError(cause)); }
    finally {
      operation.current = undefined;
      if (!controller.signal.aborted) reportBusy(false);
    }
  }

  async function post<Result>(path: 'preview' | 'confirm', body: PreviewBody | ConfirmBody, key: string, signal: AbortSignal) {
    const token = await csrfToken(signal);
    return apiRequest<Result>(`${batchPath}/${path}`, {
      method: 'POST', signal, headers: { 'x-csrf-token': token, 'Idempotency-Key': key }, body: JSON.stringify(body),
    });
  }

  async function readFile(attempt: PreviewAttempt) {
    if (confirmKey.current) return;
    await run(async signal => {
      setPreview(undefined);
      setPreviewRetry(undefined);
      setResult(undefined);
      const sheet = await readXlsxFile(attempt.file).catch(() => undefined);
      if (signal.aborted) return;
      if (!sheet) { setError('Excel 文件无法解析，请检查文件格式'); return; }
      const parsed = parseRows(sheet);
      if (parsed.error) { setError(parsed.error); return; }
      const { rows, candidates } = parsed;
      if (!candidates.length) { setPreview({ rows }); return; }

      const response = await post<PreviewResult>('preview', { organizationId, rows: candidates }, attempt.key, signal);
      if (signal.aborted) return;
      const checks = responseRows(response);
      const id = response.previewId;
      if (typeof id !== 'string' || !id) throw new Error('Missing batch preview ID');
      setPreview({ id, rows: rows.map(row => {
        if (row.issues.length) return row;
        const check = checks.get(row.rowNumber);
        const code = check?.code;
        const hideName = code === 'ORGANIZATION_NOT_FOUND' || code === 'ORGANIZATION_SCOPE_DENIED' || code === 'FEATURE_PERMISSION_DENIED';
        const organizationName = !hideName && typeof check?.organizationName === 'string' ? check.organizationName : undefined;
        return { ...row, organizationName, issues: check?.status === 'READY' && organizationName ? [] : [rowIssue(code, '该行未通过预览校验')] };
      }) });
    }, cause => {
      if (cause instanceof ApiError && [404, 405].includes(cause.status ?? 0)) return '批量建号预览暂不可用';
      setPreviewRetry(attempt);
      return safeAccountError(cause);
    });
  }

  async function confirm() {
    if (!preview?.id || !readyCount || result) return;
    const { id, rows } = preview;
    await run(async signal => {
      confirmKey.current ??= crypto.randomUUID();
      const response = await post<ConfirmResult>('confirm', { organizationId, previewId: id }, confirmKey.current, signal);
      if (signal.aborted) return;
      const receipts = responseRows(response);
      const next = rows.map((row): Receipt => {
        const { rowNumber, username, issues } = row;
        if (issues.length) return { rowNumber, username, issues, status: '跳过' };
        const receipt = receipts.get(rowNumber);
        if (receipt?.status === 'SUCCESS') return { rowNumber, username, issues: [], status: '成功', configurationRequired: receipt.configurationRequired === true };
        if (receipt?.status === 'SKIPPED') return { rowNumber, username, issues: [rowIssue(receipt.code, '该行未通过确认校验')], status: '跳过' };
        if (receipt?.status === 'FAILED') return { rowNumber, username, issues: [rowIssue(receipt.code, '账号创建失败')], status: '失败' };
        throw new Error('Missing batch confirmation receipt');
      });
      confirmKey.current = undefined;
      setResult(next);
    }, cause => {
      if (cause instanceof ApiError && cause.code === 'ADMIN_BATCH_ROW_INVALID' && (cause.status === 400 || cause.status === 409)) {
        confirmKey.current = undefined;
        setPreview(undefined);
        return '批量建号预览已失效，请重新导入';
      }
      return safeAccountError(cause);
    });
  }

  async function saveWorkbook(values: (string | number)[][], name: string, signal: AbortSignal) {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('账号');
    values.forEach(row => sheet.addRow(row));
    sheet.columns.forEach(column => { column.width = 28; column.numFmt = '@'; });
    const bytes = await workbook.xlsx.writeBuffer();
    if (signal.aborted) return;
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function downloadTemplate() {
    await run(signal => saveWorkbook([headers, ['example.user', '示例姓名', 'INTERNAL', 'ORG_CODE', '']], '账号导入模板.xlsx', signal), () => '模板下载失败，请重试');
  }

  async function downloadResult() {
    if (!result) return;
    await run(signal => saveWorkbook([
      ['行号', '用户名', '状态', '处理说明'].map(t),
      ...result.map(row => [row.rowNumber, safeCell(row.username), t(row.status), row.issues.map(t).join('；') || (row.configurationRequired ? t('待配置') : '')]),
    ], '账号清单.xlsx', signal), () => '账号清单下载失败，请重试');
  }

  const renderIssues = (issues: string[]) => issues.map(issue => <Typography.Text type="secondary" key={issue}>{t(issue)}</Typography.Text>);

  return <section aria-label={t('批量创建账号')} aria-busy={busy}>
    <Typography.Paragraph>{t('读取首个工作表，主组织填写组织代码。')}</Typography.Paragraph>
    <Space orientation="vertical" style={{ width: '100%' }}>
      <Space wrap>
        <Button disabled={busy} onClick={() => void downloadTemplate()}>{t('下载账号模板')}</Button>
        <input aria-label={t('账号清单文件')} type="file" accept=".xlsx" disabled={busy || !!confirmKey.current} onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void readFile({ file, key: crypto.randomUUID() });
        }} />
        {previewRetry && <Button disabled={busy} onClick={() => void readFile(previewRetry)}>{t('重试预览')}</Button>}
        <Button type="primary" disabled={busy || !preview?.id || !readyCount || !!result} onClick={() => void confirm()}>{t('创建账号')}</Button>
        {result && <Button disabled={busy} onClick={() => void downloadResult()}>{t('下载账号清单')}</Button>}
      </Space>
      {error && <Alert showIcon type="error" title={t(error)} />}
      {preview && !result && <Table<PreviewRow> rowKey="rowNumber" size="small" pagination={false} scroll={{ x: 650 }} dataSource={preview.rows} columns={[
        { title: t('行号'), dataIndex: 'rowNumber' },
        { title: t('用户名'), dataIndex: 'username' },
        { title: t('姓名'), dataIndex: 'fullName' },
        { title: t('账号类型'), render: (_, row) => row.accountType ? t(row.accountType === 'INTERNAL' ? '内部账号' : '供应商账号') : '—' },
        { title: t('主组织'), render: (_, row) => row.organizationName || row.organizationCode || '—' },
        { title: t('处理说明'), render: (_, row) => <Space orientation="vertical">{t(row.issues.length ? '待跳过' : '可创建')}{renderIssues(row.issues)}</Space> },
      ]} />}
      {result && <Table<Receipt> rowKey="rowNumber" size="small" pagination={false} scroll={{ x: 480 }} dataSource={result} columns={[
        { title: t('行号'), dataIndex: 'rowNumber' },
        { title: t('用户名'), render: (_, row) => <Space wrap>{row.username}{row.status === '成功' && <Button size="small" disabled={busy} onClick={() => void run(async () => navigator.clipboard.writeText(row.username))}>{t('复制账号')}</Button>}</Space> },
        { title: t('结果'), render: (_, row) => <Space orientation="vertical">{t(row.status)}{row.configurationRequired && <Typography.Text type="secondary">{t('待配置')}</Typography.Text>}{renderIssues(row.issues)}</Space> },
      ]} />}
    </Space>
  </section>;
}
