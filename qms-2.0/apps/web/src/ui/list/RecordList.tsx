import { Empty, theme } from 'antd';
import type { CSSProperties, Key, ReactNode } from 'react';
import './record-list.css';

export function RecordList<Item>({ items, itemKey, renderItem, empty, compact }: {
  items: Item[];
  itemKey: (item: Item) => Key;
  renderItem: (item: Item) => ReactNode;
  empty?: ReactNode;
  compact?: boolean;
}) {
  const { token } = theme.useToken();
  const style = {
    '--record-list-padding': compact ? `${token.paddingContentVerticalSM}px ${token.paddingContentHorizontal}px` : `${token.paddingContentVertical}px 0`,
    '--record-list-empty-padding': `${token.padding}px`,
    '--record-list-divider': token.colorSplit,
    '--record-list-description': token.colorTextDescription,
  } as CSSProperties;
  return items.length ? <ul role="list" className="qms-record-list" style={style}>
    {items.map(item => <li key={itemKey(item)} className="qms-record-list-item">{renderItem(item)}</li>)}
  </ul> : <div className="qms-record-list qms-record-list-empty" style={style}>{empty ?? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}</div>;
}

export function RecordListDetails({ title, description }: { title: ReactNode; description: ReactNode }) {
  return <div className="qms-record-list-details">
    <h4 className="qms-record-list-title">{title}</h4>
    <div className="qms-record-list-description">{description}</div>
  </div>;
}

export function RecordListActions({ children }: { children: ReactNode[] }) {
  return children.length ? <div className="qms-record-list-actions">{children}</div> : null;
}
