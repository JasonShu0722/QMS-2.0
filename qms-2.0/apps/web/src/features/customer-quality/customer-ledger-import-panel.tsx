import type { components } from '@qms/contracts';
import { Alert, Button, Input, Modal, Space, Table, Typography } from 'antd';
import { useRef, useState } from 'react';
import { ApiError, apiRequest } from '../../api/client';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { ledgerFields, parseLedgerTsv, rawText, readLedgerWorkbook } from './customer-ledger-import';
import { candidateLabel, LedgerError, LedgerWarnings, ledgerBase, scopedLedger, type LedgerCandidate, type LedgerItem } from './customer-ledger-ui';
import { ledgerDenied, useCustomerLedgerWrite } from './customer-ledger-write';

type ImportBody = components['schemas']['CustomerLedgerImportDto'];
type ImportRow = components['schemas']['CustomerLedgerImportRowDto'];
type ImportResult = components['schemas']['CustomerLedgerImportResultDto'];
const outcomeLabels: Record<ImportResult['items'][number]['outcome'], string> = { PREVIEW: '预览，尚未保存', CREATED: '已新增', SUPPLEMENTED: '已补充', SKIPPED: '已跳过', FAILED: '失败', CANCELLED: '已取消' };

export function CustomerLedgerImportPanel({ organizationId, existing, customers = [], candidates = [], onDenied, onClose, onCommitted }: {
  organizationId?: string; existing: LedgerItem[]; onDenied: (cause: unknown) => void; onClose: () => void; onCommitted: () => void;
  customers?: components['schemas']['CustomerMasterDto'][];
  candidates?: LedgerCandidate[];
}) {
  const [text, setText] = useState(''); const [filename, setFilename] = useState('');
  const [rows, setRows] = useState<ImportRow[]>([]); const [preview, setPreview] = useState<ImportResult>();
  const [result, setResult] = useState<ImportResult>(); const [error, setError] = useState<unknown>();
  const [confirmed, setConfirmed] = useState<Set<number>>(new Set());
  const [reading, setReading] = useState(false); const readingRef = useRef(false);
  const [targetSearch, setTargetSearch] = useState(''); const [targets, setTargets] = useState<LedgerItem[]>(existing);
  const [searching, setSearching] = useState(false); const searchId = useRef(0);
  const writer = useCustomerLedgerWrite(onDenied);
  const attempt = useRef<'PREVIEW' | ImportBody['mode']>('PREVIEW');
  const requestLeave = useNavigationGuard();
  useNavigationBusy(writer.busy || reading || searching); useUnsavedChanges(!!text || !!filename || !!rows.length && (!result || result.failed > 0) || writer.uncertain);
  const locked = writer.busy || writer.uncertain || reading;
  function close() { if (!writer.busy && !reading) requestLeave(onClose, true); }
  async function selectFile(file: File) {
    if (readingRef.current || writer.busy || writer.uncertain) return;
    readingRef.current = true; setReading(true); setError(undefined);
    setRows([]); setPreview(undefined); setResult(undefined); setConfirmed(new Set()); setFilename(file.name); setText('');
    try { const parsed = await readLedgerWorkbook(file); if (!writer.signal().aborted) setRows(parsed); }
    catch (cause) { if (!writer.signal().aborted) setError(cause); }
    finally { readingRef.current = false; if (!writer.signal().aborted) setReading(false); }
  }
  async function searchTargets() {
    if (searching || locked) return;
    const request = ++searchId.current; setSearching(true); setError(undefined);
    try {
      const value = await apiRequest<components['schemas']['CustomerLedgerPageDto']>(scopedLedger(`${ledgerBase}?page=1&pageSize=100&search=${encodeURIComponent(targetSearch)}`, organizationId), { signal: writer.signal() });
      if (!writer.signal().aborted && request === searchId.current) setTargets(value.items);
    } catch (cause) { if (!writer.signal().aborted) { setError(cause); if (ledgerDenied(cause)) onDenied(cause); } }
    finally { if (!writer.signal().aborted && request === searchId.current) setSearching(false); }
  }
  async function showPreview() {
    if (writer.busy || reading) return;
    setError(undefined); setResult(undefined);
    try {
      const input = rows.length ? rows : parseLedgerTsv(text);
      if (!writer.uncertain) attempt.current = 'PREVIEW';
      const value = await writer.write<ImportResult>(`${ledgerBase}/import/preview`, { organizationId, mode: 'CONTINUE', rows: input }, 'POST');
      setRows(input); setPreview(value); setConfirmed(new Set());
    } catch (cause) { if (!writer.signal().aborted) setError(cause); }
  }
  function changeRow(rowNumber: number, patch: Partial<ImportRow>) {
    setRows(current => current.map(row => row.rowNumber === rowNumber ? { ...row, ...patch } : row));
    setConfirmed(current => { const next = new Set(current); next.delete(rowNumber); return next; });
  }
  function customerLabel(id: string | null) {
    const customer = customers.find(item => item.id === id);
    return customer ? `${customer.code} · ${customer.name}` : id ? `${id}（名称未解析）` : '未关联';
  }
  const ready = !!preview && rows.every(row => row.action !== 'SUPPLEMENT' || !!row.targetId && !!row.expectedVersion && confirmed.has(row.rowNumber));
  async function refreshVersions(retained: ImportRow[]) {
    setReading(true); setConfirmed(new Set());
    try {
      const refreshed: LedgerItem[] = [];
      const next: ImportRow[] = [];
      for (const row of retained) {
        if (row.action !== 'SUPPLEMENT' || !row.targetId) { next.push(row); continue; }
        const target = await apiRequest<components['schemas']['CustomerLedgerDetailDto']>(scopedLedger(`${ledgerBase}/${row.targetId}`, organizationId), { signal: writer.signal() });
        writer.signal().throwIfAborted(); refreshed.push(target); next.push({ ...row, expectedVersion: target.version });
      }
      setTargets(current => [...new Map([...current, ...refreshed].map(item => [item.id, item])).values()]);
      setRows(next); setResult(undefined); setPreview(undefined);
    } catch (cause) { if (!writer.signal().aborted) { setError(cause); if (ledgerDenied(cause)) onDenied(cause); } }
    finally { if (!writer.signal().aborted) setReading(false); }
  }
  async function commit(mode: ImportBody['mode']) {
    if (writer.busy || (!ready && mode !== 'CANCEL')) return;
    if (!writer.uncertain) attempt.current = mode;
    setError(undefined);
    try {
      const value = await writer.write<ImportResult>(`${ledgerBase}/import/commit`, { organizationId, mode, rows: mode === 'CANCEL' ? rows.map(row => ({ rowNumber: row.rowNumber, fields: row.fields, action: 'SKIP' })) : rows }, 'POST');
      setResult(value); setText(''); setFilename('');
      if (mode !== 'CANCEL') onCommitted();
    } catch (cause) { if (!writer.signal().aborted) { setError(cause); if (cause instanceof ApiError && cause.status === 409) await refreshVersions(rows); } }
  }
  return <Modal open title="粘贴 / Excel 导入" width={1120} onCancel={close} closable={!writer.busy && !reading} keyboard={!writer.busy && !reading} mask={{ closable: !writer.busy && !reading }} footer={<Button onClick={close} disabled={writer.busy || reading}>关闭导入窗口</Button>}>
    <div className="customer-quality-import">
      <Typography.Paragraph>首行为中文表头，每次最多 100 行；每行默认新增，请核对疑似重复条目。</Typography.Paragraph>
      <details><summary>中文列说明与选项</summary><p>{ledgerFields.map(([, label]) => label).join('、')}</p><p>类型：零公里 / 售后；服务方式：远程指导 / 现场现调 / 未接到通知；拦截状态：是，已发备件 / 否，索赔件 / 否，不索赔。日期 YYYY-MM-DD，各日期不互相替代。</p></details>
      <label>中文 TSV 粘贴<Input.TextArea aria-label="中文 TSV 粘贴" rows={4} value={text} disabled={locked || !!result} placeholder={'客户\t客诉类型\t件数\t详细故障描述\n客户原文\t售后\t2\t故障原文'} onChange={event => { setText(event.target.value); setRows([]); setFilename(''); setPreview(undefined); setResult(undefined); setConfirmed(new Set()); }} /></label>
      <label className="customer-quality-import__picker">选择客诉 Excel 文件<input type="file" aria-label="选择客诉 Excel 文件" accept=".xlsx" disabled={locked || !!result} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void selectFile(file); }} /></label>
      {filename ? <p>当前文件：{filename}；数据行：{rows.length}</p> : null}
      <LedgerError cause={error} />
      {writer.uncertain ? <Alert type="warning" showIcon title="结果未知，原请求、输入和幂等键已锁定；只能重试原操作以核对结果。" /> : null}
      <Button aria-label="预览" loading={writer.busy && attempt.current === 'PREVIEW'} disabled={reading || !!result || writer.uncertain && attempt.current !== 'PREVIEW' || !text && !rows.length} onClick={() => void showPreview()}>{writer.uncertain ? '重试原预览' : '预览'}</Button>
      {preview && !result ? <>
        <Space wrap><Input aria-label="查找已有客诉" placeholder="按编号 / 客户 / 描述查找补充目标" value={targetSearch} disabled={locked} onChange={event => setTargetSearch(event.target.value)} /><Button onClick={() => void searchTargets()} loading={searching} disabled={locked}>查找补充目标</Button></Space>
        <Table<ImportRow> rowKey="rowNumber" dataSource={rows} size="small" pagination={{ pageSize: 10 }} scroll={{ x: 1150 }} columns={[
          { title: '原行号', dataIndex: 'rowNumber' },
          { title: '原填写', render: (_, row) => <details><summary>{rawText(row.fields.customerName) || '客户待补'} · 件数 {rawText(row.fields.quantity) || '待补'}</summary><dl className="customer-ledger-facts">{ledgerFields.filter(([key]) => key in row.fields).map(([key, label]) => <div key={key}><dt>{label}</dt><dd className="customer-ledger-raw">{rawText(row.fields[key]) || '（空）'}</dd></div>)}</dl></details> },
          { title: '客户关联（可选）', render: (_, row) => <select aria-label={`第 ${row.rowNumber} 行关联客户`} value={row.customerId ?? ''} disabled={locked} onChange={event => changeRow(row.rowNumber, { customerId: event.target.value || null })}><option value="">未关联</option>{customers.filter(customer => customer.active).map(customer => <option key={customer.id} value={customer.id}>{customer.code} · {customer.name}</option>)}</select> },
          { title: '字段问题', render: (_, row) => { const receipt = preview.items.find(item => item.rowNumber === row.rowNumber); return <><LedgerWarnings warnings={receipt?.warnings ?? []} raw={row.fields} label={`第 ${row.rowNumber} 行`} />{receipt?.errorCode ? <span>{receipt.errorCode}</span> : null}{!receipt?.warnings.length && !receipt?.errorCode ? '无字段问题' : null}</>; } },
          { title: '疑似已有条目', render: (_, row) => { const similar = preview.items.find(item => item.rowNumber === row.rowNumber)?.similarities ?? []; return similar.length ? similar.map(item => <div key={item.id}>{item.complaintNumber} · {item.normalized.customerName ?? '客户待补'} · 件数 {item.normalized.quantity ?? '待补'} · v{item.version}</div>) : '未发现疑似条目'; } },
          { title: '逐行决定', render: (_, row) => <select aria-label={`第 ${row.rowNumber} 行操作`} value={row.action} disabled={locked} onChange={event => {
            const action = event.target.value; if (action === 'ADD' || action === 'SKIP' || action === 'SUPPLEMENT') changeRow(row.rowNumber, { action, targetId: undefined, expectedVersion: undefined, qualityEngineerAssignmentId: undefined });
          }}><option value="ADD">新增</option><option value="SKIP">跳过</option><option value="SUPPLEMENT">补充已有</option></select> },
          { title: '实际跟进质量工程师（仅新增）', render: (_, row) => row.action === 'ADD' ? <select aria-label={`第 ${row.rowNumber} 行实际跟进质量工程师`} value={row.qualityEngineerAssignmentId === undefined ? '__AUTO__' : row.qualityEngineerAssignmentId ?? ''} disabled={locked} onChange={event => changeRow(row.rowNumber, { qualityEngineerAssignmentId: event.target.value === '__AUTO__' ? undefined : event.target.value || null })}><option value="__AUTO__">按映射分配（无匹配时待分配）</option><option value="">未指定（按映射分配）</option>{candidates.map(candidate => <option key={candidate.assignmentId} value={candidate.assignmentId}>{candidateLabel(candidate)}</option>)}</select> : '保留原实际跟进人' },
          { title: '明确补充目标与变更', render: (_, row) => {
            if (row.action !== 'SUPPLEMENT') return '—';
            const options = [...new Map([...(preview.items.find(item => item.rowNumber === row.rowNumber)?.similarities ?? []), ...targets].map(item => [item.id, item])).values()];
            const target = options.find(item => item.id === row.targetId);
            return <div className="customer-ledger-supplement"><select aria-label={`第 ${row.rowNumber} 行补充目标`} value={row.targetId ?? ''} disabled={locked} onChange={event => { const selected = options.find(item => item.id === event.target.value); changeRow(row.rowNumber, { targetId: selected?.id, expectedVersion: selected?.version }); }}><option value="">明确选择已有条目</option>{options.map(item => <option key={item.id} value={item.id}>{item.complaintNumber} · v{item.version}</option>)}</select>
              {target ? <><details><summary>核对具体变更 · {target.complaintNumber} · v{row.expectedVersion}</summary><dl className="customer-ledger-facts">{ledgerFields.filter(([key]) => row.fields[key] != null && rawText(row.fields[key]).trim() !== '').map(([key, label]) => <div key={key}><dt>{label}</dt><dd className="customer-ledger-raw">原：{rawText(target.raw[key]) || '（空）'} → 补充：{rawText(row.fields[key])}</dd></div>)}{row.customerId && row.customerId !== target.customerId ? <div><dt>客户主数据关联</dt><dd className="customer-ledger-raw">原：{customerLabel(target.customerId)} → 补充：{customerLabel(row.customerId)}</dd></div> : null}</dl></details><label><input type="checkbox" aria-label={`第 ${row.rowNumber} 行确认补充变更`} checked={confirmed.has(row.rowNumber)} disabled={locked} onChange={event => { const checked = event.target.checked; setConfirmed(current => { const next = new Set(current); if (checked) next.add(row.rowNumber); else next.delete(row.rowNumber); return next; }); }} />确认补充以上非空字段及所列客户关联；不清空旧值，不覆盖人员、解析和附件</label></> : null}
            </div>;
          } },
        ]} />
        <Typography.Paragraph>预览尚未录入；“跳过错误行”仅跳过无效值或逆序日期，空值和待匹配客户仍会录入。</Typography.Paragraph>
        <Space wrap>{([['CANCEL', '取消本次导入'], ['CONTINUE', '继续，保留原文'], ['SKIP_ERRORS', '跳过错误行']] as const).map(([mode, label]) => <Button key={mode} aria-label={label} type={mode === 'CONTINUE' ? 'primary' : 'default'} loading={writer.busy && attempt.current === mode} disabled={writer.busy || mode !== 'CANCEL' && !ready || writer.uncertain && attempt.current !== mode} onClick={() => void commit(mode)}>{writer.uncertain && attempt.current === mode ? '重试原提交' : label}</Button>)}</Space>
      </> : null}
      {result ? <><Alert type={result.failed ? 'warning' : 'success'} showIcon title={`实际新增 ${result.created} 条；补充 ${result.supplemented} 条；待补正 ${result.pendingCorrection} 条；跳过 ${result.skipped} 条；失败 ${result.failed} 条。`} />
        <Table<ImportResult['items'][number]> rowKey="rowNumber" size="small" dataSource={result.items} pagination={{ pageSize: 10 }} columns={[
          { title: '原行号', dataIndex: 'rowNumber' }, { title: '实际结果', render: (_, receipt) => outcomeLabels[receipt.outcome] }, { title: '编号', render: (_, receipt) => receipt.record?.complaintNumber ?? '—' },
          { title: '失败 / 待补正', render: (_, receipt) => <>{receipt.errorCode}<LedgerWarnings label={`第 ${receipt.rowNumber} 行结果`} warnings={receipt.warnings} raw={rows.find(row => row.rowNumber === receipt.rowNumber)?.fields ?? {}} /></> },
        ]} />{result.failed ? <Button onClick={() => { const failed = new Set(result.items.filter(item => item.outcome === 'FAILED').map(item => item.rowNumber)); void refreshVersions(rows.filter(row => failed.has(row.rowNumber))); }} disabled={locked}>保留失败行并刷新版本，重新预览</Button> : <Button onClick={() => { setRows([]); setResult(undefined); setPreview(undefined); setConfirmed(new Set()); }}>开始下一批</Button>}</> : null}
    </div>
  </Modal>;
}
