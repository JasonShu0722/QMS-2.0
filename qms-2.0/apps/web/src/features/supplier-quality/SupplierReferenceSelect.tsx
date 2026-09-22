import { Alert, Button, Select } from 'antd';
import { useEffect, useState } from 'react';
import { apiRequest } from '../../api/client';
import { supplierError, type ReferenceOption, type ReferenceOptions } from './supplierQuality';

export function SupplierReferenceSelect({ path, value, onChange, id, disabled, placeholder }: {
  path: string; value?: string; onChange?: (value: string) => void; id?: string; disabled?: boolean; placeholder?: string;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<ReferenceOption[]>([]);
  const [selected, setSelected] = useState<ReferenceOption>();
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [selectedError, setSelectedError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const separator = path.includes('?') ? '&' : '?';
  useEffect(() => {
    let current = true;
    setLoading(true); setError(undefined);
    const timer = window.setTimeout(() => {
      void apiRequest<ReferenceOptions>(`${path}${separator}page=${page}&pageSize=20&search=${encodeURIComponent(search)}`).then((result) => {
        if (!current) return;
        setItems((previous) => page === 1 ? result.items : [...new Map([...previous, ...result.items].map((item) => [item.id, item])).values()]);
        setTotal(result.total);
      }).catch((cause) => { if (current) setError(supplierError(cause)); }).finally(() => { if (current) setLoading(false); });
    }, 200);
    return () => { current = false; window.clearTimeout(timer); };
  }, [path, separator, page, search, revision]);
  useEffect(() => {
    let current = true;
    setSelected(undefined); setSelectedError(undefined);
    if (value) void apiRequest<ReferenceOptions>(`${path}${separator}selectedId=${encodeURIComponent(value)}`).then((result) => {
      if (current) {
        setSelected(result.items[0]);
        if (!result.items.length) setSelectedError('原选择已不可用，请重新选择');
      }
    }).catch((cause) => { if (current) setSelectedError(supplierError(cause)); });
    return () => { current = false; };
  }, [path, separator, value, revision]);
  const options = [...new Map([...(selected ? [selected] : []), ...items].map((item) => [item.id, item])).values()];
  return <div className="supplier-reference-select">
    <Select id={id} value={value} disabled={disabled} placeholder={placeholder} showSearch filterOption={false} loading={loading} searchValue={search}
      onSearch={(text) => { setSearch(text.slice(0, 100)); setPage(1); setItems([]); setTotal(0); }}
      onChange={(next: string) => { onChange?.(next); setSearch(''); setPage(1); }}
      options={options.map((item) => ({ value: item.id, label: item.label }))}
      notFoundContent={loading ? '加载中…' : error ? '选项加载失败' : '无匹配结果'}
      popupRender={(menu) => <>{menu}{items.length < total ? <Button block type="text" loading={loading} disabled={!!error} onMouseDown={(event) => event.preventDefault()} onClick={() => setPage((current) => current + 1)}>加载更多</Button> : null}</>} />
    {error || selectedError ? <Alert type="error" title={error ?? selectedError} action={<Button size="small" onClick={() => setRevision((current) => current + 1)}>重试加载选项</Button>} /> : null}
  </div>;
}
