import { useEffect, useState } from 'react';
import { apiRequest } from '../../api/client';
import { supplierError } from './supplierQuality';

export function useSupplierData<Result>(path: string, keepWhileRefreshing?: (previous: Result) => boolean) {
  const [data, setData] = useState<Result>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [loadedRevision, setLoadedRevision] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(undefined);
    setData(previous => previous && keepWhileRefreshing?.(previous) ? previous : undefined);
    void apiRequest<Result>(path).then((value) => { if (current) { setData(value); setLoadedRevision(revision); } }).catch((cause) => {
      if (current) { setData(undefined); setError(supplierError(cause)); }
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [path, revision, keepWhileRefreshing]);
  return { data, error, loading, refreshing: revision !== loadedRevision && !error, loadedRevision, reload: () => setRevision((value) => value + 1) };
}
