import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Empty, List, Pagination, Space, Spin, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { ApiError, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { listSupplierNotifications, readSupplierNotification, type SupplierNotificationPage } from './supplierNotifications';
import './supplier-notifications.css';

const pageSize = 25;

function InboxError({ cause }: { cause: unknown }) {
  const { t } = useLanguage();
  if (!cause) return null;
  return <Alert type="error" showIcon title={t(safeAccountError(cause))}
    description={cause instanceof ApiError && cause.traceId ? <span>{t('追踪标识')}：<code>{cause.traceId}</code></span> : undefined} />;
}

export function SupplierNotificationsPage() {
  const { t, locale } = useLanguage();
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<SupplierNotificationPage>();
  const [error, setError] = useState<unknown>();
  const [mutationError, setMutationError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string>();
  const writing = useRef(false);
  const refresh = () => setRevision((value) => value + 1);
  const date = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setData(undefined);
    setError(undefined);
    listSupplierNotifications({ pageSize, offset }, controller.signal).then((page) => {
      if (!controller.signal.aborted) setData(page);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [offset, revision]);

  async function markRead(id: string, version: number) {
    if (writing.current) return;
    writing.current = true;
    setPendingId(id);
    setMutationError(undefined);
    try { await readSupplierNotification(id, version); }
    catch (cause) { setMutationError(cause); }
    finally { writing.current = false; setPendingId(undefined); refresh(); }
  }

  return <section className="supplier-notifications">
    <div className="supplier-notifications__header">
      <div><Typography.Title level={2}>{t('我的待办')}</Typography.Title><Typography.Paragraph type="secondary">{t('我的通知')}</Typography.Paragraph></div>
      <Button aria-label={t('刷新')} onClick={refresh} disabled={loading}>{t('刷新')}</Button>
    </div>
    <InboxError cause={mutationError} />
    <InboxError cause={error} />
    {loading ? <Spin aria-label={t('正在加载通知')} /> : data && <>
      <List dataSource={data.items} locale={{ emptyText: <Empty description={t('暂无通知')} /> }} renderItem={(notice) =>
        <List.Item key={notice.id}>
          <Card className="supplier-notifications__card qms-display-card" title={notice.subject ?? t(notice.kind === 'TASK_REMINDER' ? '时限提醒' : '任务分配')}
            extra={<Tag>{t(notice.readAt ? '已读' : '未读')}</Tag>}>
            <Typography.Paragraph className="supplier-notifications__body">{notice.body}</Typography.Paragraph>
            <Space wrap>
              <span>{notice.nodeName}</span><time dateTime={notice.createdAt}>{date(notice.createdAt)}</time>
              <Link to={`/supplier/corrections/problems/${notice.problemId}`}>{t('查看关联问题')}</Link>
              {!notice.readAt && <Button loading={pendingId === notice.id} disabled={!!pendingId}
                onClick={() => void markRead(notice.id, notice.version)}>{t('标为已读')}</Button>}
            </Space>
          </Card>
        </List.Item>} />
      <Pagination current={offset / pageSize + 1} pageSize={pageSize} total={Math.min(data.total, 10000 + pageSize)}
        showSizeChanger={false} onChange={(page) => setOffset((page - 1) * pageSize)} showTotal={() => `${t('总数')}：${data.total}`} />
    </>}
  </section>;
}
