import { useEffect, useState, type RefObject } from 'react';
import { Alert, Button, Space, Spin, Table, Typography } from 'antd';
import { Link } from 'react-router-dom';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { verificationLabels } from '../process-quality/process-ledger';

type Task = components['schemas']['SupplierSourceCollaborationTaskDto'];
type Page = components['schemas']['SupplierSourceCollaborationPageDto'];
const sources = { PROCESS_LEDGER: '过程来源', CUSTOMER_LEDGER: '客户来源', NEW_PRODUCT_SELECTION: '新品来源' };

export function useSupplierSourceCollaboration(organizationId: string | null, lifetime: RefObject<AbortController>, current: () => boolean, onDenied: () => void, enabled: boolean) {
  const [data, setData] = useState<Page>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState<{ cursor?: string }>({});
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const signal = lifetime.current.signal;
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort);
    const active = () => current() && !controller.signal.aborted;
    setError(undefined); setLoading(true);
    if (!request.cursor) setData(undefined);
    const query = new URLSearchParams();
    if (organizationId) query.set('organizationId', organizationId);
    query.set('scanLimit', '25');
    if (request.cursor) query.set('cursor', request.cursor);
    if (active()) void apiRequest<Page>(`/api/v1/supplier-quality/source-collaboration/tasks?${query}`, { signal: controller.signal }, { replayAfterReauthentication: false })
      .then(page => {
        if (!active()) return;
        setData(previous => request.cursor && previous ? {
          items: [...new Map([...previous.items, ...page.items].map(item => [item.id, item])).values()],
          scannedCount: previous.scannedCount + page.scannedCount, nextCursor: page.nextCursor,
        } : page);
      }).catch(cause => {
        if (!active()) return;
        if (cause instanceof ApiError && [401, 403].includes(cause.status ?? 0)) { onDenied(); return; }
        setError(cause);
      }).finally(() => { if (active()) setLoading(false); });
    return () => { controller.abort(); signal.removeEventListener('abort', abort); };
  }, [organizationId, lifetime, current, onDenied, enabled, request]);
  return { data, error, loading, refresh: () => setRequest({}), retry: () => setRequest({ ...request }), more: () => { if (data?.nextCursor && !loading) setRequest({ cursor: data.nextCursor }); } };
}

export function SupplierSourceCollaborationInbox({ data, error, loading, refresh, retry, more }: ReturnType<typeof useSupplierSourceCollaboration>) {
  const { t } = useLanguage();
  const text = (value: string | null) => value ?? t('未填写');
  return <section aria-label={t('SQE来源协作跟进')}>
    <Space wrap><Typography.Title level={3}>{t('SQE来源协作跟进')}</Typography.Title><Button disabled={loading} onClick={refresh}>{t('刷新来源协作')}</Button></Space>
    {error ? <Alert type="error" showIcon title={t('来源协作加载失败，请重试')}
      description={<>{t(safeAccountError(error))}{error instanceof ApiError && error.traceId && <code> {error.traceId}</code>}</>}
      action={<Button onClick={retry}>{t('重试来源协作')}</Button>} /> : null}
    {loading && <Spin aria-label={t('正在加载来源协作')} />}
    {data && <>
      <div role="group" aria-label={t('SQE来源协作表格')} tabIndex={0} style={{ overflowX: 'auto', maxWidth: '100%' }}>
        <Table<Task> size="small" style={{ minWidth: 900 }} rowKey="id" pagination={false} dataSource={data.items}
          locale={{ emptyText: t('暂无SQE来源协作跟进') }} columns={[
            { title: t('协作事项'), dataIndex: 'title' },
            { title: t('来源类型'), render: (_, task) => t(sources[task.sourceKind] ?? task.sourceKind) },
            { title: t('来源标识'), dataIndex: 'sourceId' },
            { title: t('物料项标识'), dataIndex: 'materialItemId' },
            { title: t('复核状态'), render: (_, task) => task.verification ? t(verificationLabels[task.verification] ?? task.verification) : t('暂无复核状态') },
            { title: t('进展'), render: (_, task) => <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text(task.progress)}</span> },
            { title: t('结果'), render: (_, task) => <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text(task.result)}</span> },
            { title: t('操作'), render: (_, task) => <Link to={task.link}>{t('查看来源')}</Link> },
          ]} />
      </div>
      <p>{t('当前已加载协作')}：{data.items.length}</p><p>{t('协作已扫描问题')}：{data.scannedCount}</p>
      {data.nextCursor && <Button disabled={loading} onClick={more}>{t('加载更多来源协作')}</Button>}
    </>}
  </section>;
}
