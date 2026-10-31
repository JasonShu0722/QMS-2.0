import { useEffect, useRef, useState } from 'react';
import { Button, Modal, Select, Table, Typography } from 'antd';
import { LedgerTable, useLedgerPageSize } from '../../ui/ledger';
import { apiRequest, csrfToken } from '../../api/client';
import type { AdminOrganization } from '../admin/admin';
import type { FailurePage } from './governance';
import { GovernanceFeedback } from './GovernanceFeedback';
import { useLanguage } from '../../i18n/Language';

export function OutboxAdministration({ organization }: { organization: AdminOrganization }) {
  const [pageSize, setPageSize] = useLedgerPageSize('admin-outbox', organization.id);
  const { t, locale } = useLanguage();
  const [position, setPosition] = useState({ organizationId: organization.id, offset: 0 });
  const offset = position.organizationId === organization.id ? position.offset : 0;
  const setOffset = (value: number) => setPosition({ organizationId: organization.id, offset: value });
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<FailurePage>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [history, setHistory] = useState<{ id: string; attemptNumber: number; outcome: string; reasonCode?: string; occurredAt: string; retryAt?: string }[]>();
  const [historyLoading, setHistoryLoading] = useState(false);
  const historyGeneration = useRef(0);
  useEffect(() => {
    setHistory(undefined); setSelected(undefined); setHistoryLoading(false);
    return () => { historyGeneration.current += 1; };
  }, [organization.id]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(undefined); setPage(undefined);
    void apiRequest<FailurePage>(`/api/v1/outbox/failures?organizationId=${organization.id}&pageSize=${pageSize}&offset=${offset}`).then((result) => { if (active) setPage(result); }).catch((cause) => { if (active) setError(cause); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [organization.id, offset, pageSize, revision]);
  async function retry() {
    if (!selected) return;
    setRetrying(true); setError(undefined);
    try {
      const token = await csrfToken();
      await apiRequest(`/api/v1/outbox/failures/${selected}/retry?organizationId=${organization.id}`, { method: 'POST', headers: { 'x-csrf-token': token } });
      setSelected(undefined); setRevision((value) => value + 1);
    } catch (cause) { setError(cause); }
    finally { setRetrying(false); }
  }
  async function showHistory(id: string) {
    const generation = ++historyGeneration.current;
    setHistoryLoading(true); setError(undefined); setSelected(id); setHistory([]);
    try {
      const result = await apiRequest<{ items: typeof history }>(`/api/v1/outbox/failures/${id}/attempts?organizationId=${organization.id}`);
      if (generation === historyGeneration.current) setHistory(result.items ?? []);
    } catch (cause) { if (generation === historyGeneration.current) setError(cause); }
    finally { if (generation === historyGeneration.current) setHistoryLoading(false); }
  }
  function closeHistory() {
    historyGeneration.current += 1;
    setHistory(undefined); setSelected(undefined); setHistoryLoading(false);
  }
  return <section className="governance-panel" aria-label={t('失败队列')}>
    <GovernanceFeedback error={error} retry={() => setRevision((value) => value + 1)} />
    <LedgerTable ledgerId="admin-outbox" organizationId={organization.id} requiredColumnKeys={['aggregateId', 'receipt', 'actions']} rowKey="id" loading={loading} pagination={false} dataSource={error ? [] : page?.items} locale={{ emptyText: error ? '—' : t('暂无数据') }} scroll={{ x: 800 }} columns={[
      { key: 'eventType', title: t('事件类型'), dataIndex: 'eventType' }, { key: 'aggregateId', title: t('资源 ID'), dataIndex: 'aggregateId' }, { key: 'attempts', title: t('尝试次数'), dataIndex: 'attempts' },
      { key: 'createdAt', title: t('时间'), dataIndex: 'createdAt', render: (value: string) => new Date(value).toLocaleString(locale) }, { key: 'reason', title: t('失败原因'), render: (_value: unknown, entry: FailurePage['items'][number]) => (entry as FailurePage['items'][number] & { failureReasonCode?: string }).failureReasonCode ?? entry.reasonCode },
      { key: 'receipt', title: t('回执'), render: (_value: unknown, entry: FailurePage['items'][number]) => <Button onClick={() => void showHistory(entry.id)}>{t('查看尝试')}</Button> },
      ...(organization.permissions.includes('outbox:retry') ? [{ key: 'actions', title: t('操作'), render: (_value: unknown, entry: FailurePage['items'][number]) => <Button disabled={retrying} onClick={() => setSelected(entry.id)}>{t('重试事件')}</Button> }] : []),
    ]} />
    <div className="governance-toolbar"><Typography.Text>{t('总数')}: {error ? '—' : page?.total ?? '—'}</Typography.Text><Select aria-label={locale === 'en-US' ? 'Page size' : '每页条数'} value={pageSize} options={[10, 20, 50, 100].map(value => ({ value, label: String(value) }))} disabled={loading || retrying} onChange={size => { setOffset(0); setPageSize(size); }} /><Button disabled={loading || retrying} onClick={() => setRevision((value) => value + 1)}>{t('刷新')}</Button><Button disabled={loading || retrying || offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>{t('上一页')}</Button><Button disabled={loading || retrying || !!error || offset + pageSize >= (page?.total ?? 0)} onClick={() => setOffset(offset + pageSize)}>{t('下一页')}</Button></div>
    <Modal open={!!selected && !history} title={t('确认重试此事件？')} okText={t('重试')} cancelText={t('取消')} confirmLoading={retrying} cancelButtonProps={{ disabled: retrying }} closable={!retrying} maskClosable={!retrying} onCancel={() => setSelected(undefined)} onOk={() => void retry()}><GovernanceFeedback error={error} />{t('提交后由后台任务重新处理。')}</Modal>
    <Modal open={!!history} title={t('通知尝试回执')} footer={null} onCancel={closeHistory}>
      <Table rowKey="id" loading={historyLoading} pagination={false} dataSource={history ?? []} columns={[{ title: t('尝试'), dataIndex: 'attemptNumber' }, { title: t('结果'), dataIndex: 'outcome' }, { title: t('原因'), dataIndex: 'reasonCode' }, { title: t('时间'), dataIndex: 'occurredAt', render: (value: string) => new Date(value).toLocaleString(locale) }]} />
    </Modal>
  </section>;
}
