import { Alert, Button, Modal, Progress, Space, Table, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { apiRequest, csrfToken, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { prepareImportBatches, type ImportBatch, type MasterResult, type MasterRow } from './import-batches';
import { readXlsxFile } from './read-xlsx';

type Props<Row extends MasterRow> = {
  organizationId?: string;
  onImported: () => void | Promise<void>;
  domain: string;
  endpoint: string;
  headers: string[];
  fields: (keyof Row)[];
  parse: (sheet: unknown[][], t: (text: string) => string) => Row[];
  rule: string;
};
const statuses = { CREATED: '新增成功', SKIPPED_DUPLICATE: '重复跳过', FAILED: '失败' };
const leaveMessage = '已提交的数据保留；确认离开或关闭页面后停止其余批次，当前请求可能已提交。';

export function MasterDataImport<Row extends MasterRow>(props: Props<Row>) {
  return <ImportForm key={props.organizationId ?? 'current'} {...props} />;
}

function ImportForm<Row extends MasterRow>({ organizationId, onImported, domain, endpoint, headers, fields, parse, rule }: Props<Row>) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [result, setResult] = useState<MasterResult>();
  const [processed, setProcessed] = useState(0);
  const [error, setError] = useState<string>();
  const [unknown, setUnknown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [modal, holder] = Modal.useModal();
  const alive = useRef(true);
  const readingVersion = useRef(0);
  const running = useRef(false);
  const stopped = useRef(false);
  const batches = useRef<ImportBatch[]>([]);
  const next = useRef(0);
  const stopDecision = useRef<{ promise: Promise<boolean>; resolve: (stop: boolean) => void } | undefined>(undefined);
  const unfinished = reading || busy || (rows.length > processed);
  useUnsavedChanges(unfinished);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; stopped.current = true; readingVersion.current++; stopDecision.current?.resolve(true); };
  }, []);

  async function readFile(file: File) {
    if (running.current || unknown) return;
    const version = ++readingVersion.current;
    setReading(true); setError(undefined); setRows([]); setResult(undefined); setProcessed(0);
    batches.current = []; next.current = 0;
    try {
      const parsed = parse(await readXlsxFile(file, { mode: 'master-data' }), t);
      const prepared = prepareImportBatches(parsed, organizationId, t);
      if (!alive.current || version !== readingVersion.current) return;
      batches.current = prepared; setRows(parsed);
    } catch (cause) { if (alive.current && version === readingVersion.current) setError(cause instanceof Error ? cause.message : t('Excel 文件无法解析')); }
    finally { if (alive.current && version === readingVersion.current) setReading(false); }
  }

  async function downloadTemplate() {
    try {
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet(t(domain));
      sheet.addRow(headers.map(t)); sheet.columns.forEach((column) => { column.width = 24; column.numFmt = '@'; });
      const bytes = await workbook.xlsx.writeBuffer();
      if (!alive.current) return;
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      try { const link = document.createElement('a'); link.href = url; link.download = `${t(`${domain}导入模板`)}.xlsx`; link.click(); }
      finally { URL.revokeObjectURL(url); }
    } catch { if (alive.current) setError(t('模板下载失败，请重试')); }
  }

  async function submit() {
    if (running.current || reading || next.current >= batches.current.length) return;
    running.current = true; stopped.current = false; setBusy(true); setError(undefined); setUnknown(false);
    let acknowledged = false;
    try {
      while (alive.current && !stopped.current && next.current < batches.current.length) {
        const batch = batches.current[next.current]!;
        const csrf = await csrfToken();
        if (!alive.current || stopped.current) break;
        if (stopDecision.current && await stopDecision.current.promise) break;
        const response = await apiRequest<MasterResult>(endpoint, { method: 'POST', headers: { 'x-csrf-token': csrf, 'Idempotency-Key': batch.key }, body: batch.body });
        if (!alive.current) return;
        next.current++; acknowledged = true;
        setProcessed((count) => count + batch.count);
        setResult((previous) => ({ created: (previous?.created ?? 0) + response.created, skipped: (previous?.skipped ?? 0) + response.skipped, failed: (previous?.failed ?? 0) + response.failed, items: [...(previous?.items ?? []), ...response.items] }));
        if (stopDecision.current && await stopDecision.current.promise) break;
      }
    } catch (cause) {
      if (alive.current) { setUnknown(true); setError(safeAccountError(cause)); }
    } finally {
      if (alive.current && acknowledged) {
        try { await onImported(); }
        catch { if (alive.current) setError(t('导入回执已保留，列表刷新失败，请稍后刷新列表。')); }
      }
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }

  function confirmStop() {
    if (stopDecision.current || stopped.current) return;
    let resolve!: (stop: boolean) => void;
    const promise = new Promise<boolean>((done) => { resolve = done; });
    stopDecision.current = { promise, resolve };
    const decide = (stop: boolean) => { stopped.current = stop; resolve(stop); stopDecision.current = undefined; };
    modal.confirm({ title: t('终止导入？'), content: t('终止后已提交的数据保留，当前请求完成后停止其余批次。'), okText: t('确认终止'), cancelText: t('继续导入'), onOk: () => decide(true), onCancel: () => decide(false) });
  }

  return <>
    {holder}<Button onClick={() => setOpen(true)}>{t(`批量导入${domain}`)}</Button>
    {unfinished && !open ? <Alert type="warning" title={t(leaveMessage)} /> : null}
    <Modal title={t(`${domain}批量新增`)} open={open} footer={null} onCancel={() => { if (!busy && !reading) setOpen(false); }} closable={!busy && !reading} keyboard={!busy && !reading} mask={{ closable: false }} width={900}>
      <section aria-label={t(`${domain}批量新增`)}>
        <Typography.Paragraph>{t(rule)}</Typography.Paragraph>
        <Typography.Paragraph>{t(leaveMessage)}</Typography.Paragraph>
        <Space wrap><Button onClick={() => void downloadTemplate()}>{t(`下载${domain}模板`)}</Button><input aria-label={t(`${domain}清单文件`)} type="file" accept=".xlsx" disabled={busy || reading || unknown} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void readFile(file); }} /><Button onClick={() => void submit()} loading={busy} disabled={busy || reading || !rows.length || next.current >= batches.current.length}>{t(`导入${domain}`)}</Button>{busy ? <Button danger onClick={confirmStop}>{t('终止导入')}</Button> : <Button onClick={() => setOpen(false)}>{t('关闭')}</Button>}</Space>
        {error ? <Alert showIcon type="error" title={t(error)} /> : null}
        {unknown ? <Alert type="warning" title={t('当前批次结果未知，请使用原批次重试；已确认结果保留。')} /> : null}
        {rows.length > 0 ? <><Typography.Paragraph aria-live="polite">{t('已确认 {processed} / {total}，未处理 {remaining}').replace('{processed}', String(processed)).replace('{total}', String(rows.length)).replace('{remaining}', String(rows.length - processed))}</Typography.Paragraph><Progress percent={Math.floor(processed / rows.length * 100)} /><Table<Row> rowKey="rowNumber" size="small" scroll={{ x: true }} dataSource={rows} pagination={{ pageSize: 20, showSizeChanger: false }} columns={[{ title: t('行号'), dataIndex: 'rowNumber' }, ...fields.map((field, i) => ({ title: t(headers[i]!), dataIndex: field as string })), { title: t('校验提示'), render: (_, row) => !row[fields[0]!] ? t('编码需文本；该行将交由服务器校验。') : '' }]} /></> : null}
        {result ? <><Alert type={result.failed ? 'warning' : 'success'} title={t('新增 {created}，重复跳过 {skipped}，失败 {failed}').replace('{created}', String(result.created)).replace('{skipped}', String(result.skipped)).replace('{failed}', String(result.failed))} /><Table rowKey="rowNumber" size="small" scroll={{ x: true }} dataSource={result.items} pagination={{ pageSize: 20, showSizeChanger: false }} columns={[{ title: t('行号'), dataIndex: 'rowNumber' }, { title: t(headers[0]!), dataIndex: 'code' }, { title: t('结果'), dataIndex: 'status', render: (status: MasterResult['items'][number]['status']) => t(statuses[status]) }, { title: t('说明'), render: (_, row) => row.status === 'FAILED' ? t('该行未新增，请检查编码和名称后重新上传') : '' }]} /></> : null}
      </section>
    </Modal>
  </>;
}
