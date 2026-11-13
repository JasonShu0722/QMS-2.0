import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Input, Pagination, Spin } from 'antd';
import type { components } from '@qms/contracts';
import { apiRequest } from '../../api/client';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { candidateLabel, LedgerError, ledgerBase, scopedLedger, type LedgerCandidate } from './customer-ledger-ui';
import { ledgerDenied } from './customer-ledger-write';

type Props = {
  label: string; value: string; candidates: LedgerCandidate[]; onChange: (value: string) => void; children?: ReactNode;
  organizationId?: string; componentCode?: string; stage?: 'NEW_PRODUCT' | 'MASS_PRODUCTION' | null; disabled?: boolean;
  onDenied: (cause: unknown) => void;
};

export function CustomerEngineerSelect(props: Props) {
  const scope = useWorkTabsStore(state => state.sessionScope);
  return <EngineerSelectScope key={JSON.stringify([scope, props.organizationId, props.componentCode, props.stage])} {...props} scope={scope} />;
}

function EngineerSelectScope({ label, value, candidates, onChange, children, organizationId, componentCode, stage, disabled, onDenied, scope }: Props & { scope?: string }) {
  const [query, setQuery] = useState<{ search: string; page: number }>();
  const [result, setResult] = useState<components['schemas']['CustomerLedgerCandidatesDto']>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>();
  const [revision, setRevision] = useState(0);
  const [invalidated, setInvalidated] = useState(false);
  const retired = useRef(false);
  const selected = useRef<LedgerCandidate | undefined>(undefined);
  const denied = useRef(onDenied); denied.current = onDenied;
  useEffect(() => useWorkTabsStore.subscribe(state => {
    if (state.sessionScope === scope) return;
    retired.current = true; selected.current = undefined; setInvalidated(true); setResult(undefined); setLoading(false); setError(undefined);
  }), [scope]);
  useEffect(() => {
    if (!query || invalidated) return;
    const controller = new AbortController();
    const current = () => !retired.current && !controller.signal.aborted && scope === useWorkTabsStore.getState().sessionScope;
    setLoading(true); setResult(undefined); setError(undefined);
    const params = new URLSearchParams({ search: query.search, limit: '20', offset: String((query.page - 1) * 20) });
    if (componentCode) params.set('componentCode', componentCode);
    if (stage) params.set('stage', stage);
    void apiRequest<components['schemas']['CustomerLedgerCandidatesDto']>(scopedLedger(`${ledgerBase}/candidates?${params}`, organizationId), { signal: controller.signal })
      .then(next => { if (current()) setResult(next); })
      .catch(cause => { if (current()) { setError(cause); if (ledgerDenied(cause)) denied.current(cause); } })
      .finally(() => { if (current()) setLoading(false); });
    return () => controller.abort();
  }, [query, organizationId, componentCode, stage, scope, revision, invalidated]);
  const items = invalidated ? [] : query ? result?.items ?? [] : candidates.slice(0, 20);
  const matching = invalidated ? undefined : [...items, ...candidates].find(candidate => candidate.assignmentId === value);
  if (matching) selected.current = matching;
  const preserved = selected.current?.assignmentId === value ? selected.current : undefined;
  const options = preserved && !items.some(candidate => candidate.assignmentId === value) ? [preserved, ...items] : items;
  return <div>
    <Input.Search aria-label={`搜索${label}`} maxLength={200} disabled={disabled || invalidated} onSearch={search => setQuery({ search: search.trim(), page: 1 })} />
    {loading ? <Spin size="small" aria-label="正在加载候选人员" /> : null}
    <LedgerError cause={error} />
    {error ? <Button disabled={disabled || loading} onClick={() => setRevision(current => current + 1)}>重试候选人员</Button> : null}
    <select aria-label={label} value={value} disabled={disabled || invalidated || loading || !!error} onChange={event => onChange(event.target.value)}>
      {children}{options.map(candidate => <option key={candidate.assignmentId} value={candidate.assignmentId}>{candidateLabel(candidate)}</option>)}
    </select>
    <Pagination size="small" current={query?.page ?? 1} pageSize={20} total={invalidated ? 0 : query ? result?.total ?? 0 : candidates.length} showSizeChanger={false} disabled={disabled || invalidated || loading || !!error} onChange={page => setQuery({ search: query?.search ?? '', page })} />
  </div>;
}
