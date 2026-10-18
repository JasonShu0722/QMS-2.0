import { useEffect, useState } from 'react';
import { Card, Table } from 'antd';
import type { components } from '@qms/contracts';
import { getAccountSessionHistory } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { GovernanceFeedback } from '../governance/GovernanceFeedback';
import { accountAvatarEpoch } from './account-avatar-state';

export function AccountSessionHistory({ revision }: { revision: number }) {
  const { t, locale } = useLanguage();
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [data, setData] = useState<components['schemas']['AccountSessionHistoryPageDto']>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    const epoch = accountAvatarEpoch();
    setLoading(true); setError(undefined); setData(undefined);
    void getAccountSessionHistory(page).then(result => {
      if (active && epoch === accountAvatarEpoch()) setData(result);
    }).catch(cause => {
      if (active && epoch === accountAvatarEpoch()) setError(cause);
    }).finally(() => { if (active && epoch === accountAvatarEpoch()) setLoading(false); });
    return () => { active = false; };
  }, [page, retry, revision]);
  const date = (value: string | null) => value ? new Date(value).toLocaleString(locale) : '—';
  const lifetime = { STANDARD: '标准会话', REMEMBERED_ADMIN: '管理员记住登录', REMEMBERED_USER: '用户记住登录' };
  const status = { ACTIVE: '有效', REVOKED: '已撤销', EXPIRED: '已过期' };
  return <section aria-label={t('会话历史')}><Card title={t('会话历史')} className="qms-account-history">
    <GovernanceFeedback error={error} retry={() => setRetry(value => value + 1)} />
    {loading ? <p role="status" aria-label={t('正在加载会话历史')}>{t('加载中')}</p> : null}
    <Table rowKey="id" size="small" loading={loading} dataSource={data?.items ?? []} scroll={{ x: 680 }} locale={{ emptyText: loading || error ? '—' : t('暂无会话历史') }} columns={[
      { title: t('登录于'), dataIndex: 'createdAt', render: date },
      { title: t('有效期至'), dataIndex: 'expiresAt', render: date },
      { title: t('撤销于'), dataIndex: 'revokedAt', render: date },
      { title: t('会话期限'), dataIndex: 'lifetimeType', render: (value: keyof typeof lifetime) => t(lifetime[value]) },
      { title: t('状态'), dataIndex: 'status', render: (value: keyof typeof status, row) => <>{t(status[value])}{row.isCurrent ? ` · ${t('当前会话')}` : ''}</> },
    ]} pagination={data ? { current: data.page, pageSize: data.pageSize, total: data.total, showSizeChanger: false, onChange: setPage, hideOnSinglePage: true } : false} />
  </Card></section>;
}
