import { useEffect, useRef, useState } from 'react';
import { Button, Descriptions, Form, Input, Modal, Select, Table, Typography } from 'antd';
import { ApiError, apiRequest, csrfToken } from '../../api/client';
import type { components } from '@qms/contracts';
import type { AdminOrganization } from '../admin/admin';
import type { AuditPage } from './governance';
import { GovernanceFeedback } from './GovernanceFeedback';
import { useLanguage } from '../../i18n/Language';
import './audit.css';

export function AuditAdministration({ organization }: { organization: AdminOrganization }) {
  return <AuditAdministrationPanel key={`${organization.id}:${organization.permissions.join(',')}`} organization={organization} />;
}

function AuditAdministrationPanel({ organization }: { organization: AdminOrganization }) {
  const { t, locale } = useLanguage();
  const [form] = Form.useForm<Record<string, string>>();
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<AuditPage>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [artifact, setArtifact] = useState<components['schemas']['AuditExportDto']>();
  const [selected, setSelected] = useState<AuditPage['items'][number]>();
  const [moreFilters, setMoreFilters] = useState(false);
  const alive = useRef(true);
  const canRead = organization.permissions.includes('audit:read');
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    if (!canRead) { setLoading(false); return; }
    setLoading(true); setError(undefined);
    const query = new URLSearchParams({ organizationId: organization.id, pageSize: '25', ...filters, ...(cursor ? { cursor } : {}) });
    void apiRequest<AuditPage>(`/api/v1/admin/audit-events?${query}`).then((result) => { if (active) setPage(result); }).catch((cause) => { if (active) setError(cause); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [organization.id, filters, cursor, revision, canRead]);
  async function exportAudit() {
    setExporting(true); setError(undefined); setArtifact(undefined);
    try {
      const token = await csrfToken();
      if (!alive.current) return;
      const result = await apiRequest<components['schemas']['AuditExportDto']>('/api/v1/admin/audit-exports', { method: 'POST', headers: { 'x-csrf-token': token }, body: JSON.stringify({ organizationId: organization.id, ...filters }) });
      if (alive.current) setArtifact(result);
    } catch (cause) { if (alive.current) setError(cause); } finally { if (alive.current) setExporting(false); }
  }
  async function download() {
    if (!artifact) return;
    setExporting(true); setError(undefined);
    try {
      const result = await apiRequest<components['schemas']['AuditExportContentDto']>(artifact.downloadPath);
      if (!alive.current) return;
      const url = URL.createObjectURL(new Blob([result.content], { type: result.contentType }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = result.filename; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { if (alive.current) setError(cause); } finally { if (alive.current) setExporting(false); }
  }
  function actorSummary(entry: AuditPage['items'][number]) {
    const summary = entry.actorSummary;
    if (!summary) return entry.actorUserId ? <code>{entry.actorUserId}</code> : t('未记录操作人');
    const href = `/app/admin?${new URLSearchParams({ organizationId: entry.organizationId, section: 'users', userId: entry.actorUserId! })}`;
    return <span className="audit-actor">{entry.actorUserId && entry.organizationId === organization.id && organization.permissions.includes('account:users:read') ? <a href={href}>{summary.username}</a> : <span>{summary.username}</span>}<Typography.Text type="secondary">{summary.accountType === 'INTERNAL' ? t('内部账号') : t('供应商账号')} · {summary.organizationName}</Typography.Text></span>;
  }
  if (!canRead) return <GovernanceFeedback error={new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: '无权执行此操作' })} />;
  return <section className="governance-panel" aria-label={t('管理审计')}>
    <Form form={form} className="audit-query-toolbar" layout="inline" onFinish={() => { const values: Record<string, string> = form.getFieldsValue(true); setCursor(undefined); setFilters(Object.fromEntries(Object.entries(values).filter(([, value]) => !!value?.trim()).map(([key, value]) => [key, ['from', 'to'].includes(key) ? new Date(value).toISOString() : value.trim()]))); }}>
      <Form.Item name="action" label={t('动作')}><Input maxLength={150} /></Form.Item>
      <Form.Item name="outcome" label={t('结果')}><Select allowClear style={{ width: 130 }} options={['SUCCESS', 'FAILURE', 'DENIED'].map((value) => ({ value, label: value }))} /></Form.Item>
      <Button htmlType="submit" loading={loading}>{t('查询')}</Button>
      <Button aria-expanded={moreFilters} onClick={() => setMoreFilters((value) => !value)}>{t('更多筛选')}</Button>
      {organization.permissions.includes('audit:export') ? <Button loading={exporting} onClick={() => void exportAudit()}>{t('导出筛选结果')}</Button> : null}
      {moreFilters ? <div className="audit-query-more">
        {([['actorUserId', '操作者 ID'], ['resourceType', '资源类型'], ['resourceId', '资源 ID']] as const).map(([name, label]) => <Form.Item key={name} name={name} label={t(label)}><Input maxLength={128} /></Form.Item>)}
        <Form.Item name="from" label={t('起始时间')}><Input type="datetime-local" /></Form.Item>
        <Form.Item name="to" label={t('截止时间')}><Input type="datetime-local" /></Form.Item>
      </div> : null}
    </Form>
    {artifact ? <div className="governance-toolbar"><Button disabled={exporting} onClick={() => void download()}>{t('下载 CSV')}</Button><Typography.Text>{t('有效期至')}: {new Date(artifact.expiresAt).toLocaleString(locale)} · {artifact.rowCount}</Typography.Text></div> : null}
    <GovernanceFeedback error={error} retry={() => setRevision((value) => value + 1)} />
    <Table rowKey="id" loading={loading} dataSource={error ? [] : page?.items} pagination={false} locale={{ emptyText: error ? '—' : t('暂无数据') }} scroll={{ x: 800 }} columns={[
      { title: t('时间'), dataIndex: 'createdAt', render: (value: string) => new Date(value).toLocaleString(locale) },
      { title: t('操作人'), render: (_value, entry) => actorSummary(entry) },
      { title: t('动作'), render: (_value, entry) => <span className="audit-action"><span>{t(entry.actionLabel)}</span>{entry.actionLabel !== entry.action ? <Typography.Text type="secondary"><code>{entry.action}</code></Typography.Text> : null}</span> }, { title: t('资源类型'), dataIndex: 'resourceType' }, { title: t('结果'), dataIndex: 'outcome' },
      { title: t('详情'), render: (_value, entry) => <Button onClick={() => setSelected(entry)}>{t('详情')}</Button> },
    ]} />
    <div className="governance-toolbar"><Typography.Text>{t('总数')}: {error ? '—' : page?.total ?? '—'}</Typography.Text><Button disabled={loading} onClick={() => { setCursor(undefined); setRevision((value) => value + 1); }}>{t('刷新')}</Button><Button disabled={loading || !!error || !page?.nextCursor} onClick={() => setCursor(page?.nextCursor ?? undefined)}>{t('下一页')}</Button></div>
    <Modal open={!!selected} title={t('详情')} onCancel={() => setSelected(undefined)} footer={<Button onClick={() => setSelected(undefined)}>{t('关闭')}</Button>}>
      {selected ? <Descriptions column={1} items={[{ key: 'summary', label: t('操作人'), children: actorSummary(selected) }, { key: 'actor', label: t('操作者 ID'), children: selected.actorUserId ?? t('未记录操作人') }, { key: 'resource', label: t('资源 ID'), children: selected.resourceId ?? '—' }, { key: 'trace', label: t('追踪标识'), children: <code>{selected.traceId}</code> }, { key: 'metadata', label: t('详情'), children: <pre>{JSON.stringify(selected.metadata, null, 2)}</pre> }]} /> : null}
    </Modal>
  </section>;
}
