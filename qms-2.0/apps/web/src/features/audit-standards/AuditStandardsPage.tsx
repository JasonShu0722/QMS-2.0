import type { components } from '@qms/contracts';
import { Alert, Button, Card, Drawer, Empty, Form, Input, List, Select, Space, Spin, Tag, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest, csrfToken, safeAccountError } from '../../api/client';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import './audit-standards.css';

type StandardPage = components['schemas']['AuditStandardPageDto'];
type StandardItem = components['schemas']['AuditStandardItemDto'];
type StandardDetail = components['schemas']['AuditStandardDetailDto'];
type CreateTemplate = components['schemas']['CreateAuditStandardDto'];
type UpdateTemplate = components['schemas']['UpdateAuditStandardDto'];
type EditorValues = { name: string; auditType: CreateTemplate['auditType']; items: { key: string; text: string }[] };

const path = '/api/v1/audit-standards/templates';
const auditTypes: { value: CreateTemplate['auditType']; label: string }[] = [
  { value: 'SYSTEM', label: '体系审核' }, { value: 'PROCESS', label: '过程审核' },
  { value: 'PRODUCT', label: '产品审核' }, { value: 'SECOND_PARTY', label: '第二方审核' },
  { value: 'CUSTOMER', label: '客户审核' },
];

function denied(error: unknown) { return error instanceof ApiError && error.status === 403; }
function items(definition: StandardDetail['draftDefinition']): EditorValues['items'] {
  return definition.items.filter((value) => typeof value?.key === 'string' && typeof value?.text === 'string');
}

export function AuditStandardsPage() {
  const [catalog, setCatalog] = useState<StandardPage>();
  const [detail, setDetail] = useState<StandardDetail>();
  const [search, setSearch] = useState('');
  const [auditType, setAuditType] = useState<CreateTemplate['auditType']>();
  const [filters, setFilters] = useState({ search: '', auditType: undefined as CreateTemplate['auditType'] | undefined });
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<unknown>();
  const [actionError, setActionError] = useState<unknown>();
  const [editor, setEditor] = useState<'new' | 'draft' | 'revision'>();
  const [dirty, setDirty] = useState(false);
  const [revision, setRevision] = useState(0);
  const pending = useRef<{ signature: string; key: string } | undefined>(undefined);
  const requestLeave = useNavigationGuard();
  useUnsavedChanges(dirty);
  useNavigationBusy(busy);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(undefined);
    const params = new URLSearchParams();
    if (filters.search) params.set('search', filters.search);
    if (filters.auditType) params.set('auditType', filters.auditType);
    apiRequest<StandardPage>(`${path}${params.size ? `?${params}` : ''}`, { signal: controller.signal })
      .then((page) => { if (!controller.signal.aborted) setCatalog(page); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setLoadError(error); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filters, revision]);

  async function showDetail(id: string) {
    setDetailLoading(true);
    setActionError(undefined);
    try { setDetail(await apiRequest<StandardDetail>(`${path}/${id}`)); }
    catch (error) { setActionError(error); }
    finally { setDetailLoading(false); }
  }

  async function mutate<T>(url: string, method: 'POST' | 'PUT', body: unknown) {
    const signature = JSON.stringify([url, method, body]);
    if (pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
    const result = await apiRequest<T>(url, { method, headers: { 'x-csrf-token': await csrfToken(), 'Idempotency-Key': pending.current.key }, body: JSON.stringify(body) });
    pending.current = undefined;
    return result;
  }

  async function act(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setActionError(undefined);
    try { await action(); setRevision((value) => value + 1); }
    catch (error) { setActionError(error); }
    finally { setBusy(false); }
  }

  async function save(values: EditorValues) {
    await act(async () => {
      const definition = { items: values.items.map((item) => ({ key: item.key.trim(), text: item.text.trim() })) };
      if (editor === 'new') {
        const input: CreateTemplate = { name: values.name.trim(), auditType: values.auditType, definition };
        const created = await mutate<{ id: string }>(path, 'POST', input);
        await showDetail(created.id);
      } else if (detail) {
        const input: UpdateTemplate = { expectedVersion: detail.version, definition };
        await mutate(`${path}/${detail.id}${editor === 'revision' ? '/revisions' : ''}`, editor === 'revision' ? 'POST' : 'PUT', input);
        await showDetail(detail.id);
      }
      setDirty(false);
      setEditor(undefined);
    });
  }

  async function publish() {
    if (!detail) return;
    await act(async () => { await mutate(`${path}/${detail.id}/publish`, 'POST', { expectedVersion: detail.version }); await showDetail(detail.id); });
  }

  return <main className="audit-standards-page">
    <header className="audit-standards-heading">
      <h1 className="sr-only">审核标准库</h1>
      <Button type="primary" onClick={() => setEditor('new')}>新建标准</Button>
    </header>
    <section className="audit-standards-card" aria-label="审核标准目录" role="region">
      <Space wrap className="audit-standards-filters">
        <Input aria-label="标准名称" placeholder="按名称查找" value={search} onChange={(event) => setSearch(event.target.value)} onPressEnter={() => setFilters({ search: search.trim(), auditType })} />
        <Select aria-label="审核类型" placeholder="所有审核类型" allowClear value={auditType} onChange={setAuditType} options={auditTypes} className="audit-standards-type" />
        <Button onClick={() => setFilters({ search: search.trim(), auditType })}>查询</Button>
        <Button onClick={() => setRevision((value) => value + 1)} loading={loading}>刷新</Button>
      </Space>
      {Boolean(loadError) && <Alert showIcon type={denied(loadError) ? 'warning' : 'error'} title={denied(loadError) ? '暂无审核标准访问权限' : '审核标准加载失败，请重试'} description={safeAccountError(loadError)} />}
      {loading ? <div className="audit-standards-loading"><Spin /></div> : !loadError && <List dataSource={catalog?.items ?? []} locale={{ emptyText: <Empty description="暂无审核标准" /> }} renderItem={(standard: StandardItem) => <List.Item key={standard.id} actions={[<Button key="detail" onClick={() => requestLeave(() => { setEditor(undefined); setDirty(false); void showDetail(standard.id); })}>查看版本</Button>]}><List.Item.Meta title={<Space wrap><span>{standard.name}</span><Tag>{auditTypes.find((item) => item.value === standard.auditType)?.label}</Tag><Tag color={standard.status === 'PUBLISHED' ? 'green' : 'orange'}>{standard.status === 'PUBLISHED' ? '已生效' : '草稿'}</Tag></Space>} description={`最新生效版本 v${standard.latestVersion} · 编辑版本 ${standard.version}`} /></List.Item>} />}
    </section>
    {Boolean(actionError) && !detail && !editor && <Alert showIcon type="error" title={safeAccountError(actionError)} />}
    <Drawer title={detail?.name ?? '标准详情'} open={!!detail || detailLoading} onClose={() => { setDetail(undefined); setActionError(undefined); }} width={680}>
      {detailLoading && <Spin />}
      {Boolean(actionError) && <Alert type="error" showIcon title={safeAccountError(actionError)} />}
      {detail && !detailLoading && <Space orientation="vertical" size={6} className="audit-standards-column">
        <Space wrap><Tag>{auditTypes.find((item) => item.value === detail.auditType)?.label}</Tag><Tag color={detail.status === 'PUBLISHED' ? 'green' : 'orange'}>{detail.status === 'PUBLISHED' ? '已生效' : '草稿'}</Tag><Typography.Text type="secondary">最新生效 v{detail.latestVersion}</Typography.Text></Space>
        <Space>{detail.status === 'DRAFT' ? <><Button onClick={() => setEditor('draft')}>编辑草稿</Button><Button type="primary" loading={busy} onClick={() => void publish()}>发布生效</Button><Typography.Text type="secondary">发布后本版检查项不可修改。</Typography.Text></> : <Button onClick={() => setEditor('revision')}>创建修订</Button>}</Space>
        {detail.status === 'DRAFT' && <Card size="small" title="待发布检查项"><ChecklistItems definition={detail.draftDefinition} /></Card>}
        <Typography.Title level={4}>已生效版本</Typography.Title>
        <List dataSource={detail.versions} locale={{ emptyText: <Empty description="尚未发布版本" /> }} renderItem={(version) => <List.Item key={version.id}><Card className="audit-standards-version" size="small" title={`v${version.version}`} extra={<Typography.Text type="secondary">{new Date(version.publishedAt).toLocaleString('zh-CN')}</Typography.Text>}><ChecklistItems definition={version.definition} /><Typography.Text type="secondary" copyable>{version.id}</Typography.Text></Card></List.Item>} />
      </Space>}
    </Drawer>
    <Drawer aria-label={editor === 'new' ? '新建审核标准' : editor === 'revision' ? '创建标准修订' : '编辑标准草稿'} title={editor === 'new' ? '新建审核标准' : editor === 'revision' ? '创建标准修订' : '编辑标准草稿'} open={!!editor} onClose={() => requestLeave(() => { setEditor(undefined); setDirty(false); }, true)} width={620} destroyOnHidden>
      {editor && <Form<EditorValues> key={`${editor}-${detail?.id ?? 'new'}`} layout="vertical" disabled={busy} onValuesChange={() => setDirty(true)} onFinish={(values) => void save(values)} initialValues={editor === 'new' ? { auditType: 'PROCESS', items: [{ key: '', text: '' }] } : { name: detail?.name, auditType: detail?.auditType, items: items(detail?.draftDefinition ?? { items: [] }) }}>
        {Boolean(actionError) && <Alert type="error" showIcon title={safeAccountError(actionError)} />}
        {editor === 'new' && <><Form.Item name="name" label="标准名称" rules={[{ required: true, whitespace: true }]}><Input maxLength={300} /></Form.Item><Form.Item name="auditType" label="审核类型" rules={[{ required: true }]}><Select options={auditTypes} /></Form.Item></>}
        <Form.List name="items">{(fields, { add, remove }) => <Space orientation="vertical" className="audit-standards-column">{fields.map((field) => <Space key={field.key} align="baseline" className="audit-standards-item-editor"><Form.Item name={[field.name, 'key']} rules={[{ required: true, whitespace: true }]}><Input placeholder="检查项编号" maxLength={120} /></Form.Item><Form.Item name={[field.name, 'text']} rules={[{ required: true, whitespace: true }]}><Input.TextArea placeholder="检查内容" maxLength={2000} autoSize={{ minRows: 1, maxRows: 4 }} /></Form.Item><Button onClick={() => remove(field.name)} disabled={fields.length === 1}>删除</Button></Space>)}<Button onClick={() => add({ key: '', text: '' })}>添加检查项</Button></Space>}</Form.List>
        <Form.Item className="audit-standards-submit"><div className="qms-dialog-actions" role="group" aria-label={editor === 'new' ? '新建审核标准' : editor === 'revision' ? '创建标准修订' : '编辑标准草稿'}><Button type="primary" htmlType="submit" loading={busy}>保存</Button></div></Form.Item>
      </Form>}
    </Drawer>
  </main>;
}

function ChecklistItems({ definition }: { definition: StandardDetail['draftDefinition'] }) {
  return <List size="small" dataSource={items(definition)} renderItem={(item) => <List.Item key={item.key}><Typography.Text strong>{item.key}</Typography.Text><Typography.Text>{item.text}</Typography.Text></List.Item>} />;
}
