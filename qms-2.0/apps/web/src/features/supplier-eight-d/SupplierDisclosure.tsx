import { useCallback, useState } from 'react';
import { Alert, Button, Checkbox, Space } from 'antd';
import type { components } from '@qms/contracts';
import { AttachmentPanel } from '../attachments/AttachmentPanel';
import type { Attachment } from '../attachments/attachments';
import { useEightDEvidenceScope } from '../process-eight-d/EightDEvidenceScope';
import { useEightDText } from '../process-eight-d/eight-d';
import type { SupplierCommand, SupplierReport } from './supplier-eight-d';

type Preview = components['schemas']['SupplierDisclosurePreviewResultDto'];
export function SupplierDisclosure({ report, base, blocked, command, onDirty }: { report: SupplierReport; base: string; blocked: boolean; command: SupplierCommand; onDirty: (dirty: boolean) => void }) {
  const text = useEightDText();
  const scope = useEightDEvidenceScope();
  const [files, setFiles] = useState<Attachment[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview>();
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const clean = files.filter(file => file.status === 'AVAILABLE' && file.scanStatus === 'CLEAN');
  const validSelection = selected.every(id => clean.some(file => file.id === id));
  const reset = () => { setPreview(undefined); setConfirmed(false); onDirty(true); };
  const updateFiles = useCallback((values: Attachment[]) => {
    setFiles(values);
    setPreview(current => current && current.attachments.every(item => values.some(file => file.id === item.id && file.version === item.version && file.status === 'AVAILABLE' && file.scanStatus === 'CLEAN')) ? current : undefined);
  }, []);
  const notifyPending = useCallback((value: boolean) => { setPending(value); scope.onPendingChange(value); }, [scope.onPendingChange]);
  return <>
    <h3>{text('外发披露', 'Supplier disclosure')}</h3><p>{text('仅逐项选择扫描通过的附件；上传到披露暂存区不表示已向供应商开放。自由文本须人工核对。', 'Select CLEAN attachments individually. Uploading to staging does not release them to the supplier. Review free text manually.')}</p>
    <AttachmentPanel resource={{ resourceType: 'supplier-eight-d-disclosure', resourceId: report.supplierProblemId }} fileIds={selected} readOnly={blocked || !!preview} onFilesChanged={updateFiles} onAccessDenied={scope.onAccessDenied} onLocalPendingChange={notifyPending}
      onReady={file => { if (blocked) return false; setSelected(ids => ids.includes(file.id) ? ids : [...ids, file.id]); reset(); return true; }} onRemoved={id => { setSelected(ids => ids.filter(item => item !== id)); reset(); }} />
    <fieldset disabled={blocked || pending}><legend>{text('选中外发附件（仅 CLEAN）', 'Selected disclosure attachments (CLEAN only)')}</legend>{clean.length ? clean.map(file => <label key={file.id}><input type="checkbox" checked={selected.includes(file.id)} onChange={event => { setSelected(ids => event.target.checked ? [...ids, file.id] : ids.filter(id => id !== file.id)); reset(); }} />{file.originalName} · CLEAN · v{file.version}</label>) : <p>{text('尚无扫描通过的附件，可不附文件外发。', 'No CLEAN attachments. Disclosure without files is allowed.')}</p>}</fieldset>
    <Button disabled={blocked || pending || !validSelection} onClick={() => void command(`${base}/disclosure-preview`, 'POST', { expectedRowVersion: report.rowVersion, selectedFileIds: selected }, { keepOpen: true, refresh: false, receive: value => { setPreview(value as Preview); setConfirmed(false); onDirty(true); } })}>{text('生成披露预览', 'Generate disclosure preview')}</Button>
    {preview && <>
      <h4>{text('目标供应商', 'Recipient supplier')}：{preview.supplierName}</h4><p>{preview.supplierOrganizationId} · {text('预览有效至', 'Preview expires')} {preview.expiresAt}</p>
      <dl>{Object.entries(preview.publicFacts).map(([key, value]) => <div key={key}><dt>{({ title: text('标题', 'Title'), materialCode: text('物料编码', 'Material code'), materialCategory: text('物料类别', 'Material category'), defectDescription: text('不良描述', 'Defect description'), defectQuantity: text('不良数量', 'Defect quantity'), severity: text('风险', 'Risk'), reportNumber: text('单号', 'Report number') } as Record<string, string>)[key] ?? key}</dt><dd>{String(value)}</dd></div>)}</dl>
      <ul>{preview.attachments.map(file => <li key={file.id}>{file.originalName} · CLEAN · v{file.version} · {file.sha256}</li>)}</ul>
      {preview.warnings.map(warning => <Alert key={warning} type="warning" title={warning} />)}
      <Space wrap><Checkbox checked={confirmed} disabled={blocked || pending} onChange={event => setConfirmed(event.target.checked)}>{text('我已核对外发事实、目标供应商与所选附件', 'I checked the facts, supplier and selected files')}</Checkbox>
        {report.allowedActions.includes('release') && <Button type="primary" disabled={blocked || pending || !confirmed || !validSelection || Date.parse(preview.expiresAt) <= Date.now()} onClick={() => void command(`${base}/release`, 'POST', { expectedRowVersion: preview.rowVersion, selectedFileIds: preview.selectedFileIds, previewToken: preview.previewToken, confirmed: true })}>{text('确认释放给供应商', 'Confirm release to supplier')}</Button>}</Space>
    </>}
  </>;
}
