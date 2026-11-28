import type { components } from '@qms/contracts';
import { Alert, Badge, Button, Card, Drawer, Empty, Form, Input, Modal, Pagination, Select, Space, Spin, Switch, Tabs, Tag, Typography } from 'antd';
import { RecordList, RecordListDetails } from '../../ui/list/RecordList';
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest, csrfToken, safeAccountError } from '../../api/client';
import { QmsLoading } from '../../components/QmsLoading';
import { useLanguage } from '../../i18n/Language';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useLedgerPageSize } from '../../ui/ledger';
import './announcements.css';
import { ListToolbar } from '../../ui/list/ListToolbar';

type AnnouncementInput = components['schemas']['AnnouncementInputDto'];
type MinePage = components['schemas']['AnnouncementMinePageDto'];
type MineItem = components['schemas']['AnnouncementMineItemDto'];
type ManagePage = components['schemas']['AnnouncementManagePageDto'];
type ManageItem = components['schemas']['AnnouncementManageItemDto'];
type Receipt = components['schemas']['AnnouncementReceiptDto'];
type AudienceUsers = components['schemas']['AnnouncementAudienceUsersDto'];

const basePath = '/api/v1/announcements';
const statusLabel: Record<string, string> = { DRAFT: '草稿', PUBLISHED: '已发布', ARCHIVED: '已归档' };

function denied(error: unknown) { return error instanceof ApiError && error.status === 403; }
function formatDate(value: unknown) { return typeof value === 'string' ? new Date(value).toLocaleString('zh-CN') : ''; }

export function AnnouncementsPage() {
  const [managePageSize, setManagePageSize] = useLedgerPageSize('announcements-management');
  const requestLeave = useNavigationGuard();
  const [mine, setMine] = useState<MinePage>();
  const [managed, setManaged] = useState<ManagePage>();
  const [users, setUsers] = useState<AudienceUsers>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>();
  const [mutationError, setMutationError] = useState<unknown>();
  const [revision, setRevision] = useState(0);
  const [managePageIndex, setManagePageIndex] = useState(1);
  const [activeTab, setActiveTab] = useState('mine');
  const [editor, setEditor] = useState<ManageItem | 'new'>();
  const [archiveTarget, setArchiveTarget] = useState<ManageItem>();
  const [auditId, setAuditId] = useState<string>();
  const [receipts, setReceipts] = useState<Receipt[]>();
  const [auditError, setAuditError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ signature: string; key: string } | undefined>(undefined);
  const auditGeneration = useRef(0);
  useNavigationBusy(busy && !!archiveTarget);

  useEffect(() => () => { auditGeneration.current += 1; }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(undefined);
    setMine(undefined);
    setManaged(undefined);
    setUsers(undefined);
    Promise.all([
      apiRequest<MinePage>(basePath + '/mine', { signal: controller.signal }),
      apiRequest<ManagePage>(basePath + '/manage?page=' + managePageIndex + '&pageSize=' + managePageSize, { signal: controller.signal }).catch((error: unknown) => { if (denied(error)) return undefined; throw error; }),
    ]).then(([minePage, managePage]) => {
      if (controller.signal.aborted) return;
      setMine(minePage);
      setManaged(managePage);
      if (managePage) void apiRequest<AudienceUsers>(basePath + '/audience-users', { signal: controller.signal }).then((value) => { if (!controller.signal.aborted) setUsers(value); }).catch((error: unknown) => { if (!controller.signal.aborted) setLoadError(error); });
    }).catch((error: unknown) => { if (!controller.signal.aborted) setLoadError(error); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision, managePageIndex, managePageSize]);

  async function mutate<T>(path: string, method: 'POST' | 'PUT', body?: unknown) {
    const signature = JSON.stringify([path, method, body]);
    if (pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
    const token = await csrfToken();
    const result = await apiRequest<T>(path, { method, headers: { 'x-csrf-token': token, 'Idempotency-Key': pending.current.key }, body: body === undefined ? undefined : JSON.stringify(body) });
    pending.current = undefined;
    return result;
  }

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setMutationError(undefined);
    try { await action(); setRevision((value) => value + 1); }
    catch (error) { setMutationError(error); }
    finally { setBusy(false); }
  }

  async function save(input: AnnouncementInput) {
    await act(async () => {
      if (editor && editor !== 'new') await mutate(basePath + '/' + editor.id, 'PUT', { ...input, expectedVersion: editor.version });
      else { await mutate(basePath, 'POST', input); setManagePageIndex(1); }
      setEditor(undefined);
    });
  }

  function confirmArchive() {
    if (busy || !archiveTarget || !managed?.items.some(item => item.id === archiveTarget.id && item.version === archiveTarget.version && item.status === 'PUBLISHED')) return;
    void act(async () => {
      await mutate(`${basePath}/${archiveTarget.id}/archive`, 'POST', { expectedVersion: archiveTarget.version });
      setArchiveTarget(undefined);
    });
  }

  async function showReceipts(id: string) {
    const generation = ++auditGeneration.current;
    setAuditId(id);
    setReceipts(undefined);
    setAuditError(undefined);
    try {
      const result = await apiRequest<Receipt[]>(basePath + '/' + id + '/receipts');
      if (generation === auditGeneration.current) setReceipts(result);
    } catch (error) { if (generation === auditGeneration.current) setAuditError(error); }
  }

  function closeReceipts() {
    auditGeneration.current += 1;
    setAuditId(undefined); setReceipts(undefined); setAuditError(undefined);
  }

  const error = (archiveTarget ? undefined : mutationError) ?? loadError;
  return <section className="announcements-page">
    <header className="announcements-heading">
      <h1 className="sr-only">公告中心</h1>
      <Space><Button onClick={() => setRevision((value) => value + 1)} loading={loading}>刷新</Button>{managed && (activeTab !== 'manage' || loading) && <Button type="primary" onClick={() => setEditor('new')}>新建公告</Button>}</Space>
    </header>
    {Boolean(error) && <Alert type={denied(error) ? 'warning' : 'error'} showIcon title={safeAccountError(error)} description={error instanceof ApiError ? error.traceId : undefined} />}
    {loading ? <div className="announcements-loading"><Spin /></div> : mine && <Tabs activeKey={managed ? activeTab : 'mine'} onChange={setActiveTab} items={[
      { key: 'mine', label: <Badge count={mine.unreadMustReadCount} size="small">我的公告</Badge>, children: <Space orientation="vertical" size={6} className="announcements-column">
        {mine.unreadMustReadCount > 0 && <Alert type="warning" showIcon title={mine.unreadMustReadCount + ' 条重要公告待阅读'} />}
        <RecordList items={mine.items} itemKey={item => item.id} empty={<Empty description="暂无面向我的公告" />} renderItem={(item: MineItem) => <Card className="announcements-item" title={<Space wrap><span>{item.title}</span>{item.importance === 'IMPORTANT' && <Tag color="orange">重要</Tag>}{item.mustRead && <Tag color="red">必读</Tag>}</Space>} extra={<Tag>{item.readAt ? '已读' : '未读'}</Tag>}><Typography.Paragraph className="announcements-content">{item.content}</Typography.Paragraph><Space wrap><Typography.Text type="secondary">{formatDate(item.publishedAt)}</Typography.Text>{!item.readAt && <Button type="primary" loading={busy} onClick={() => void act(async () => { await mutate(basePath + '/' + item.id + '/read', 'POST'); window.dispatchEvent(new Event('qms:announcement-read')); })}>我已阅读</Button>}</Space></Card>} />
      </Space> },
      ...(managed ? [{ key: 'manage', label: '公告管理', children: <div className="announcements-column">
        <ListToolbar>
          {activeTab === 'manage' && <div><Button type="primary" onClick={() => setEditor('new')}>新建公告</Button></div>}
          <Pagination current={managed.page} pageSize={managePageSize} total={managed.total} showSizeChanger pageSizeOptions={[10, 20, 50, 100]} onChange={(page, size) => { if (!busy) requestLeave(() => { setManagePageIndex(size === managePageSize ? page : 1); setManagePageSize(size); }); }} showTotal={(total) => '共 ' + total + ' 条'} />
        </ListToolbar>
        <RecordList items={managed.items} itemKey={item => item.id} empty={<Empty description="暂无公告" />} renderItem={(item: ManageItem) => <Card className="announcements-item" title={<Space wrap><span>{item.title}</span><Tag>{statusLabel[item.status] ?? item.status}</Tag>{item.mustRead && <Tag color="red">必读</Tag>}</Space>} extra={<Space wrap><Typography.Text type="secondary">阅读 {item.readCount}/{item.recipientCount}</Typography.Text></Space>}>
          <Typography.Paragraph className="announcements-content">{item.content}</Typography.Paragraph>
          <Space wrap>
            {item.status === 'DRAFT' && <><Button onClick={() => setEditor(item)}>编辑</Button><Button type="primary" loading={busy} onClick={() => void act(() => mutate(basePath + '/' + item.id + '/publish', 'POST', { expectedVersion: item.version }))}>发布</Button></>}
            {item.status === 'PUBLISHED' && <Button disabled={busy} onClick={() => { setMutationError(undefined); setArchiveTarget(item); }}>归档</Button>}
            {item.status !== 'DRAFT' && <Button onClick={() => void showReceipts(item.id)}>阅读审计</Button>}
          </Space>
        </Card>} />
      </div> }] : []),
    ]} />}
    <Modal open={!!archiveTarget} title={archiveTarget && `归档公告 · ${archiveTarget.title}`} onOk={confirmArchive} onCancel={() => { if (!busy) setArchiveTarget(undefined); }}
      okText="确认归档" cancelText="取消" confirmLoading={busy} cancelButtonProps={{ disabled: busy }} closable={!busy} keyboard={!busy} mask={{ closable: false }}>
      <p>接收人将不再看到此公告，阅读记录保留。</p>
      {Boolean(mutationError) && <Alert type={denied(mutationError) ? 'warning' : 'error'} showIcon title={safeAccountError(mutationError)} description={mutationError instanceof ApiError ? mutationError.traceId : undefined} />}
    </Modal>
    {editor && <AnnouncementEditor key={editor === 'new' ? 'new' : editor.id} initial={editor === 'new' ? undefined : editor} users={users?.items ?? []} totalUsers={users?.total} audienceReadFailed={!!loadError || (!loading && !managed)} retryAudience={() => setRevision(value => value + 1)} busy={busy} error={mutationError} close={() => { setEditor(undefined); setMutationError(undefined); }} save={save} />}
    <Drawer title="阅读审计" open={!!auditId} onClose={closeReceipts} size={560}>{Boolean(auditError) && <Alert type={denied(auditError) ? 'warning' : 'error'} title={safeAccountError(auditError)} />}{!receipts && !auditError ? <Spin /> : <RecordList items={receipts ?? []} itemKey={receipt => receipt.userId} empty={<Empty description="暂无阅读记录" />} renderItem={(receipt) => <><RecordListDetails title={users?.items.find((user) => user.id === receipt.userId)?.username ?? receipt.userId} description={receipt.readAt ? '已读：' + formatDate(receipt.readAt) : '未读'} />{receipt.readTraceId && <Typography.Text type="secondary" copyable>{String(receipt.readTraceId)}</Typography.Text>}</>} />}</Drawer>
  </section>;
}

function AnnouncementEditor({ initial, users, totalUsers, audienceReadFailed, retryAudience, busy, error, close, save }: { initial?: ManageItem; users: AudienceUsers['items']; totalUsers?: number; audienceReadFailed: boolean; retryAudience: () => void; busy: boolean; error: unknown; close: () => void; save: (input: AnnouncementInput) => Promise<void> }) {
  const { locale } = useLanguage();
  const [form] = Form.useForm<AnnouncementInput>();
  const [dirty, setDirty] = useState(false);
  const requestLeave = useNavigationGuard();
  useUnsavedChanges(dirty);
  useNavigationBusy(busy);
  function requestClose() {
    if (busy) return;
    requestLeave(() => { setDirty(false); form.resetFields(); close(); });
  }
  const audience = Form.useWatch('audience', form);
  return <Modal open title={initial ? '编辑公告草稿' : '新建公告'} footer={null} onCancel={requestClose} closable={!busy} keyboard={!busy} mask={{ closable: false }} width={720}>
    {Boolean(error) && <Alert type="error" showIcon title={safeAccountError(error)} />}
    <Form form={form} layout="vertical" onValuesChange={() => setDirty(true)} onFinish={(value) => void save(value)} disabled={busy} initialValues={initial ? { title: initial.title, content: initial.content, importance: initial.importance as AnnouncementInput['importance'], mustRead: initial.mustRead, audience: initial.audience as AnnouncementInput['audience'], recipientUserIds: initial.recipientUserIds } : { importance: 'NORMAL', mustRead: false, audience: 'ALL', recipientUserIds: [] }}>
      <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}><Input maxLength={200} /></Form.Item>
      <Form.Item name="content" label="正文" rules={[{ required: true, message: '请输入正文' }]}><Input.TextArea rows={7} maxLength={20000} /></Form.Item>
      <Space wrap className="announcements-form-options"><Form.Item name="importance" label="级别" rules={[{ required: true }]}><Select options={[{ value: 'NORMAL', label: '普通' }, { value: 'IMPORTANT', label: '重要' }]} style={{ width: 130 }} /></Form.Item><Form.Item name="mustRead" label="必读" valuePropName="checked"><Switch /></Form.Item><Form.Item name="audience" label="发布范围" rules={[{ required: true }]}><Select options={[{ value: 'ALL', label: '本组织全部内部用户' }, { value: 'SELECTED', label: '指定用户' }]} onChange={(value) => { if (value === 'ALL') form.setFieldValue('recipientUserIds', []); }} style={{ width: 220 }} /></Form.Item></Space>
      {audience === 'SELECTED' && <>
        <Form.Item name="recipientUserIds" label="指定接收人" rules={[{ required: true, type: 'array', min: 1, max: 1000, message: '请选择 1 至 1000 位接收人' }]}><Select mode="multiple" showSearch optionFilterProp="label" options={users.map((user) => ({ value: user.id, label: user.username }))} /></Form.Item>
        <Typography.Paragraph type="secondary">指定接收人最多 1000 位。{totalUsers === undefined ? null : totalUsers > 1000 ? '本组织有 ' + totalUsers + ' 位内部用户，此处仅显示前 1000 位；如需覆盖所有人，请选择全组织范围。' : '可选 ' + totalUsers + ' 位内部用户。'}</Typography.Paragraph>
        {totalUsers === undefined && (audienceReadFailed
          ? <Alert type="error" title={locale === 'en-US' ? 'Could not load recipients' : '接收人名单加载失败'} action={<Button size="small" disabled={busy} onClick={retryAudience}>{locale === 'en-US' ? 'Retry' : '重试'}</Button>} />
          : <QmsLoading label={locale === 'en-US' ? 'Loading recipients' : '正在加载接收人名单'} />)}
      </>}
      <Typography.Paragraph type="secondary">发布时锁定接收人名单；发布后正文与名单不可修改。</Typography.Paragraph>
      <div className="qms-dialog-actions" role="group" aria-label={initial ? '编辑公告草稿' : '新建公告'}><Button onClick={requestClose}>取消</Button><Button type="primary" htmlType="submit" loading={busy}>保存草稿</Button></div>
    </Form>
  </Modal>;
}
