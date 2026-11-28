import { Input } from 'antd';
import { useState } from 'react';
import { useEightDText } from './eight-d';
import styles from './eight-d-images.module.css';

export function EightDImageCaption({ label, value, readOnly, onChange }: {
  label: string;
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
}) {
  const text = useEightDText();
  const [editing, setEditing] = useState(false);
  if (readOnly) return value.trim() ? <p className={styles.caption}>{value}</p> : null;
  if (editing) return <Input.TextArea autoFocus aria-label={label} value={value} rows={2}
    placeholder={text('添加图片描述', 'Add image description')} onChange={event => onChange(event.target.value)} onBlur={() => setEditing(false)} />;
  return <button type="button" className={`${styles.caption} ${styles.captionButton}`} onClick={() => setEditing(true)}>
    {value.trim() ? value : text('添加图片描述', 'Add image description')}
  </button>;
}
