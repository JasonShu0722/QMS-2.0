import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Space, Tabs } from 'antd';
import { RefreshCw } from 'lucide-react';
import { useLocation, useSearchParams } from 'react-router-dom';
import type { components } from '@qms/contracts';
import { subscribeSessionSignals } from '../../features/auth/session-invalidation';
import { useNavigationGuard } from '../../layouts/UnsavedChanges';
import { useLedgerSessionEpoch } from '../../ui/ledger/preferences';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { useConsoleContext } from '../ConsoleLayout';
import type { ConsoleContext } from '../console-navigation';
import { isAborted, useScopedIntegrationRequests, type IntegrationScope } from '../api-integrations/integration-ui';
import { IngestionError, ingestionPath, useIngestionText, type Endpoint } from './ingestion-ui';
import { RuleList } from './RuleList';
import { JobList } from './JobList';
import './api-ingestion.css';

export function ApiIngestionPage() {
  const { context, invalidate } = useConsoleContext();
  const session = useWorkTabsStore(state => state.sessionScope);
  const epoch = useLedgerSessionEpoch(); const text = useIngestionText();
  const [searchParams, setSearchParams] = useSearchParams(); const requestLeave = useNavigationGuard();
  const receiptValues = searchParams.getAll('receiptId'); const receiptId = receiptValues[0];
  const invalidReceipt = receiptValues.length > 1 || receiptId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(receiptId);
  const [retired, setRetired] = useState(false);
  useEffect(() => { setRetired(false); }, [context]);
  useEffect(() => useWorkTabsStore.subscribe((next, previous) => { if (next.sessionScope !== previous.sessionScope) { setRetired(true); invalidate(); } }), [invalidate]);
  const organization = context.targetOrganization;
  const key = JSON.stringify([session, epoch, context.actor.id, context.actor.homeOrganization.id, [organization.id, organization.type, organization.status, organization.configurationRequired], context.modules, searchParams.toString()]);
  if (retired) return <Alert role="alert" type="error" showIcon title={text('无权访问API入库衔接', 'API ingestion access denied')} />;
  if (invalidReceipt) return <Alert role="alert" type="error" showIcon title={text('接收记录筛选无效', 'Invalid receiving record filter')} />;
  const clearReceipt = () => requestLeave(() => setSearchParams(previous => { const next = new URLSearchParams(previous); next.delete('receiptId'); return next; }));
  const viewJobs = (open: () => void) => requestLeave(() => { if (!receiptId) open(); setSearchParams(previous => { const next = new URLSearchParams(previous); next.delete('receiptId'); return next; }, { state: { ingestionTab: 'jobs' } }); });
  return <IngestionPage key={key} context={context} session={session} epoch={epoch} invalidate={invalidate} receiptId={receiptId} clearReceipt={clearReceipt} viewJobs={viewJobs} />;
}
function IngestionPage({ context, session, epoch, invalidate, receiptId, clearReceipt, viewJobs }: { context: ConsoleContext; session?: string; epoch: number; invalidate: () => void; receiptId?: string; clearReceipt: () => void; viewJobs: (open: () => void) => void }) {
  const text = useIngestionText(); const requestLeave = useNavigationGuard();
  const location = useLocation();
  const [denied, setDenied] = useState(false);
  const deny = useCallback(() => { setDenied(true); invalidate(); }, [invalidate]);
  const module = context.modules.find(item => item.key === 'api-ingestion' && item.scope === 'TARGET' && item.coverage === 'ORGANIZATION' && item.organizationId === context.targetOrganization.id);
  const permissions = module?.permissions ?? [];
  const receiptModule = context.modules.find(item => item.key === 'api-integrations' && item.scope === 'TARGET' && item.coverage === 'ORGANIZATION' && item.organizationId === context.targetOrganization.id);
  const valid = !denied && permissions.includes('ingestion:read') && session === `INTERNAL:${context.actor.homeOrganization.id}:${context.actor.id}` && context.actor.accountType === 'INTERNAL'
    && context.targetOrganization.type === 'INTERNAL' && context.targetOrganization.status === 'ACTIVE' && !context.targetOrganization.configurationRequired;
  const scope = useMemo<IntegrationScope>(() => ({ organizationId: context.targetOrganization.id, session: session ?? '', epoch, permissions, deny }), [context.targetOrganization.id, session, epoch, module, deny]);
  const [tab, setTab] = useState(receiptId || location.state?.ingestionTab === 'jobs' ? 'jobs' : 'rules');
  useEffect(() => subscribeSessionSignals(signal => { if (signal === 'invalidate') deny(); }), [deny]);
  if (!valid) return <Alert role="alert" type="error" showIcon title={text('无权访问API入库衔接', 'API ingestion access denied')} />;
  return <IngestionContent scope={scope} tab={tab} changeTab={next => requestLeave(() => setTab(next))} viewJobs={() => viewJobs(() => setTab('jobs'))} canReceipts={!!receiptModule && ['integration:receipts:read', 'integration:payload:read'].every(permission => receiptModule.permissions.includes(permission))} receiptId={receiptId} clearReceipt={clearReceipt} />;
}
function IngestionContent({ scope, tab, changeTab, viewJobs, canReceipts, receiptId, clearReceipt }: { scope: IntegrationScope; tab: string; changeTab: (tab: string) => void; viewJobs: () => void; canReceipts: boolean; receiptId?: string; clearReceipt: () => void }) {
  const text = useIngestionText(); const { read, current } = useScopedIntegrationRequests(scope);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]); const [error, setError] = useState<unknown>(); const [loading, setLoading] = useState(true); const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true; setLoading(true); setError(undefined); setEndpoints([]);
    void (async () => {
      const all: Endpoint[] = []; let page = 1;
      do {
        const result = await read<components['schemas']['IngestionEndpointPageDto']>(`${ingestionPath}/endpoints`, { page: String(page), limit: '100' });
        if (!active || !current()) return;
        if (!Array.isArray(result.items) || result.page !== page || result.limit !== 100 || !Number.isSafeInteger(result.total) || result.total < 0 || result.items.length === 0 && all.length < result.total) { scope.deny(); return; }
        all.push(...result.items); if (all.length >= result.total) break; page += 1;
      } while (active && current());
      if (active && current()) setEndpoints(all);
    })().catch(cause => { if (active && current() && !isAborted(cause)) setError(cause); }).finally(() => { if (active && current()) setLoading(false); });
    return () => { active = false; };
  }, [scope, read, current, revision]);
  return <section className="qms-ingestion-page" aria-label={text('API入库衔接', 'API ingestion')}>
    <IngestionError error={error} />
    {!!error && <Space><Button icon={<RefreshCw size={15} />} onClick={() => setRevision(value => value + 1)}>{text('重试加载接口', 'Retry loading interfaces')}</Button></Space>}
    <Tabs activeKey={tab} destroyOnHidden onChange={changeTab} items={[
      { key: 'rules', label: text('规则', 'Rules'), children: <RuleList scope={scope} endpoints={endpoints} endpointsLoading={loading} canReceipts={canReceipts} onViewJobs={viewJobs} /> },
      { key: 'jobs', label: text('处理任务', 'Processing jobs'), children: <JobList scope={scope} endpoints={endpoints} receiptId={receiptId} clearReceipt={clearReceipt} canReceipts={canReceipts} /> },
    ]} />
  </section>;
}
