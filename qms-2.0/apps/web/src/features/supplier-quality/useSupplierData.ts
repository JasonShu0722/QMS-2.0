import { useEffect, useState } from 'react';
import { apiRequest } from '../../api/client';
import { supplierError } from './supplierQuality';

export function useSupplierData<Result>(path: string) {
  const [data, setData] = useState<Result>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(undefined);
    setData(undefined);
    void apiRequest<Result>(path).then((value) => { if (current) setData(value); }).catch((cause) => { if (current) setError(supplierError(cause)); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [path, revision]);
  return { data, error, loading, reload: () => setRevision((value) => value + 1) };
}
