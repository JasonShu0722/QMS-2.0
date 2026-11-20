import type { components } from '@qms/contracts';
import { Alert, Button, Card, Form, Input, Modal, Space, Switch } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest, createAdminMutation } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { LedgerTable, useLedgerPageSize } from '../../ui/ledger';
import { getLedgerSessionEpoch } from '../../ui/ledger/preferences';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import type { AdminOrganization } from '../admin/admin';
import { GovernanceFeedback } from './GovernanceFeedback';

type Sector = components['schemas']['ProcessOperationSectorDto'];
type Create = components['schemas']['ProcessOperationSectorInputDto'];
type Update = components['schemas']['UpdateProcessOperationSectorDto'];
type BulkCreate = components['schemas']['BulkCreateProcessOperationSectorsDto'];
type Command = { path: string; method: 'POST' | 'PUT' | 'DELETE'; body?: Create | Update | BulkCreate };
const sectorPath = '/api/v1/process-quality/operation-sectors';
function parseBatch(text: string) {
  const rows: { cells: string[]; number: number }[] = [];
  const pattern = /(?:"((?:[^"]|"")*)"|((?!")[^\t\n]*))(\t|\n|$)/gy;
  const source = text.replace(/\r\n?/g, '\n');
  let number = 1;
  let rowStart = number;
  let cells: string[] = [];
  while (pattern.lastIndex < source.length) {
    const match = pattern.exec(source);
    if (!match) return { malformed: number, rows: [] };
    cells.push((match[1]?.replaceAll('""', '"') ?? match[2]!).trim());
    number += match[0].split('\n').length - 1;
    if (match[3] !== '\t') {
      if (cells.some(Boolean)) rows.push({ cells, number: rowStart });
      cells = [];
      rowStart = number;
    }
  }
  if (cells.some(Boolean)) rows.push({ cells: [...cells, ''], number: rowStart });
  return { rows };
}
export function ProcessOperationSectors({ organization }: { organization: AdminOrganization }) {
  return <SectorContent key={`${organization.id}:${organization.permissions.join(',')}`} organization={organization} />;
}
function SectorContent({ organization }: { organization: AdminOrganization }) {
  const { t } = useLanguage(); const [form] = Form.useForm<Update>();
  const [items, setItems] = useState<Sector[]>([]); const [editor, setEditor] = useState<{ record?: Sector }>(); const [removing, setRemoving] = useState<Sector>();
  const [batchOpen, setBatchOpen] = useState(false); const [batchText, setBatchText] = useState('');
  const [batchIssues, setBatchIssues] = useState<string[]>([]);
  const batchLineNumbers = useRef<number[]>([]);
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useLedgerPageSize('process-operation-sectors', organization.id);
  const [revision, setRevision] = useState(0); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [unknown, setUnknown] = useState(false);
  const [error, setError] = useState<unknown>(); const [dirty, setDirty] = useState(false); const [retired, setRetired] = useState(false);
  const initialScope = useRef(useWorkTabsStore.getState().sessionScope); const initialEpoch = useRef(getLedgerSessionEpoch());
  const alive = useRef(true); const invalidated = useRef(false); const inFlight = useRef(false); const frozen = useRef<Command>(undefined);
  const controller = useRef<AbortController>(undefined); const [mutate] = useState(() => createAdminMutation({ replayAfterReauthentication: false }));
  const requestLeave = useNavigationGuard(); const manage = organization.permissions.includes('process-quality:configuration:manage'); const locked = busy || unknown;
  useUnsavedChanges(dirty || unknown); useNavigationBusy(busy);
  const current = () => alive.current && !invalidated.current && useWorkTabsStore.getState().sessionScope === initialScope.current && getLedgerSessionEpoch() === initialEpoch.current;
  function clearBatch() { setBatchOpen(false); setBatchText(''); setBatchIssues([]); batchLineNumbers.current = []; }
  function retire() { invalidated.current = true; controller.current?.abort(); setRetired(true); setItems([]); setEditor(undefined); setRemoving(undefined); clearBatch(); setDirty(false); setUnknown(false); setBusy(false); frozen.current = undefined; }
  useEffect(() => {
    alive.current = true; controller.current = new AbortController();
    const unsubscribe = useWorkTabsStore.subscribe(() => { if (!current()) retire(); });
    return () => { alive.current = false; controller.current?.abort(); unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!organization.permissions.includes('process-quality:configuration:read') || !current()) return;
    let active = true; setLoading(true); setError(undefined);
    void apiRequest<Sector[]>(`${sectorPath}?organizationId=${encodeURIComponent(organization.id)}`, { signal: controller.current?.signal }).then(value => {
      if (!active || !current()) return;
      if (!Array.isArray(value) || value.some(item => item.organizationId !== organization.id)) { retire(); return; }
      setItems(value);
    }).catch(cause => { if (active && current()) { if (cause instanceof ApiError && [401, 403].includes(cause.status ?? 0)) retire(); else setError(cause); } }).finally(() => { if (active && current()) setLoading(false); });
    return () => { active = false; };
  }, [organization.id, revision]);
  async function execute(command?: Command) {
    if (inFlight.current || !current() || !manage) return;
    const attempt = frozen.current ?? command; if (!attempt) return;
    frozen.current = attempt; inFlight.current = true; setBusy(true); setError(undefined);
    try {
      const result = await mutate<Sector | Sector[] | components['schemas']['DeletedProcessOperationSectorDto']>(attempt.path, attempt.method, attempt.body, controller.current?.signal);
      if (!current()) return;
      if (attempt.method === 'DELETE' && !Array.isArray(result)) setItems(previous => previous.filter(item => item.id !== result.id));
      else {
        const rows = Array.isArray(result) ? result : [result];
        if (!rows.every((row): row is Sector => 'organizationId' in row && row.organizationId === organization.id)) { retire(); return; }
        const added = new Set(rows.map(row => row.id));
        setItems(previous => [...previous.filter(item => !added.has(item.id)), ...rows].sort((first, second) => first.operationName.localeCompare(second.operationName)));
      }
      if (editor) form.resetFields();
      frozen.current = undefined; setUnknown(false); setDirty(false); setEditor(undefined); setRemoving(undefined); clearBatch();
    } catch (cause) {
      if (!current()) return;
      if (cause instanceof ApiError && cause.code !== 'AUTH_REAUTHENTICATION_REQUIRED' && [401, 403].includes(cause.status ?? 0)) { retire(); return; }
      const known = cause instanceof ApiError && (cause.code === 'CLIENT_REAUTHENTICATION_COMPLETED' || cause.status !== undefined && cause.status >= 400 && cause.status < 500 && ![408, 425].includes(cause.status));
      if (known) frozen.current = undefined;
      if (attempt.path === `${sectorPath}/bulk-create` && cause instanceof ApiError) {
        const reason = cause.code === 'PROCESS_OPERATION_CODE_CONFLICT' ? t('工序编码重复，请核对本批数据和现有清单。') : t('请核对工序编码和工序名称。');
        const lines = new Set<number>();
        for (const field of Object.keys(cause.fields)) {
          const match = /^items\[(\d+)\]\.(?:operationCode|operationName)$/.exec(field);
          const number = match && batchLineNumbers.current[Number(match[1])];
          if (number) lines.add(number);
        }
        setBatchIssues([...lines].map(number => `${t('第 {row} 行').replace('{row}', String(number))} · ${reason}`));
      }
      setUnknown(!known); setError(cause);
    } finally { inFlight.current = false; if (current()) setBusy(false); }
  }
  function save(values: Update) {
    if (locked) return;
    const operationCode = values.operationCode?.trim() ?? '';
    const facts: Create = { organizationId: organization.id, operationCode, operationName: values.operationName.trim(), sectorName: values.sectorName?.trim() || null };
    void execute(editor?.record ? { path: `${sectorPath}/${editor.record.id}?organizationId=${encodeURIComponent(organization.id)}`, method: 'PUT', body: { ...facts, operationCode: operationCode || null, active: values.active, expectedVersion: editor.record.version } } : { path: sectorPath, method: 'POST', body: facts });
  }
  function saveBatch() {
    if (locked) return;
    setError(undefined);
    if (batchText.length > 65_536) {
      setBatchIssues([t('粘贴内容过长，请分批提交。')]);
      return;
    }
    const { rows, malformed } = parseBatch(batchText);
    if (malformed) {
      setBatchIssues([`${t('第 {row} 行').replace('{row}', String(malformed))} · ${t('粘贴格式无效，请重新复制 Excel 两列。')}`]);
      return;
    }
    const header = rows[0]?.cells;
    if (header?.length === 2 && (header.join('\t') === '工序编码\t工序名称' || header.join('\t') === `${t('工序编码')}\t${t('工序名称')}`)) rows.shift();
    if (rows.length < 1 || rows.length > 100) {
      setBatchIssues([t('请粘贴 1 至 100 行工序数据。')]);
      return;
    }
    const seen = new Set<string>();
    const issues: string[] = [];
    const entries: BulkCreate['items'] = [];
    for (const { cells, number } of rows) {
      const [operationCode, operationName] = cells;
      let issue = '';
      if (cells.length !== 2 || !operationCode || !operationName) issue = t('请填写工序编码和工序名称，每行两列。');
      else if (operationCode.length > 100 || operationName.length > 200) issue = t('工序编码最多 100 字，工序名称最多 200 字。');
      else if (seen.has(operationCode)) issue = t('工序编码在本批内重复。');
      else { seen.add(operationCode); entries.push({ operationCode, operationName }); }
      if (issue) issues.push(`${t('第 {row} 行').replace('{row}', String(number))} · ${issue}`);
    }
    setBatchIssues(issues);
    if (issues.length) return;
    batchLineNumbers.current = rows.map(row => row.number);
    void execute({ path: `${sectorPath}/bulk-create`, method: 'POST', body: { organizationId: organization.id, items: entries } });
  }
  function close() { if (!locked) requestLeave(() => { if (editor) form.resetFields(); setDirty(false); setEditor(undefined); setRemoving(undefined); clearBatch(); }, true); }
  if (retired) return <Alert type="warning" title={t('会话或配置权限已变化，请重新进入。')} />;
  if (!organization.permissions.includes('process-quality:configuration:read')) return null;
  const feedback = <><GovernanceFeedback error={error} />{unknown ? <Alert type="warning" title={t('操作结果未知，输入已保留，请重试原请求。')} /> : null}</>;
  return <Card title={t('工序主数据')}>
    <Space wrap>
      {manage && <><Button type="primary" disabled={locked} onClick={() => { form.resetFields(); form.setFieldsValue({ active: true }); setError(undefined); setEditor({}); }}>{t('新增工序')}</Button>
      <Button disabled={locked} onClick={() => { setError(undefined); setBatchOpen(true); }}>{t('批量新增')}</Button></>}
      <Button disabled={locked || loading} onClick={() => requestLeave(() => setRevision(value => value + 1))}>{t('刷新')}</Button>
    </Space>
    {!editor && !removing && !batchOpen ? feedback : null}
    <LedgerTable<Sector> ledgerId="process-operation-sectors" organizationId={organization.id} requiredColumnKeys={['operationName', 'actions']} rowKey="id" loading={loading} dataSource={items} scroll={{ x: 620 }} pagination={{ current: page, pageSize, disabled: locked, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], onChange: (next, size) => { setPage(size === pageSize ? next : 1); setPageSize(size); } }} columns={[
      { key: 'operationCode', title: t('工序编码'), dataIndex: 'operationCode', ellipsis: true }, { key: 'operationName', title: t('工序名称'), dataIndex: 'operationName', ellipsis: true }, { key: 'sectorName', title: t('板块名称'), dataIndex: 'sectorName', ellipsis: true },
      { key: 'active', title: t('状态'), dataIndex: 'active', render: value => t(value ? '启用' : '停用') }, { key: 'version', title: t('版本'), dataIndex: 'version' },
      { key: 'actions', title: t('操作'), render: (_, record) => manage ? <Space wrap><Button disabled={locked} onClick={() => { form.setFieldsValue(record); setError(undefined); setEditor({ record }); }}>{t('编辑')}</Button><Button danger disabled={locked} onClick={() => { setError(undefined); setRemoving(record); }}>{t('删除')}</Button></Space> : t('只读') },
    ]} />
    <Modal open={!!editor} title={t(editor?.record ? '工序主数据' : '新增工序')} footer={null} onCancel={close} closable={!locked} keyboard={!locked} mask={{ closable: !locked }} destroyOnHidden>
      {feedback}<Form form={form} layout="vertical" disabled={locked} onValuesChange={() => setDirty(true)} onFinish={save}>
        <Form.Item name="operationCode" label={t('工序编码')} rules={editor?.record ? [] : [{ required: true, whitespace: true }]}><Input maxLength={100} readOnly={!!editor?.record?.operationCode} /></Form.Item>
        <Form.Item name="operationName" label={t('工序名称')} rules={[{ required: true, whitespace: true }]}><Input maxLength={200} /></Form.Item>
        <Form.Item name="sectorName" label={t('板块名称')} dependencies={['operationCode']} rules={[({ getFieldValue }) => ({ validator: async (_, value?: string) => {
          if (editor?.record && !getFieldValue('operationCode')?.trim() && !value?.trim()) throw new Error(t('未填写工序编码时，请填写板块名称。'));
        } })]}><Input maxLength={200} /></Form.Item>
        {editor?.record ? <Form.Item name="active" label={t('启用')} valuePropName="checked"><Switch /></Form.Item> : null}
        <Space><Button disabled={locked} onClick={close}>{t('取消')}</Button>{unknown ? <Button type="primary" disabled={busy} loading={busy} onClick={() => void execute()}>{t('重试原请求')}</Button> : <Button type="primary" htmlType="submit" loading={busy}>{t('保存')}</Button>}</Space>
      </Form>
    </Modal>
    <Modal open={batchOpen} title={t('批量新增工序')} footer={null} onCancel={close} closable={!locked} keyboard={!locked} mask={{ closable: !locked }} destroyOnHidden>
      {feedback}
      <Form layout="vertical" disabled={busy} onFinish={saveBatch}>
        <Form.Item label={t('工序数据')} htmlFor="operation-batch-text" extra={t('从 Excel 粘贴工序编码、工序名称两列，每次最多 100 行。')}>
          <Input.TextArea id="operation-batch-text" rows={6} disabled={locked} value={batchText} onChange={event => { setBatchText(event.target.value); setBatchIssues([]); setError(undefined); setDirty(!!event.target.value.trim()); }} />
        </Form.Item>
        {batchIssues.length > 0 && <Alert type="error" role="alert" title={t('请修正以下数据')} description={<ul>{batchIssues.map(issue => <li key={issue}>{issue}</li>)}</ul>} />}
        <Space><Button disabled={locked} onClick={close}>{t('取消')}</Button>{unknown ? <Button type="primary" loading={busy} onClick={() => void execute()}>{t('重试原请求')}</Button> : <Button type="primary" htmlType="submit" loading={busy}>{t('保存')}</Button>}</Space>
      </Form>
    </Modal>
    <Modal open={!!removing} title={t('删除板块规则')} onCancel={close} closable={!locked} keyboard={!locked} mask={{ closable: !locked }} destroyOnHidden footer={<Space><Button disabled={locked} onClick={close}>{t('取消')}</Button><Button danger type="primary" loading={busy} onClick={() => { if (unknown) void execute(); else if (removing) void execute({ path: `${sectorPath}/${removing.id}?organizationId=${encodeURIComponent(organization.id)}&expectedVersion=${removing.version}`, method: 'DELETE' }); }}>{t(unknown ? '重试原请求' : '确认删除')}</Button></Space>}>
      {feedback}<p>{removing?.operationName} → {removing?.sectorName}</p>
    </Modal>
  </Card>;
}
