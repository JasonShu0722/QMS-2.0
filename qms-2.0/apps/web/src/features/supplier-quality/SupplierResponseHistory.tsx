import { Alert, Button, Descriptions, Empty, Space, Tag, Typography } from 'antd';
import type { components } from '@qms/contracts';
import { AttachmentPanel } from '../attachments/AttachmentPanel';
import { type ResponseContent, type SupplierProblem } from './supplierQuality';

type Revision = components['schemas']['SupplierResponseRevisionDto'];
const labels: Partial<Record<keyof ResponseContent, string>> = {
  problemDescription: '问题描述', containmentAction: '围堵措施', interimAction: '临时措施', rootCause: '根本原因',
  correctiveAction: '纠正措施', preventiveAction: '预防措施', verificationResult: '整改自验结果', completionTime: '完成时间',
};
const verificationLabels = { NOT_VERIFIED: '尚未验证', ACCEPTED: '当前修订已验证', INVALIDATED: '既有验证已失效' };
const scanLabels: Record<Revision['evidence'][number]['scanStatus'], string> = {
  WAITING_UPLOAD: '等待上传完成', PENDING: '等待安全扫描', CLEAN: '已扫描，当前不可下载',
  REJECTED: '扫描未通过', ERROR: '扫描暂不可用', EXPIRED: '上传已过期',
};

function RevisionCard({ record, revision }: { record: SupplierProblem; revision: Revision }) {
  const content = Object.entries(revision.content).filter(([key, value]) => key in labels && value);
  return <article className="supplier-revision"><Typography.Title level={4}>第 {revision.revision} 次提交</Typography.Title>
    <Typography.Paragraph type="secondary">提交时间：{new Date(revision.submittedAt).toLocaleString()}</Typography.Paragraph>
    <Descriptions column={1} items={content.map(([key, value]) => ({ key, label: labels[key as keyof ResponseContent], children: <span className="supplier-text">{key === 'completionTime' ? new Date(value).toLocaleString() : value}</span> }))} />
    {revision.evidence.length ? <><ul>{revision.evidence.map((item) => <li key={item.fileId}>{item.originalName} <Tag color={item.downloadable ? 'green' : 'orange'}>{item.downloadable ? '扫描通过，可下载' : item.status === 'DELETED' ? '已删除，保留历史记录' : scanLabels[item.scanStatus]}</Tag></li>)}</ul>
      <AttachmentPanel resource={{ resourceType: 'supplier-quality', resourceId: record.id }} fileIds={revision.evidence.map((item) => item.fileId)} readOnly /></> : <Typography.Paragraph type="secondary">本次提交无证据附件</Typography.Paragraph>}
  </article>;
}

export function SupplierResponseHistory({ record, page, changePage }: { record: SupplierProblem; page: number; changePage: (page: number) => void }) {
  const history = record.responseHistory;
  if (!history) return null;
  return <section className="supplier-card" aria-label="回复修订历史"><Typography.Title level={3}>回复修订历史</Typography.Title>
    {record.currentVerification ? <Alert type={record.currentVerification.status === 'ACCEPTED' ? 'success' : 'info'} showIcon title={verificationLabels[record.currentVerification.status]} /> : null}
    {history.items.length ? history.items.map((revision) => <RevisionCard key={revision.id} record={record} revision={revision} />) : <Empty description="尚无已提交回复" />}
    {history.total > history.pageSize ? <Space><Button disabled={page <= 1} onClick={() => changePage(page - 1)}>上一页</Button><Typography.Text>第 {page} 页，共 {history.total} 次提交</Typography.Text><Button disabled={page * history.pageSize >= history.total} onClick={() => changePage(page + 1)}>下一页</Button></Space> : null}
  </section>;
}
