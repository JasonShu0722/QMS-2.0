import type { components } from '@qms/contracts';
import { Alert, Button, Empty, Form, Input, InputNumber, Modal, Select, Space, Spin, Table, Tag, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest, csrfToken, safeAccountError } from '../../api/client';
import { useUnsavedChanges } from '../../layouts/UnsavedChanges';
import './supplier-performance.css';

type Card = components['schemas']['SupplierPerformanceCardDto'];
type CardPage = components['schemas']['SupplierPerformancePageDto'];
type ProfilePage = components['schemas']['SupplierProfilePageDto'];
type CreateCard = components['schemas']['CreateSupplierPerformanceCardDto'];
type Appeal = components['schemas']['SupplierPerformanceAppealDto'];
type AppealPage = components['schemas']['SupplierPerformanceAppealPageDto'];

function errorText(cause: unknown, fallback: string) {
  if (cause instanceof ApiError) {
    if (cause.code === 'SUPPLIER_PERFORMANCE_INPUT_INVALID') return '请检查月份、配合度说明和权重，两个权重之和必须为 100';
    if (cause.code === 'CONCURRENCY_CONFLICT') return '该供应商本月绩效卡已存在，请刷新台账';
    if (cause.code === 'SUPPLIER_RECORD_NOT_FOUND') return '供应商资料不存在或无权访问';
    if (cause.code === 'FEATURE_PERMISSION_DENIED' || cause.code === 'ORGANIZATION_SCOPE_DENIED') return '当前账号无权访问供应商绩效卡';
    return safeAccountError(cause);
  }
  return fallback;
}

export function SupplierPerformancePage() {
  const [form] = Form.useForm<CreateCard>();
  const [cards, setCards] = useState<Card[]>([]);
  const [profiles, setProfiles] = useState<ProfilePage['items']>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [profileError, setProfileError] = useState<string>();
  const [saveError, setSaveError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [publishError, setPublishError] = useState<string>();
  const [publishingId, setPublishingId] = useState<string>();
  const publishPending = useRef<{ signature: string; key: string } | undefined>(undefined);
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [appealsError, setAppealsError] = useState<string>();
  const [reviewAppeal, setReviewAppeal] = useState<Appeal>();
  const [reviewNote, setReviewNote] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string>();
  const reviewPending = useRef<{ signature: string; key: string } | undefined>(undefined);
  useUnsavedChanges(dirty);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    void apiRequest<CardPage>(`/api/v1/supplier-performance/cards?page=${page}&pageSize=20`).then((result) => {
      if (active) { setCards(result.items); setTotal(result.total); }
    }).catch((cause) => { if (active) { setCards([]); setError(errorText(cause, '绩效卡加载失败，请重试')); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, revision]);

  useEffect(() => {
    let active = true;
    setProfileLoading(true);
    void apiRequest<ProfilePage>('/api/v1/supplier-quality/profiles?page=1&pageSize=100').then((result) => {
      if (active) setProfiles(result.items);
    }).catch((cause) => { if (active) setProfileError(errorText(cause, '供应商资料加载失败，请重试')); })
      .finally(() => { if (active) setProfileLoading(false); });
    return () => { active = false; };
  }, [revision]);

  useEffect(() => {
    let active = true;
    void apiRequest<AppealPage>('/api/v1/supplier-performance/appeals').then((page) => {
      if (active) { setAppeals(page.items); setAppealsError(undefined); }
    }).catch((cause) => { if (active) { setAppeals([]); setAppealsError(errorText(cause, '申诉记录加载失败，请重试')); } });
    return () => { active = false; };
  }, [revision]);

  async function create(values: CreateCard) {
    setSaving(true); setSaveError(undefined); setNotice(undefined);
    try {
      const token = await csrfToken();
      await apiRequest<Card>('/api/v1/supplier-performance/cards', {
        method: 'POST', headers: { 'x-csrf-token': token, 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(values),
      });
      setDirty(false);
      form.resetFields();
      setPage(1);
      setRevision((current) => current + 1);
      setNotice('月度绩效卡已记录');
    } catch (cause) { setSaveError(errorText(cause, '绩效卡保存失败，请重试')); }
    finally { setSaving(false); }
  }

  async function publish(card: Card) {
    const signature = `${card.id}:${card.version}`;
    if (publishPending.current?.signature !== signature) publishPending.current = { signature, key: crypto.randomUUID() };
    setPublishingId(card.id); setPublishError(undefined); setNotice(undefined);
    try {
      const token = await csrfToken();
      await apiRequest<Card>(`/api/v1/supplier-performance/cards/${card.id}/publish`, {
        method: 'PUT', headers: { 'x-csrf-token': token, 'Idempotency-Key': publishPending.current.key },
        body: JSON.stringify({ expectedVersion: card.version }),
      });
      publishPending.current = undefined;
      setRevision((current) => current + 1);
      setNotice('月度绩效卡已发布');
    } catch (cause) { setPublishError(errorText(cause, '绩效卡发布失败，请重试')); }
    finally { setPublishingId(undefined); }
  }

  async function decideAppeal(decision: 'ACCEPTED' | 'REJECTED') {
    if (!reviewAppeal || !reviewNote.trim()) return;
    const body = { expectedVersion: reviewAppeal.version, decision, note: reviewNote.trim() };
    const signature = JSON.stringify([reviewAppeal.id, body]);
    if (reviewPending.current?.signature !== signature) reviewPending.current = { signature, key: crypto.randomUUID() };
    setReviewBusy(true); setReviewError(undefined);
    try {
      const token = await csrfToken();
      await apiRequest<Appeal>(`/api/v1/supplier-performance/appeals/${reviewAppeal.id}/review`, {
        method: 'PUT', headers: { 'x-csrf-token': token, 'Idempotency-Key': reviewPending.current.key }, body: JSON.stringify(body),
      });
      reviewPending.current = undefined;
      setReviewAppeal(undefined); setReviewNote(''); setRevision((value) => value + 1);
      setNotice(decision === 'ACCEPTED' ? '申诉已采纳' : '申诉已驳回');
    } catch (cause) { setReviewError(errorText(cause, '申诉复核失败，请重试')); }
    finally { setReviewBusy(false); }
  }

  return <main className="supplier-performance-page">
    <header className="supplier-performance-heading"><div><Typography.Text type="secondary">供应商质量 · 绩效</Typography.Text><Typography.Title level={1}>月度绩效卡</Typography.Title><Typography.Paragraph type="secondary">根据当月已完成的 IQC 检验结论计算来料合格率，记录人工配合度和来源检验版本。评分权重由建卡人填写并保存在绩效卡中。</Typography.Paragraph></div><Button onClick={() => setRevision((current) => current + 1)} loading={loading}>刷新</Button></header>
    {notice ? <Alert type="success" showIcon title={notice} /> : null}
    {publishError ? <Alert type="error" showIcon title={publishError} /> : null}
    <section className="supplier-performance-card" aria-label="月度绩效卡台账">
      <Typography.Title level={2}>绩效卡台账</Typography.Title>
      {error ? <Alert type="error" showIcon title={error} action={<Button onClick={() => setRevision((current) => current + 1)}>重试</Button>} /> : null}
      {loading ? <div className="supplier-performance-loading"><Spin /></div> : !error ? <Table<Card> rowKey="id" dataSource={cards} scroll={{ x: 850 }} locale={{ emptyText: <Empty description="暂无月度绩效卡" /> }} pagination={{ current: page, pageSize: 20, total, showSizeChanger: false, onChange: setPage }} columns={[
        { title: '供应商', dataIndex: 'supplierName' }, { title: '月份', dataIndex: 'month' },
        { title: 'IQC 检验 / 合格', key: 'incoming', render: (_, card) => `${card.inspectionCount} / ${card.passCount}` },
        { title: '来料分', dataIndex: 'incomingScore' }, { title: '配合度', dataIndex: 'cooperationScore' },
        { title: '总分', dataIndex: 'totalScore' },
        { title: '状态', key: 'status', render: (_, card) => card.status === 'PUBLISHED' ? '已发布' : '草稿' },
        { title: '操作', key: 'actions', render: (_, card) => card.status === 'DRAFT' ? <Button type="primary" loading={publishingId === card.id} disabled={!!publishingId} onClick={() => void publish(card)}>发布绩效卡</Button> : null },
      ]} expandable={{ expandedRowRender: (card) => <div className="supplier-performance-source"><p>计分：来料 {card.incomingScore} × {card.incomingWeight}% + 配合度 {card.cooperationScore} × {card.cooperationWeight}% = {card.totalScore}</p><p>配合度说明：{card.cooperationNote}</p><p>来源检验：{card.sourceInspections.map((source) => `${source.id}（第 ${source.version} 版，${source.conclusion}）`).join('、')}</p></div> }} /> : null}
    </section>
    <section className="supplier-performance-card" aria-label="供应商绩效申诉"><Typography.Title level={2}>供应商绩效申诉</Typography.Title>
      {appealsError ? <Alert type="warning" showIcon title={appealsError} action={<Button onClick={() => setRevision((value) => value + 1)}>重试</Button>} /> : null}
      {!appealsError && <Table<Appeal> rowKey="id" dataSource={appeals} locale={{ emptyText: <Empty description="暂无绩效申诉" /> }} pagination={false} columns={[
        { title: '申诉原因', dataIndex: 'reason' },
        { title: '状态', render: (_, appeal) => <Tag>{({ DRAFT: '草稿', SUBMITTED: '待复核', ACCEPTED: '已采纳', REJECTED: '未采纳' } as Record<string, string>)[appeal.status] ?? appeal.status}</Tag> },
        { title: '复核说明', dataIndex: 'decisionNote' },
        { title: '操作', render: (_, appeal) => appeal.status === 'SUBMITTED' ? <Button onClick={() => { setReviewAppeal(appeal); setReviewNote(''); setReviewError(undefined); }}>复核申诉</Button> : null },
      ]} />}
    </section>
    <section className="supplier-performance-card" aria-label="新建月度绩效卡">
      <Typography.Title level={2}>记录本月绩效</Typography.Title>
      <Typography.Paragraph type="secondary">每家供应商每月只可记录一张卡；没有已完成的 IQC 样本时不能评分。历史卡保留生成时的来源快照。</Typography.Paragraph>
      {profileError ? <Alert type="warning" showIcon title={profileError} /> : null}
      {saveError ? <Alert type="error" showIcon title={saveError} /> : null}
      {profiles.length === 0 && !profileLoading && !profileError ? <Empty description="暂无可选供应商资料" /> : null}
      <Form form={form} layout="vertical" disabled={saving || profileLoading || !!profileError || profiles.length === 0} initialValues={{ month: new Date().toISOString().slice(0, 7), incomingWeight: 60, cooperationWeight: 40 }} onValuesChange={() => setDirty(true)} onFinish={(values) => void create(values)}>
        <div className="supplier-performance-form-grid">
          <Form.Item name="profileId" label="供应商" rules={[{ required: true, message: '请选择供应商' }]}><Select showSearch optionFilterProp="label" options={profiles.map((profile) => ({ value: profile.id, label: `${profile.businessCode} · ${profile.displayName}` }))} /></Form.Item>
          <Form.Item name="month" label="评分月份" rules={[{ required: true, message: '请选择月份' }]}><Input type="month" /></Form.Item>
          <Form.Item name="cooperationScore" label="人工配合度（0–100）" rules={[{ required: true, message: '请填写配合度' }]}><InputNumber min={0} max={100} precision={0} /></Form.Item>
          <Form.Item name="incomingWeight" label="来料权重（%）" rules={[{ required: true, message: '请填写权重' }]}><InputNumber min={0} max={100} precision={0} /></Form.Item>
          <Form.Item name="cooperationWeight" label="配合度权重（%）" rules={[{ required: true, message: '请填写权重' }]}><InputNumber min={0} max={100} precision={0} /></Form.Item>
        </div>
        <Form.Item name="cooperationNote" label="配合度校核说明" rules={[{ required: true, whitespace: true, message: '请说明评分依据' }]}><Input.TextArea rows={3} maxLength={2000} showCount /></Form.Item>
        <Space><Button type="primary" htmlType="submit" loading={saving}>保存绩效卡</Button>{dirty ? <Typography.Text type="secondary">有未保存内容</Typography.Text> : null}</Space>
      </Form>
    </section>
    <Modal title="绩效申诉复核" open={Boolean(reviewAppeal)} onCancel={() => { if (!reviewBusy) setReviewAppeal(undefined); }} footer={null} destroyOnHidden>
      <Typography.Paragraph>{reviewAppeal?.reason}</Typography.Paragraph>
      {reviewError ? <Alert type="error" showIcon title={reviewError} /> : null}
      <Space orientation="vertical" className="supplier-performance-appeal-form"><label htmlFor="supplier-performance-review-note">复核说明</label><Input.TextArea id="supplier-performance-review-note" aria-label="复核说明" rows={4} maxLength={4000} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} disabled={reviewBusy} /><Space><Button type="primary" disabled={!reviewNote.trim()} loading={reviewBusy} onClick={() => void decideAppeal('ACCEPTED')}>采纳申诉</Button><Button danger disabled={!reviewNote.trim()} loading={reviewBusy} onClick={() => void decideAppeal('REJECTED')}>驳回申诉</Button></Space></Space>
    </Modal>
  </main>;
}
