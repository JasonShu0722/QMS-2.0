import { Button, Modal, Tooltip, theme } from 'antd';
import { Paperclip } from 'lucide-react';
import { useId, useState, type ComponentProps } from 'react';
import { EightDEvidence } from './EightDEvidence';
import { useEightDText } from './eight-d';
import styles from './eight-d-row-attachments.module.css';

export function EightDRowAttachments({ label, ...evidence }: ComponentProps<typeof EightDEvidence> & { label: string }) {
  const text = useEightDText();
  const { token } = theme.useToken();
  const contentId = useId();
  const [open, setOpen] = useState(false);
  const [deleted, setDeleted] = useState<string[]>([]);
  const count = evidence.fileIds.filter(id => !deleted.includes(id)).length;
  const title = `${label} (${count})`;
  const status = count ? text('有附件', 'Has attachments') : text('无附件', 'No attachments');
  const name = `${label} · ${status}`;

  return <>
    <Tooltip title={open ? null : name} trigger={['hover', 'focus']}>
      <Button type="text" size="small" className={styles.trigger}
        icon={<Paperclip aria-hidden="true" size={16} />}
        style={{ color: count ? token.colorPrimary : token.colorTextSecondary }}
        aria-label={name} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? contentId : undefined}
        onClick={() => setOpen(true)} />
    </Tooltip>
    <Modal open={open} title={<span className="attachment-panel__sr-only">{title}</span>} onCancel={() => setOpen(false)} classNames={{ header: styles.dialogHeader }}
      width="min(560px, calc(100vw - 32px))" footer={null} destroyOnHidden={false}>
      <div id={contentId} className={styles.content}><EightDEvidence {...evidence} heading={title} onDeletedFiles={setDeleted} /></div>
    </Modal>
  </>;
}
