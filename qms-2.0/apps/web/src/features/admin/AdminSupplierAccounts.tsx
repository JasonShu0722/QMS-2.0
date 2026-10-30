import { useLayoutEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Space, Table, Typography } from 'antd';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useNavigationGuard } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import type { AdminOrganization } from './admin';
import { UserForceDelete } from './UserForceDelete';

type Props = { organization: AdminOrganization; onDenied?: (error: ApiError) => void };
type Page = components['schemas']['AdminSupplierAccountsPageDto'];
type Account = Page['items'][number];
const base = '/api/v1/admin/supplier-accounts';
const pageSize = 20;

export function AdminSupplierAccounts(props: Props) {
  const principal = useWorkTabsStore(state => state.sessionScope);
  if (!principal?.startsWith('INTERNAL:') || props.organization.type !== 'INTERNAL' || !props.organization.permissions.includes('account:users:delete')) return null;
  return <SupplierAccountsScope key={JSON.stringify([principal, props.organization.id, [...props.organization.permissions].sort()])} {...props} principal={principal} />;
}

function SupplierAccountsScope({ principal, onDenied }: Props & { principal: string }) {
  const { t } = useLanguage();
  const requestLeave = useNavigationGuard();
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<Page>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [invalidated, setInvalidated] = useState(false);
  const alive = useRef(false);
  const invalid = useRef(false);
  const controller = useRef<AbortController | undefined>(undefined);
  const deniedCallback = useRef(onDenied); deniedCallback.current = onDenied;
  const current = () => alive.current && !invalid.current && useWorkTabsStore.getState().sessionScope === principal;

  function invalidate() {
    invalid.current = true; controller.current?.abort();
    setData(undefined); setLoading(false); setInvalidated(true);
  }
  function fail(cause: unknown) {
    if (!current()) return;
    setData(undefined); setError(cause);
    if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
      invalidate(); deniedCallback.current?.(cause);
    }
  }
  useLayoutEffect(() => {
    alive.current = true;
    const unsubscribe = useWorkTabsStore.subscribe(state => {
      // A synchronous A-B-A principal change must never revive the old directory.
      if (state.sessionScope !== principal && !invalid.current) { invalidate(); setError(undefined); }
    });
    return () => { alive.current = false; controller.current?.abort(); unsubscribe(); };
  }, [principal]);
  useLayoutEffect(() => {
    if (!current()) return;
    const read = new AbortController(); controller.current = read;
    let active = true;
    const valid = () => active && !read.signal.aborted && current();
    setLoading(true); setData(undefined); setError(undefined);
    const query = new URLSearchParams({ search, pageSize: String(pageSize), offset: String(offset) });
    void apiRequest<Page>(`${base}?${query}`, { signal: read.signal })
      .then(result => { if (valid()) setData(result); })
      .catch(cause => { if (valid()) fail(cause); })
      .finally(() => { if (valid()) setLoading(false); });
    return () => { active = false; read.abort(); };
  }, [principal, search, offset, revision]);

  function reload() { if (current()) setRevision(value => value + 1); }
  function guarded(action: () => void) {
    if (!current()) return;
    requestLeave(() => { if (current()) action(); });
  }
  return <section aria-label={t('供应商账号（全平台）')}>
    <Typography.Title level={4} className="sr-only">{t('供应商账号（全平台）')}</Typography.Title>
    <Typography.Paragraph>{t('全平台账号生命周期管理；不授予供应商业务访问权。')}</Typography.Paragraph>
    <Typography.Paragraph>{t('支持清理未关联档案或原管理组织已失效的供应商账号；不删除供应商企业及历史业务。')}</Typography.Paragraph>
    {!!error && <Alert type="error" showIcon title={t(safeAccountError(error))} description={error instanceof ApiError && error.traceId ? <code>{error.traceId}</code> : undefined} />}
    <Space wrap>
      <Input.Search aria-label={t('搜索供应商账号或企业')} placeholder={t('搜索供应商账号或企业')} maxLength={100} disabled={invalidated} onSearch={value => guarded(() => { setSearch(value.trim()); setOffset(0); reload(); })} />
      <Button loading={loading} disabled={invalidated} onClick={() => guarded(reload)}>{t('刷新供应商账号')}</Button>
    </Space>
    <Table<Account> rowKey="id" size="small" loading={loading} dataSource={data?.items ?? []} scroll={{ x: 760 }}
      locale={{ emptyText: data ? t('暂无供应商账号') : ' ' }}
      pagination={{ current: offset / pageSize + 1, pageSize, total: data?.total ?? 0, showSizeChanger: false, onChange: page => guarded(() => { setOffset((page - 1) * pageSize); reload(); }) }}
      columns={[
        { title: t('用户名'), dataIndex: 'username' },
        { title: t('邮箱'), dataIndex: 'email' },
        { title: t('所属供应商企业'), render: (_, account) => <><div>{account.organization.name}</div><Typography.Text type="secondary">{account.organization.code}</Typography.Text></> },
        { title: t('状态'), dataIndex: 'status', render: (status: Account['status']) => t(status === 'ACTIVE' ? '启用' : '停用') },
        { title: t('操作'), render: (_, account) => <UserForceDelete key={JSON.stringify([search, offset, revision, account.id])} target={account} canDelete={!invalidated} disabled={loading}
          deletePath={`${base}/${encodeURIComponent(account.id)}?organizationId=${encodeURIComponent(account.organizationId)}`} onDeleted={reload} onRefresh={reload} onDenied={fail} /> },
      ]} />
  </section>;
}
