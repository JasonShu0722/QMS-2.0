import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Table } from 'antd';
import type { components } from '@qms/contracts';
import { getAccountSessionHistory, revokeAccountSession } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { GovernanceFeedback } from '../governance/GovernanceFeedback';
import { accountAvatarEpoch } from './account-avatar-state';

type HistoryItem = components['schemas']['AccountSessionHistoryItemDto'];

export function AccountSessionHistory() {
  const { t, locale } = useLanguage();
  const page = useRef(1);
  const [data, setData] = useState<components['schemas']['AccountSessionHistoryPageDto']>();
  const [error, setError] = useState<unknown>();
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState(false);
  const alive = useRef(false);
  const epoch = useRef(accountAvatarEpoch());
  const loadId = useRef(0);
  const readable = useRef(false);
  const pending = useRef(false);
  const current = () => alive.current && epoch.current === accountAvatarEpoch();

  async function load() {
    if (!current()) return;
    const request = ++loadId.current;
    readable.current = false;
    setLoading(true); setError(undefined);
    try {
      const result = await getAccountSessionHistory(page.current);
      if (!current() || request !== loadId.current) return;
      readable.current = true;
      setData(result);
    } catch (cause) {
      if (current() && request === loadId.current) setError(cause);
    } finally {
      if (current() && request === loadId.current) setLoading(false);
    }
  }

  useEffect(() => {
    alive.current = true; void load();
    const refresh = () => { void load(); };
    window.addEventListener('qms:account-sessions-changed', refresh);
    return () => {
      alive.current = false; loadId.current += 1; readable.current = false;
      window.removeEventListener('qms:account-sessions-changed', refresh);
    };
  }, []);

  async function revoke(row: HistoryItem) {
    if (!current() || pending.current || !readable.current || row.status !== 'ACTIVE' || row.isCurrent) return;
    pending.current = true; setRevoking(true); setError(undefined); setSuccess(false);
    try {
      await revokeAccountSession(row.id);
      if (!current()) return;
      setSuccess(true);
      await load();
    } catch (cause) { if (current()) setError(cause); }
    finally { pending.current = false; if (current()) setRevoking(false); }
  }

  const date = (value: string | null) => value ? new Date(value).toLocaleString(locale) : '—';
  const lifetime = { STANDARD: '标准会话', REMEMBERED_ADMIN: '管理员记住登录', REMEMBERED_USER: '用户记住登录' };
  const status = { ACTIVE: '有效', REVOKED: '已撤销', EXPIRED: '已过期' };
  return <section aria-label={t('登录会话')}><Card title={t('登录会话')} className="qms-account-history">
    <GovernanceFeedback error={error} retry={() => void load()} />
    {success ? <Alert type="success" showIcon title={t('会话已撤销')} role="status" /> : null}
    {loading ? <p role="status" aria-label={t('正在加载登录会话')}>{t('加载中')}</p> : null}
    <Table<HistoryItem> rowKey="id" size="small" loading={loading} dataSource={error ? [] : data?.items ?? []} scroll={{ x: 800, y: 320 }} locale={{ emptyText: loading || error ? '—' : t('暂无会话') }} columns={[
      { title: t('登录于'), dataIndex: 'createdAt', render: date },
      { title: t('有效期至'), dataIndex: 'expiresAt', render: date },
      { title: t('撤销于'), dataIndex: 'revokedAt', render: date },
      { title: t('会话期限'), dataIndex: 'lifetimeType', render: (value: keyof typeof lifetime) => t(lifetime[value]) },
      { title: t('状态'), dataIndex: 'status', render: (value: keyof typeof status, row) => <>{t(status[value])}{row.isCurrent ? ` · ${t('当前会话')}` : ''}</> },
      { title: t('操作'), key: 'actions', render: (_, row) => row.status === 'ACTIVE' && !row.isCurrent ? <Button type="link" disabled={revoking || loading || !!error} onClick={() => void revoke(row)}>{t('撤销')}</Button> : null },
    ]} pagination={data ? { current: page.current, pageSize: data.pageSize, total: data.total, showSizeChanger: false, disabled: loading || revoking, onChange: next => { page.current = next; void load(); }, hideOnSinglePage: true } : false} />
  </Card></section>;
}
