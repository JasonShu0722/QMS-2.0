import { useEffect, useState } from 'react';
import { Alert, Button, Empty, Space, Spin, Table, Tag } from 'antd';
import { Link, useLocation } from 'react-router-dom';
import type { components } from '@qms/contracts';
import { apiRequest, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';

type Task = components['schemas']['CustomerFaeAnalysisTaskDto'];

export function CustomerFaeTaskInbox() {
  const session = useWorkTabsStore(state => state.sessionScope);
  const { search } = useLocation();
  const organizationId = new URLSearchParams(search).get('organizationId');
  return <Inbox key={JSON.stringify([session, organizationId])} session={session} organizationId={organizationId} />;
}

function Inbox({ session, organizationId }: { session?: string; organizationId: string | null }) {
  const { t } = useLanguage();
  const [tasks, setTasks] = useState<Task[]>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const unsubscribe = useWorkTabsStore.subscribe(state => {
      if (state.sessionScope !== session) controller.abort();
    });
    const query = new URLSearchParams();
    if (organizationId) query.set('organizationId', organizationId);
    setTasks(undefined); setError(undefined); setLoading(true);
    const current = () => !controller.signal.aborted && useWorkTabsStore.getState().sessionScope === session;
    apiRequest<Task[]>(`/api/v1/customer-quality/analysis/fae-tasks?${query}`, { signal: controller.signal })
      .then(result => { if (current()) setTasks(result); })
      .catch(cause => { if (current()) { setTasks(undefined); setError(cause); } })
      .finally(() => { if (current()) setLoading(false); });
    return () => { controller.abort(); unsubscribe(); };
  }, [session, organizationId, revision]);
  return <Space orientation="vertical" style={{ width: '100%' }}>
    <Button onClick={() => setRevision(value => value + 1)} disabled={loading}>{t('刷新解析待办')}</Button>
    {error ? <Alert type="error" showIcon title={safeAccountError(error)} /> : null}
    {loading ? <Spin aria-label={t('正在加载解析待办')} /> : tasks && <Table<Task>
      rowKey={item => item.analysis.id} dataSource={tasks} pagination={{ pageSize: 20, showSizeChanger: false }}
      locale={{ emptyText: <Empty description={t('暂无待解析客诉')} /> }}
      columns={[
        { title: t('任务'), key: 'task', render: (_, item) => <Link to={`/app/customer-quality?${new URLSearchParams({ complaintId: item.analysis.complaintId, organizationId: item.analysis.organizationId })}`}>{t('查看客诉并解析')}</Link> },
        { title: t('解析状态'), key: 'status', render: (_, item) => <Tag>{t(item.analysis.faeStatus === 'ANALYSED' ? '已解析' : '未解析')}</Tag> },
        { title: t('解析完成日期'), key: 'completed', render: (_, item) => item.analysis.completedOn ?? '—' },
      ]}
    />}
  </Space>;
}
