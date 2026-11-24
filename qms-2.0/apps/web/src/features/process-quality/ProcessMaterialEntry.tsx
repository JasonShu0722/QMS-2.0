import type { components } from '@qms/contracts';
import { Alert, Button, Form, Input, Select, Spin } from 'antd';
import { ScanBarcode } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { apiRequest, ApiError } from '../../api/client';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { ProcessTraceScanner } from './ProcessTraceScanner';
import './process-material-entry.css';

type Material = components['schemas']['ProcessDefectMaterialInputDto'];
type MaterialMasterPage = components['schemas']['MaterialMasterPageDto'];
type Supplier = components['schemas']['SupplierProfileDto'];
type EntryFields = Pick<Material, 'materialCode' | 'materialName' | 'materialBatch' | 'supplierProfileId' | 'supplierOrganizationId'>;

function batchLabel(value: string) {
  const fields = value.split('&');
  if (fields.length !== 6) return;
  const [supplierCode, materialBatch, materialCode] = fields.slice(2, 5).map(field => field.trim());
  if (!supplierCode || !materialBatch || !materialCode || [supplierCode, materialBatch, materialCode].some(field => field.length > 100)) return;
  return { supplierCode, materialBatch, materialCode };
}

async function findMaterial(code: string, organizationId: string | undefined, signal: AbortSignal) {
  const query = new URLSearchParams({ search: code, pageSize: '100' });
  if (organizationId) query.set('organizationId', organizationId);
  let seen = 0;
  for (let page = 1; !signal.aborted; page += 1) {
    query.set('page', String(page));
    const result = await apiRequest<MaterialMasterPage>(`/api/v1/material-masters?${query}`, { signal });
    const match = result.items.find(item => item.materialCode === code);
    if (match) return match;
    seen += result.items.length;
    if (seen >= result.total) return;
    if (!result.items.length) throw new Error('物料主数据分页不完整');
  }
}

function supplierFields(supplier: Supplier | undefined): EntryFields {
  return { supplierProfileId: supplier?.id ?? null, supplierOrganizationId: supplier?.supplierOrganizationId ?? null };
}

export function ProcessMaterialEntry({ number, value, suppliers, canReadSuppliers, organizationId, disabled, onChange, onLookupPendingChange }: {
  number: number;
  value?: EntryFields;
  suppliers: readonly Supplier[];
  canReadSuppliers: boolean;
  organizationId?: string;
  disabled?: boolean;
  onChange: (patch: EntryFields) => void;
  onLookupPendingChange?: (pending: boolean) => void;
}) {
  const fieldId = useId();
  const scope = useWorkTabsStore(state => state.sessionScope);
  const [scanning, setScanning] = useState(false);
  const [pending, setPending] = useState<'manual' | 'scan'>();
  const [materialWarning, setMaterialWarning] = useState('');
  const [supplierWarning, setSupplierWarning] = useState('');
  const [scanWarning, setScanWarning] = useState('');
  const lookup = useRef<AbortController>(undefined);
  const callbacks = useRef({ onChange, onLookupPendingChange });
  callbacks.current = { onChange, onLookupPendingChange };

  useLayoutEffect(() => {
    setPending(undefined);
    setScanning(false);
    return () => {
      if (!lookup.current) return;
      lookup.current.abort();
      lookup.current = undefined;
      callbacks.current.onLookupPendingChange?.(false);
    };
  }, [disabled, organizationId, scope, canReadSuppliers]);

  function cancelLookup() {
    if (!lookup.current) return;
    lookup.current.abort();
    lookup.current = undefined;
    setPending(undefined);
    callbacks.current.onLookupPendingChange?.(false);
  }

  async function resolveMaterial(code: string, scanned?: { materialBatch: string; supplier: Supplier }) {
    if (disabled || !code || lookup.current) return;
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && scope === useWorkTabsStore.getState().sessionScope;
    lookup.current = controller;
    setMaterialWarning('');
    setPending(scanned ? 'scan' : 'manual');
    callbacks.current.onLookupPendingChange?.(true);
    try {
      const material = await findMaterial(code, organizationId, controller.signal);
      if (!current()) return;
      const materialName = material?.materialName ?? null;
      if (scanned) {
        callbacks.current.onChange({ materialCode: code, materialName, materialBatch: scanned.materialBatch, ...supplierFields(scanned.supplier) });
        setSupplierWarning('');
      } else {
        callbacks.current.onChange({ materialName });
      }
      if (!material) setMaterialWarning(`物料「${code}」未匹配主数据，可按原编码保存。`);
    } catch (cause) {
      if (!current()) return;
      const denied = cause instanceof ApiError && cause.status === 403;
      const warning = denied ? '无物料主数据读取权限。' : scanned ? '物料查询失败，原值已保留，请重新扫描。' : '物料查询失败，请按 Enter 重试。';
      if (scanned) setScanWarning(warning);
      else setMaterialWarning(warning);
    } finally {
      if (lookup.current === controller) cancelLookup();
    }
  }

  function scan(raw: string) {
    if (disabled || !canReadSuppliers) return;
    const label = batchLabel(raw);
    if (!label) { setScanWarning('批次标签格式无效或缺少编码、批次，请重新扫描。'); return; }
    const supplier = suppliers.find(item => item.businessCode === label.supplierCode);
    if (!supplier) {
      setSupplierWarning(`供应商「${label.supplierCode}」暂未匹配，原值已保留。请确认供应商资料加载完成、核对编码后重新扫描。`);
      return;
    }
    setScanWarning('');
    cancelLookup();
    void resolveMaterial(label.materialCode, { materialBatch: label.materialBatch, supplier });
  }

  const supplierOptions = canReadSuppliers ? suppliers.map(supplier => ({ value: supplier.id, label: `${supplier.displayName}（${supplier.businessCode}）`, name: supplier.displayName })) : [];
  if (value?.supplierProfileId && !supplierOptions.some(option => option.value === value.supplierProfileId)) {
    supplierOptions.push({ value: value.supplierProfileId, label: '原供应商（资料不可用）', name: '' });
  }
  const scanPending = pending === 'scan';
  const missingMaterial = !value?.materialCode?.trim();
  const missingSupplier = !value?.supplierProfileId;
  return <>
    <div className="process-material-entry-tools">
      <Button type="primary" icon={<ScanBarcode size={16} />} disabled={disabled || !!pending || !canReadSuppliers} onClick={() => setScanning(true)}>扫描批次标签</Button>
    </div>
    {scanWarning ? <Alert type="warning" showIcon title={scanWarning} /> : null}
    <div className="process-material-entry-grid">
    <Form.Item label={`物料编码 ${number}`} htmlFor={`${fieldId}-material`} required
      validateStatus={missingMaterial ? 'error' : materialWarning ? 'warning' : undefined} help={missingMaterial ? '请输入物料编码。' : materialWarning || undefined}>
      <Input id={`${fieldId}-material`} value={value?.materialCode ?? ''} maxLength={100} disabled={disabled || scanPending} onChange={event => {
        const code = event.target.value;
        cancelLookup();
        setMaterialWarning('');
        setScanWarning('');
        onChange(code.trim() === value?.materialCode?.trim() ? { materialCode: code } : { materialCode: code, materialName: null });
      }} onBlur={event => { if (!value?.materialName) void resolveMaterial(event.currentTarget.value.trim()); }} onPressEnter={event => {
        event.preventDefault();
        void resolveMaterial(event.currentTarget.value.trim());
      }} />
    </Form.Item>
    <Form.Item label={`物料名称 ${number}`} htmlFor={`${fieldId}-name`}>
      <Input id={`${fieldId}-name`} value={value?.materialName ?? ''} placeholder={missingMaterial || pending ? undefined : '未匹配'} readOnly disabled={disabled} suffix={pending ? <Spin size="small" aria-label="查询物料" /> : <span />} />
    </Form.Item>
    <Form.Item label={`供应商名称 ${number}`} htmlFor={`${fieldId}-supplier`} required
      validateStatus={missingSupplier ? 'error' : supplierWarning ? 'warning' : undefined} help={supplierWarning || (missingSupplier ? '请选择供应商。' : undefined)}>
      <Select id={`${fieldId}-supplier`} value={value?.supplierProfileId ?? undefined} allowClear disabled={disabled || scanPending || !canReadSuppliers}
        showSearch={{ optionFilterProp: 'name' }} options={supplierOptions} notFoundContent="没有匹配的供应商"
        onChange={id => { setSupplierWarning(''); onChange(supplierFields(suppliers.find(supplier => supplier.id === id))); }} />
    </Form.Item>
    <Form.Item label={`物料批次 ${number}`} htmlFor={`${fieldId}-batch`}>
      <Input id={`${fieldId}-batch`} value={value?.materialBatch ?? ''} maxLength={100} disabled={disabled || scanPending} onChange={event => { setScanWarning(''); onChange({ materialBatch: event.target.value }); }} />
    </Form.Item>
    </div>
    {scanning && !disabled && canReadSuppliers ? <ProcessTraceScanner purpose="material-batch" onScan={scan} onClose={() => setScanning(false)} /> : null}
  </>;
}
