import { Alert, Button, Card, Empty, Input, Select, Space, Spin, Tag } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { components } from '@qms/contracts';
import { useLanguage } from '../../i18n/Language';
import { ApiError, apiRequest, csrfToken, safeAccountError } from '../../api/client';
import { useNavigationBusy } from '../../layouts/UnsavedChanges';
import './site-scanning.css';

type Rule = { id: string; title: string; materialCode: string; prefix: string; codeLength: number; status: string; version: number };
type RulePage = { items: Rule[]; total: number; page: number; pageSize: number };

function denied(cause: unknown) { return cause instanceof ApiError && (cause.status === 403 || cause.code === 'FEATURE_PERMISSION_DENIED' || cause.code === 'ORGANIZATION_SCOPE_DENIED'); }

export function SiteScanningPage() {
  const { t } = useLanguage();
  const [rules, setRules] = useState<Rule[]>([]);
  const [selected, setSelected] = useState<string>();
  const [code, setCode] = useState('');
  const [batch, setBatch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [result, setResult] = useState<string>();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  useNavigationBusy(busy);
  const [retryBody, setRetryBody] = useState<{ ruleId: string; barcode: string; batchCode?: string }>();
  const [key, setKey] = useState<string>();
  const available = useMemo(() => rules.filter((rule) => rule.status === 'PUBLISHED'), [rules]);

  useEffect(() => {
    let active = true;
    Promise.all([apiRequest<components['schemas']['PermissionsResponseDto']>('/api/v1/system/my-permissions'), apiRequest<RulePage>('/api/v1/supplier-barcode?page=1&pageSize=100')])
      .then(([permissions, page]) => {
        if (!active) return;
        if (!permissions.permissions?.includes('supplier-barcode:scan')) { setError(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: '暂无现场扫码权限' }, 403)); return; }
        setRules(page.items); setSelected(page.items.find((rule) => rule.status === 'PUBLISHED')?.id);
      }).catch((cause) => { if (active) setError(cause); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function scan(body = retryBody ?? { ruleId: selected!, barcode: code.trim(), ...(batch.trim() ? { batchCode: batch.trim() } : {}) }) {
    if (pending.current) return;
    const rule = available.find((item) => item.id === body.ruleId);
    if (!rule || body.barcode.length !== rule.codeLength || !body.barcode.startsWith(rule.prefix)) { setError(new Error('条码格式与规则不符')); return; }
    pending.current = true;
    const nextKey = key ?? crypto.randomUUID(); setKey(nextKey); setRetryBody(body); setBusy(true); setError(undefined);
    try {
      await apiRequest('/api/v1/supplier-barcode/scan', { method: 'POST', headers: { 'x-csrf-token': await csrfToken(), 'Idempotency-Key': nextKey }, body: JSON.stringify(body) });
      setResult(`${body.barcode} 已归档`); setCode(''); setBatch(''); setRetryBody(undefined); setKey(undefined);
    } catch (cause) { setError(cause); } finally { pending.current = false; setBusy(false); }
  }

  if (loading) return <main className="site-scanning-page"><Spin /> </main>;
  if (error && denied(error)) return <main className="site-scanning-page"><Alert type="warning" showIcon title="暂无现场扫码权限" /></main>;
  return <main className="site-scanning-page"><h1 className="sr-only">{t('关键件条码校验')}</h1>
    {error ? <Alert type="error" showIcon title={error instanceof Error ? error.message : safeAccountError(error)} action={retryBody ? <Button disabled={busy} onClick={() => void scan()}>重试扫码</Button> : undefined} /> : null}
    <Card><Space orientation="vertical" style={{ width: '100%' }} size={6}>
      {!available.length ? <Empty description="暂无已发布条码规则" /> : <><Select aria-label="条码规则" disabled={busy} value={selected} onChange={setSelected} options={available.map((rule) => ({ value: rule.id, label: `${rule.title} · ${rule.materialCode}` }))} />
        <Input aria-label="条码" disabled={busy} autoFocus value={code} onChange={(event) => setCode(event.target.value)} onPressEnter={() => void scan()} placeholder="扫描或输入条码" />
        <Input aria-label="批次（可选）" disabled={busy} value={batch} onChange={(event) => setBatch(event.target.value)} placeholder="批次（可选）" />
        <Button type="primary" disabled={!code.trim() || busy} loading={busy} onClick={() => void scan()}>确认扫码</Button></>}
      {result ? <Tag color="green">{result}</Tag> : null}
    </Space></Card></main>;
}
