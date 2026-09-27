import type { components } from '@qms/contracts';
import { Alert, Button, Empty, Input, Modal, Space, Spin, Table, Tag, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { apiRequest, csrfToken, safeAccountError } from '../../api/client';
import { useUnsavedChanges } from '../../layouts/UnsavedChanges';
import './supplier-performance.css';

type Card = components['schemas']['SupplierPerformanceCardDto'];
type CardPage = components['schemas']['SupplierPerformancePageDto'];
type Appeal = components['schemas']['SupplierPerformanceAppealDto'];
type AppealPage = components['schemas']['SupplierPerformanceAppealPageDto'];

const cardsPath = '/api/v1/supplier-portal/performance/cards';
const appealsPath = '/api/v1/supplier-portal/performance/appeals';

export function SupplierPerformancePortalPage() {
  const [cards, setCards] = useState<CardPage>();
  const [appeals, setAppeals] = useState<AppealPage>();
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [mutationError, setMutationError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [selectedCard, setSelectedCard] = useState<Card>();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ signature: string; key: string } | undefined>(undefined);
  useUnsavedChanges(Boolean(selectedCard && reason.trim()));

  useEffect(() => {
    let active = true;
    setLoading(true); setError(undefined);
    void Promise.all([
      apiRequest<CardPage>(`${cardsPath}?page=${page}&pageSize=20`),
      apiRequest<AppealPage>(appealsPath),
    ]).then(([cardPage, appealPage]) => { if (active) { setCards(cardPage); setAppeals(appealPage); } })
      .catch((cause) => { if (active) { setCards(undefined); setAppeals(undefined); setError(safeAccountError(cause)); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, revision]);

  async function mutate(path: string, method: 'POST' | 'PUT', body: unknown) {
    const signature = JSON.stringify([path, method, body]);
    if (pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
    const token = await csrfToken();
    await apiRequest(path, { method, headers: { 'x-csrf-token': token, 'Idempotency-Key': pending.current.key }, body: JSON.stringify(body) });
    pending.current = undefined;
  }

  async function createAppeal() {
    if (!selectedCard || !reason.trim()) return;
    setBusy(true); setMutationError(undefined);
    try {
      await mutate(appealsPath, 'POST', { cardId: selectedCard.id, reason: reason.trim() });
      setReason(''); setSelectedCard(undefined); setNotice('申诉草稿已保存，请在申诉记录中提交');
      setRevision((value) => value + 1);
    } catch (cause) { setMutationError(safeAccountError(cause)); }
    finally { setBusy(false); }
  }

  async function submitAppeal(appeal: Appeal) {
    setBusy(true); setMutationError(undefined);
    try {
      await mutate(`${appealsPath}/${appeal.id}/submit`, 'PUT', { expectedVersion: appeal.version });
      setNotice('申诉已提交'); setRevision((value) => value + 1);
    } catch (cause) { setMutationError(safeAccountError(cause)); }
    finally { setBusy(false); }
  }

  return <section className="supplier-performance-page">
    <header className="supplier-performance-heading"><div><Typography.Text type="secondary">供应商门户 · 绩效</Typography.Text><Typography.Title level={1}>本企业绩效</Typography.Title><Typography.Paragraph type="secondary">查看已发布的月度绩效卡；对评分有异议时可保存并提交申诉。</Typography.Paragraph></div><Button onClick={() => setRevision((value) => value + 1)} loading={loading}>刷新</Button></header>
    {error && <Alert type="error" showIcon title={error} action={<Button onClick={() => setRevision((value) => value + 1)}>重试</Button>} />}
    {mutationError && <Alert type="error" showIcon title={mutationError} />}
    {notice && <Alert type="success" showIcon title={notice} />}
    {loading ? <Spin /> : !error && <>
      <section className="supplier-performance-card" aria-label="已发布绩效卡"><Typography.Title level={2}>已发布绩效卡</Typography.Title>
        <Table<Card> rowKey="id" dataSource={cards?.items.filter((card) => card.status === 'PUBLISHED') ?? []} scroll={{ x: 700 }} locale={{ emptyText: <Empty description="暂无已发布绩效卡" /> }} pagination={{ current: page, pageSize: 20, total: cards?.total ?? 0, showSizeChanger: false, onChange: setPage }} columns={[
          { title: '月份', dataIndex: 'month' }, { title: 'IQC 检验 / 合格', render: (_, card) => `${card.inspectionCount} / ${card.passCount}` },
          { title: '来料分', dataIndex: 'incomingScore' }, { title: '配合度', dataIndex: 'cooperationScore' }, { title: '总分', dataIndex: 'totalScore' },
          { title: '操作', render: (_, card) => <Button onClick={() => { setSelectedCard(card); setReason(''); setMutationError(undefined); }}>提出申诉</Button> },
        ]} expandable={{ expandedRowRender: (card) => <div className="supplier-performance-source"><p>配合度说明：{card.cooperationNote}</p><p>来源检验：{card.sourceInspections.map((source) => `${source.id}（第 ${source.version} 版，${source.conclusion}）`).join('、') || '无'}</p></div> }} />
      </section>
      <section className="supplier-performance-card" aria-label="绩效申诉记录"><Typography.Title level={2}>申诉记录</Typography.Title>
        <Table<Appeal> rowKey="id" dataSource={appeals?.items ?? []} locale={{ emptyText: <Empty description="暂无申诉记录" /> }} pagination={false} columns={[
          { title: '原因', dataIndex: 'reason' }, { title: '状态', render: (_, appeal) => <Tag>{({ DRAFT: '草稿', SUBMITTED: '待复核', ACCEPTED: '已采纳', REJECTED: '未采纳' } as Record<string, string>)[appeal.status] ?? appeal.status}</Tag> },
          { title: '处理说明', dataIndex: 'decisionNote' },
          { title: '操作', render: (_, appeal) => appeal.status === 'DRAFT' ? <Button type="primary" disabled={busy} onClick={() => void submitAppeal(appeal)}>提交申诉</Button> : null },
        ]} />
      </section>
    </>}
    <Modal title={`申诉 ${selectedCard?.month ?? ''} 绩效卡`} open={Boolean(selectedCard)} onCancel={() => { if (!busy) { setSelectedCard(undefined); setReason(''); } }} footer={null} destroyOnHidden>
      {mutationError && <Alert type="error" showIcon title={mutationError} />}
      <Space orientation="vertical" className="supplier-performance-appeal-form"><label htmlFor="supplier-performance-appeal-reason">申诉说明</label><Input.TextArea id="supplier-performance-appeal-reason" aria-label="申诉说明" rows={5} maxLength={4000} value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} /><Button type="primary" onClick={() => void createAppeal()} disabled={!reason.trim()} loading={busy}>保存申诉草稿</Button></Space>
    </Modal>
  </section>;
}
