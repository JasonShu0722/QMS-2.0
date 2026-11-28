import { Alert } from 'antd';
import receiptStyles from './eight-d-receipt.module.css';

export function EightDOperationReceipt({ text }: { text: string }) {
  return <div className={receiptStyles.receipt}><Alert role="status" type="success" showIcon title={text} /></div>;
}
