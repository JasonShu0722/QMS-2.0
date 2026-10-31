import type { components } from '@qms/contracts';
import { Alert, Button, Checkbox, Form, Input, InputNumber, Modal, Radio, Select, Space, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, safeAccountError } from '../../api/client';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { ledgerDenied, useCustomerLedgerWrite } from '../customer-quality/customer-ledger-write';
import { SupplierReferenceSelect } from '../supplier-quality/SupplierReferenceSelect';
import { draftFromPreview } from './helpers';

type Draft = components['schemas']['SupplierProblemDraftDto'];
type Preview = components['schemas']['SupplierCopyPreviewDto'];
type Receipt = components['schemas']['SupplierCopyDraftReceiptDto'];
type Values = Pick<Draft, 'title' | 'materialCode' | 'materialCategory' | 'defectDescription' | 'defectQuantity' | 'severity'> & { reviewed: boolean };
type Props = { organizationId?: string; sources: components['schemas']['SupplierCopySourceDto'][]; onClose: () => void; onDenied: (cause: unknown) => void };
const base = '/api/v1/supplier-quality/source-copies';
const required = [{ required: true, whitespace: true, message: '请填写内容' }];

export function SupplierSourceCopyDialog(props: Props) {
  const [denied, setDenied] = useState(false);
  if (denied) return <Alert type="warning" title="访问权限已失效，复制内容已清除。请重新进入台账。" />;
  return <CopyContent {...props} onDenied={cause => { setDenied(true); props.onDenied(cause); }} />;
}

function CopyContent({ organizationId, sources, onClose, onDenied }: Props) {
  const scope = useWorkTabsStore(state => state.sessionScope);
  const [form] = Form.useForm<Values>();
  const [profileId, setProfileId] = useState<string>();
  const [preview, setPreview] = useState<Preview>();
  const [validPreview, setValidPreview] = useState(false);
  const [receipt, setReceipt] = useState<Receipt>();
  const [error, setError] = useState<unknown>();
  const [conflict, setConflict] = useState(false);
  const [dirty, setDirty] = useState(false);
  const initialized = useRef(false);
  const active = useRef(false);
  const alive = useRef(true);
  const deniedCallback = useRef(onDenied); deniedCallback.current = onDenied;
  const previewWriter = useCustomerLedgerWrite(cause => deniedCallback.current(cause));
  const writer = useCustomerLedgerWrite(cause => deniedCallback.current(cause));
  const busy = previewWriter.busy || writer.busy;
  const frozen = busy || writer.uncertain || previewWriter.uncertain;
  const leave = useNavigationGuard();
  useUnsavedChanges(dirty || writer.uncertain || previewWriter.uncertain);
  useNavigationBusy(frozen);
  useEffect(() => {
    alive.current = true;
    const unsubscribe = useWorkTabsStore.subscribe(state => {
      if (state.sessionScope !== scope) deniedCallback.current(new ApiError({ code: 'AUTH_SESSION_REQUIRED', message: '' }, 401));
    });
    return () => { alive.current = false; unsubscribe(); };
  }, [scope]);
  function close() {
    if (active.current) return;
    leave(() => { writer.discard(); previewWriter.discard(); setDirty(false); onClose(); }, true);
  }
  async function readPreview() {
    if (!profileId || active.current || writer.uncertain || !sources.length || sources.length > 100) return;
    active.current = true; setError(undefined); setValidPreview(false); setConflict(false);
    if (initialized.current) form.setFieldValue('reviewed', false);
    try {
      const body: components['schemas']['SupplierCopyPreviewInputDto'] = { ...(organizationId ? { organizationId } : {}), supplierProfileId: profileId, sources };
      const value = await previewWriter.write<Preview>(`${base}/preview`, body, 'POST');
      if (!alive.current) return;
      setPreview(value); setValidPreview(true);
      // Only the first server projection seeds the form; refreshing never overwrites reviewed edits.
      if (!initialized.current) { form.setFieldsValue(draftFromPreview(value)); initialized.current = true; }
      setDirty(true);
    } catch (cause) { if (alive.current && !ledgerDenied(cause)) setError(cause); }
    finally { active.current = false; }
  }
  async function create(values: Values) {
    if (active.current || receipt || !preview || !profileId || !validPreview || !preview.facts.length || !values.reviewed) return;
    if (!writer.uncertain && Date.parse(preview.expiresAt) <= Date.now()) { setConflict(true); setValidPreview(false); return; }
    active.current = true; setError(undefined);
    const draft: Draft = {
      ...(organizationId ? { organizationId } : {}), profileId,
      title: values.title.trim(), materialCode: values.materialCode.trim(), defectDescription: values.defectDescription.trim(),
      defectQuantity: values.defectQuantity, severity: values.severity,
      ...(values.materialCategory ? { materialCategory: values.materialCategory } : {}), responseForm: 'EIGHT_D', replyMode: 'SUPPLIER',
    };
    const body: components['schemas']['SupplierCopyDraftInputDto'] = { ...(organizationId ? { organizationId } : {}), token: preview.token, draft };
    try {
      const value = await writer.write<Receipt>(`${base}/drafts`, body, 'POST');
      if (alive.current) { setReceipt(value); setDirty(false); form.resetFields(); setPreview(undefined); }
    } catch (cause) {
      if (alive.current && !ledgerDenied(cause)) {
        setError(cause);
        if (cause instanceof ApiError && cause.status === 409) { setConflict(true); setValidPreview(false); }
      }
    } finally { active.current = false; }
  }
  const optionsPath = `/api/v1/supplier-quality/reference-options?kind=profiles${organizationId ? `&organizationId=${encodeURIComponent(organizationId)}` : ''}`;
  return <Modal open title="受控复制为供应商草稿" footer={null} width={760} onCancel={close} closable={!busy} mask={{ closable: !busy }} keyboard={!busy} destroyOnHidden>
    {receipt ? <>
      <Alert type="success" showIcon title="供应商草稿已创建，尚未正式发单或释放资料。" />
      <div className="qms-dialog-actions"><Button onClick={close}>关闭</Button><Link to={`/app/supplier-quality/problems/${encodeURIComponent(receipt.id)}${organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : ''}`}>打开供应商草稿</Link></div>
    </> : <>
      <Typography.Paragraph>已选择 {sources.length}/100 条来源</Typography.Paragraph>
      <label htmlFor="supplier-copy-profile">目标供应商档案</label>
      <SupplierReferenceSelect id="supplier-copy-profile" path={optionsPath} value={profileId} disabled={frozen} placeholder="选择目标供应商档案" onDenied={onDenied} onChange={value => {
        if (value === profileId) return;
        leave(() => { setProfileId(value); setPreview(undefined); setValidPreview(false); setConflict(false); setError(undefined); if (initialized.current) form.resetFields(); initialized.current = false; setDirty(true); });
      }} />
      <Space wrap><Button disabled={!profileId || busy || writer.uncertain || !sources.length || sources.length > 100} loading={previewWriter.busy} onClick={() => void readPreview()}>{previewWriter.uncertain ? '重试原预览请求' : preview ? '重新读取受控预览' : '读取受控预览'}</Button></Space>
      {!!error && <Alert type="error" showIcon title={safeAccountError(error)} />}
      {conflict && <Alert type="warning" showIcon title="预览已过期或来源版本发生冲突，改稿已保留。请重新读取受控预览并再次人工审核；版本仍冲突时，确认保留所需文字后返回台账刷新并重选来源。" />}
      {previewWriter.uncertain && <Alert type="warning" title="预览结果未知，不自动重发。可显式重试原预览请求。" />}
      {preview && <>
        <section aria-label="服务器受控来源预览">
          <Typography.Title level={5}>目标供应商最小事实预览</Typography.Title>
          <Typography.Paragraph type="secondary">预览有效至 {new Date(preview.expiresAt).toLocaleString()}</Typography.Paragraph>
          {!preview.facts.length && <Alert type="warning" title="没有可复制事实，请返回台账重新选择。" />}
          {preview.facts.map(fact => <div key={fact.factKey}>
            <Typography.Paragraph>{fact.defectDescription}</Typography.Paragraph>
            <Typography.Paragraph>事实原数量：{fact.defectQuantity ?? '未知'}</Typography.Paragraph>
            {fact.materials.length ? fact.materials.map(material => <Typography.Paragraph key={material.id}>不良物料：{material.materialCode ?? '未知，请人工完善'}；名称：{material.materialName ?? '未知'}；批次：{material.materialBatch ?? '未知'}</Typography.Paragraph>) : <Typography.Paragraph>不良物料未知，请人工完善。</Typography.Paragraph>}
          </div>)}
        </section>
        <Alert type="info" showIcon title="不自动复制客户、VIN、内部资料或来源附件。自由文本不保证自动脱敏，必须人工审核；正式披露请在供应商8D工作区另行上传并完成扫描。" />
        <Form<Values> form={form} layout="vertical" disabled={frozen} onValuesChange={() => { setDirty(true); }} onFinish={values => void create(values)}>
          <Form.Item name="title" label="草稿标题" rules={[...required, { max: 500 }]}><Input maxLength={500} /></Form.Item>
          <Form.Item name="materialCode" label="不良物料号" rules={[{ required: true, whitespace: true, message: '请填写不良物料号' }, { max: 100 }]}><Input maxLength={100} placeholder="未知时留空，完善后才能创建" /></Form.Item>
          <Form.Item name="materialCategory" label="物料类别（可选）"><Select allowClear options={[{ value: 'STRUCTURE', label: '结构件' }, { value: 'ELECTRONIC', label: '电子件' }]} /></Form.Item>
          <Form.Item name="defectDescription" label="对外不良描述" rules={[...required, { max: 10000 }]}><Input.TextArea rows={4} /></Form.Item>
          <Form.Item name="defectQuantity" label="不良数量" rules={[{ required: true, message: '请人工填写不良数量' }, { type: 'integer', min: 1, max: 2147483647, message: '请输入1至2147483647的整数' }]}><InputNumber /></Form.Item>
          <Form.Item name="severity" label="独立风险等级" rules={[{ required: true, message: '请明确选择风险等级' }]}><Radio.Group options={[{ value: 'LOW', label: '低' }, { value: 'MEDIUM', label: '中' }, { value: 'HIGH', label: '高' }, { value: 'CRITICAL', label: '重大' }]} /></Form.Item>
          <Form.Item name="reviewed" valuePropName="checked" rules={[{ validator: (_, value) => value === true ? Promise.resolve() : Promise.reject(new Error('请完成人工审核确认')) }]}><Checkbox>我已人工审核对外自由文本、物料、数量及目标供应商；本次仅创建草稿，不代表正式发单或披露许可。</Checkbox></Form.Item>
          {writer.uncertain && <Alert type="warning" title="创建结果未知，草稿已冻结；请显式重试原创建请求，不要重新创建另一单。" />}
          <div className="qms-dialog-actions" role="group" aria-label="受控复制草稿操作"><Button aria-label="取消" disabled={busy} onClick={close}>取消</Button><Button type="primary" htmlType="submit" loading={writer.busy} disabled={busy || !validPreview || !preview.facts.length}>{writer.uncertain ? '重试原创建请求' : '创建供应商草稿'}</Button></div>
        </Form>
      </>}
      {!preview && <div className="qms-dialog-actions"><Button aria-label="取消" disabled={busy} onClick={close}>取消</Button></div>}
    </>}
  </Modal>;
}
