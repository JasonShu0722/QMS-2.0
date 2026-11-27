import { useEffect, useState } from 'react';

export function useEightDReceipt() {
  const [receipt, setReceipt] = useState(false);
  useEffect(() => {
    if (!receipt) return;
    const timeout = window.setTimeout(() => setReceipt(false), 3000);
    return () => window.clearTimeout(timeout);
  }, [receipt]);
  return [receipt, setReceipt] as const;
}
