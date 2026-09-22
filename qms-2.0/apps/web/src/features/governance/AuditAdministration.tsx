import { useEffect, useState } from 'react';
import { Button, Descriptions, Form, Input, Modal, Select, Table, Typography } from 'antd';
import { apiRequest, csrfToken } from '../../api/client';
import type { components } from '@qms/contracts';
import type { AdminOrganization } from '../admin/admin';
import type { AuditPage } from './governance';
import { GovernanceFeedback } from './GovernanceFeedback';
import { useLanguage } from '../../i18n/Language';

export function AuditAdministration({ organization }: { organization: AdminOrganization }) {
  const { t, locale } = useLanguage();
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<AuditPage>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [artifact, setArtifact] = useState<components['schemas']['AuditExportDto']>();
  const [selected, setSelected] = useState<AuditPage['items'][number]>();
  useEffect(() => {
    let active = true;
    setLoading(true); setError(undefined);
    const query = new URLSearchParams({ organizationId: organization.id, pageSize: '25', ...filters, ...(cursor ? { cursor } : {}) });
    void apiRequest<AuditPage>(`/api/v1/admin/audit-events?${query}`).then((result) => { if (active) setPage(result); }).catch((cause) => { if (active) setError(cause); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [organization.id, filters, cursor, revision]);
  async function exportAudit() {
    setExporting(true); setError(undefined); setArtifact(undefined);
    try {
      const token = await csrfToken();
      setArtifact(await apiRequest<components['schemas']['AuditExportDto']>('/api/v1/admin/audit-exports', { method: 'POST', headers: { 'x-csrf-token': token }, body: JSON.stringify({ organizationId: organization.id, ...filters }) }));
    } catch (cause) { setError(cause); } finally { setExporting(false); }
  }
  async function download() {
    if (!artifact) return;
    setExporting(true); setError(undefined);
    try {
      const result = await apiRequest<components['schemas']['AuditExportContentDto']>(artifact.downloadPath);
      const url = URL.createObjectURL(new Blob([result.content], { type: result.contentType }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = result.filename; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause); } finally { setExporting(false); }
  }
  return <section className="governance-panel" aria-label={t('管理审计')}>
    {organization.permissions.includes('audit:export') ? <div className="governance-toolbar"><Button loading={exporting} onClick={() => void exportAudit()}>{t('导出筛选结果')}</Button>{artifact ? <><Button disabled={exporting} onClick={() => void download()}>{t('下载 CSV')}</Button><Typography.Text>{t('有效期至')}: {new Date(artifact.expiresAt).toLocaleString(locale)} · {artifact.rowCount}</Typography.Text></> : null}</div> : null}
    <Form layout="inline" onFinish={(values: Record<string, string>) => { setCursor(undefined); setFilters(Object.fromEntries(Object.entries(values).filter(([, value]) => !!value).map(([key, value]) => [key, ['from', 'to'].includes(key) ? new Date(value).toISOString() : value.trim()]))); }}>
      {([['actorUserId', '操作者 ID'], ['action', '动作'], ['resourceType', '资源类型'], ['resourceId', '资源 ID']] as const).map(([name, label]) => <Form.Item key={name} name={name} label={t(label)}><Input maxLength={128} /></Form.Item>)}
      <Form.Item name="outcome" label={t('结果')}><Select allowClear style={{ width: 130 }} options={['SUCCESS', 'FAILURE', 'DENIED'].map((value) => ({ value, label: value }))} /></Form.Item>
      <Form.Item name="from" label={t('起始时间')}><Input type="datetime-local" /></Form.Item>
      <Form.Item name="to" label={t('截止时间')}><Input type="datetime-local" /></Form.Item>
      <Button htmlType="submit" loading={loading}>{t('查询')}</Button>
    </Form>
    <GovernanceFeedback error={error} retry={() => setRevision((value) => value + 1)} />
    <Table rowKey="id" loading={loading} dataSource={error ? [] : page?.items} pagination={false} locale={{ emptyText: error ? '—' : t('暂无数据') }} scroll={{ x: 800 }} columns={[
      { title: t('时间'), dataIndex: 'createdAt', render: (value: string) => new Date(value).toLocaleString(locale) },
      { title: t('动作'), dataIndex: 'action' }, { title: t('资源类型'), dataIndex: 'resourceType' }, { title: t('结果'), dataIndex: 'outcome' },
      { title: t('详情'), render: (_value, entry) => <Button onClick={() => setSelected(entry)}>{t('详情')}</Button> },
    ]} />
    <div className="governance-toolbar"><Typography.Text>{t('总数')}: {error ? '—' : page?.total ?? '—'}</Typography.Text><Button disabled={loading} onClick={() => { setCursor(undefined); setRevision((value) => value + 1); }}>{t('刷新')}</Button><Button disabled={loading || !!error || !page?.nextCursor} onClick={() => setCursor(page?.nextCursor ?? undefined)}>{t('下一页')}</Button></div>
    <Modal open={!!selected} title={t('详情')} onCancel={() => setSelected(undefined)} footer={<Button onClick={() => setSelected(undefined)}>{t('关闭')}</Button>}>
      {selected ? <Descriptions column={1} items={[{ key: 'actor', label: t('操作者 ID'), children: selected.actorUserId ?? '—' }, { key: 'resource', label: t('资源 ID'), children: selected.resourceId ?? '—' }, { key: 'trace', label: t('追踪标识'), children: <code>{selected.traceId}</code> }, { key: 'metadata', label: t('详情'), children: <pre>{JSON.stringify(selected.metadata, null, 2)}</pre> }]} /> : null}
    </Modal>
  </section>;
}
