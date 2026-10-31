import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Space, Spin, Typography } from 'antd';
import type { components } from '@qms/contracts';
import { useNavigate } from 'react-router-dom';
import { ApiError, apiRequest, csrfToken, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useCompletedSessionNavigation, useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { getWorkflow, getWorkflows, getWorkflowVersion } from './workflow-api';

type Binding = components['schemas']['ProcessEightDBindingResultDto'] | components['schemas']['CustomerEightDBindingResultDto'] | components['schemas']['NewProductEightDBindingResultDto'];
type Permissions = components['schemas']['PermissionsResponseDto'];
type Candidate = { definition: components['schemas']['WorkflowDefinitionDetailDto']; version: components['schemas']['WorkflowVersionSummaryDto'] };
type Attempt = { path: string; body: components['schemas']['ProcessEightDBindingDto'] | components['schemas']['ProcessEightDActivationDto'] | components['schemas']['CustomerEightDBindingDto'] | components['schemas']['CustomerEightDActivationDto'] | components['schemas']['NewProductEightDBindingDto'] | components['schemas']['NewProductEightDActivationDto']; key: string };
const domains = [
  { value: 'process-quality', label: '过程' },
  { value: 'customer-quality', label: '客户' },
  { value: 'new-product-quality', label: '新品' },
] as const;
export type EightDBindingDomain = typeof domains[number]['value'];
type Props = { domain?: EightDBindingDomain; onDomainChange?: (domain: EightDBindingDomain) => void };

export function ProcessEightDBinding({ domain = 'process-quality', onDomainChange }: Props = {}) {
  const session = useWorkTabsStore(state => state.sessionScope);
  return <BindingScope key={`${session ?? ''}:${domain}`} session={session} domain={domain} onDomainChange={onDomainChange} />;
}

function BindingScope({ session, domain, onDomainChange }: Props & { session?: string; domain: EightDBindingDomain }) {
  const { t } = useLanguage();
  const label = domains.find(item => item.value === domain)!.label;
  const base = `/api/v1/${domain}/eight-d`;
  const navigate = useNavigate();
  const completeSessionNavigation = useCompletedSessionNavigation();
  const leave = useNavigationGuard();
  const [permissions, setPermissions] = useState<Permissions>();
  const [binding, setBinding] = useState<Binding | null>();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState<unknown>();
  const [readFailed, setReadFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);
  const [stale, setStale] = useState(false);
  const [revision, setRevision] = useState(0);
  const [uncertain, setUncertain] = useState<Attempt>();
  const lifetime = useRef<AbortController | undefined>(undefined);
  const revoked = useRef(false);
  const lock = useRef(false);
  const current = () => !revoked.current && !!lifetime.current && !lifetime.current.signal.aborted && useWorkTabsStore.getState().sessionScope === session;
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    const unsubscribe = useWorkTabsStore.subscribe(state => { if (state.sessionScope !== session) controller.abort(); });
    return () => { controller.abort(); unsubscribe(); };
  }, [session]);
  function report(cause: unknown) {
    setError(cause);
    if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403 || ['AUTH_SESSION_REQUIRED', 'FEATURE_PERMISSION_DENIED', 'ORGANIZATION_SCOPE_DENIED'].includes(cause.code))) {
      revoked.current = true; lifetime.current?.abort(); setDenied(true); setBusy(false); setLoading(false);
      setPermissions(undefined); setBinding(undefined); setCandidates([]); setSelected(''); setUncertain(undefined);
      if (cause.status === 401 || cause.code === 'AUTH_SESSION_REQUIRED') setUnauthorized(true);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    const active = () => current() && !controller.signal.aborted;
    setLoading(true); setReadFailed(false); setError(undefined);
    async function load() {
      try {
        const access = await apiRequest<Permissions>('/api/v1/system/my-permissions', { signal: controller.signal });
        if (!active()) return;
        setPermissions(access);
        if (!access.permissions.includes('configuration:read')) return;
        const saved = await apiRequest<Binding | null>(`${base}/binding?${new URLSearchParams({ organizationId: access.organizationId })}`, { signal: controller.signal });
        if (!active()) return;
        const options: Candidate[] = [];
        if (access.permissions.includes('workflow:manage')) {
          // The list exposes latest versions, so read history to include published versions behind a newer draft.
          for (let offset = 0; ; offset += 100) {
            const page = await getWorkflows(new URLSearchParams({ pageSize: '100', offset: String(offset) }), controller.signal);
            if (!active()) return;
            const histories = await Promise.all(page.items.map(item => getWorkflow(item.id, controller.signal)));
            if (!active()) return;
            for (const definition of histories) {
              if (definition.organizationId === access.organizationId) for (const version of definition.versions) {
                if (version.status !== 'PUBLISHED') continue;
                const published = await getWorkflowVersion(definition.id, version.id, controller.signal);
                if (!active()) return;
                const reviews = published.version.structureSnapshot.nodes.flatMap(node => node.config?.closureReview ? [node.config.closureReview] : []);
                if (published.organizationId === access.organizationId && published.id === definition.id && published.version.id === version.id && published.version.status === 'PUBLISHED'
                  && reviews.length && reviews.every(review => review.policy === 'INTERNAL' && review.domainCode === domain)) options.push({ definition, version });
              }
            }
            if (offset + page.items.length >= page.total) break;
            if (!page.items.length || offset >= 10000) throw new Error('Incomplete workflow list');
          }
        }
        if (!active()) return;
        setBinding(saved); setCandidates(options); setSelected(saved?.workflowVersionId ?? ''); setStale(false);
      } catch (cause) { if (active()) { setReadFailed(true); report(cause); } }
      finally { if (active()) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [revision, session, domain]);
  const dirty = !denied && (!!uncertain || selected !== (binding?.workflowVersionId ?? ''));
  useUnsavedChanges(dirty);
  useNavigationBusy(busy || !!uncertain);
  useEffect(() => {
    if (!unauthorized || session !== useWorkTabsStore.getState().sessionScope) return;
    completeSessionNavigation(() => { useWorkTabsStore.getState().reset(); navigate('/login', { replace: true }); });
  }, [unauthorized, session, completeSessionNavigation, navigate]);
  const candidate = candidates.find(item => item.version.id === selected);
  const canManage = permissions?.permissions.includes('configuration:manage') && permissions.permissions.includes('workflow:manage');
  const locked = denied || !canManage || loading || busy || stale || readFailed || binding === undefined;
  async function write(activation: boolean, retry?: Attempt) {
    if (!current() || lock.current || (!retry && (locked || uncertain))) return;
    if (!retry && (activation ? !binding || dirty : !candidate)) return;
    const attempt = retry ?? { path: `${base}/${activation ? 'activation' : 'binding'}`, body: activation
      ? { organizationId: permissions!.organizationId, expectedVersion: binding!.version, enabled: !binding!.enabled }
      : { organizationId: permissions!.organizationId, expectedVersion: binding?.version ?? 0, workflowDefinitionId: candidate!.definition.id, workflowVersionId: candidate!.version.id }, key: crypto.randomUUID() };
    lock.current = true; setBusy(true); setError(undefined);
    try {
      const signal = lifetime.current!.signal;
      const token = await csrfToken(signal);
      if (!current()) return;
      const result = await apiRequest<Binding>(attempt.path, { method: 'PUT', signal, headers: { 'x-csrf-token': token, 'Idempotency-Key': attempt.key }, body: JSON.stringify(attempt.body) }, { replayAfterReauthentication: false });
      if (current()) { setBinding(result); setSelected(result.workflowVersionId); setUncertain(undefined); }
    } catch (cause) {
      if (!current()) return;
      report(cause);
      if (!current()) return;
      if (cause instanceof ApiError && (cause.status === 409 || cause.code === 'CONCURRENCY_CONFLICT')) { setStale(true); setUncertain(undefined); }
      else if (retry || !(cause instanceof ApiError) || cause.code === 'CLIENT_REAUTHENTICATION_COMPLETED' || !cause.status || cause.status === 408 || cause.status === 425 || cause.status >= 500) setUncertain(attempt);
      else setUncertain(undefined);
    } finally { lock.current = false; if (current()) setBusy(false); }
  }
  return <Card><Typography.Title level={3}>{t(`${label}8D流程绑定与启用`)}</Typography.Title>
    {onDomainChange && <label>{t('8D绑定领域')}<select aria-label={t('8D绑定领域')} value={domain} disabled={denied || loading || busy || !!uncertain} onChange={event => {
      const next = domains.find(item => item.value === event.target.value);
      if (next && next.value !== domain) leave(() => onDomainChange(next.value));
    }}>{domains.map(item => <option key={item.value} value={item.value}>{t(`${item.label}质量`)}</option>)}</select></label>}


    {!!error && <Alert type="error" showIcon title={t(stale ? '绑定版本已变化，选择已保留，请刷新基线后重试。' : readFailed && !denied ? '无法加载8D绑定配置，请重试。' : safeAccountError(error))} description={error instanceof ApiError && error.traceId ? <code>{error.traceId}</code> : undefined} />}
    {loading && <Spin aria-label={t('正在加载8D配置')} />}
    {!denied && permissions && !permissions.permissions.includes('configuration:read') && <Alert type="warning" title={t('当前会话无配置读取权限')} />}
    {!denied && permissions?.permissions.includes('configuration:read') && <Space orientation="vertical" style={{ width: '100%' }}>
      {binding === null && <Alert type="warning" title={t('当前组织尚未绑定8D流程，请选择真实已发布版本后保存。')} />}
      {binding && <p>{t(`${label}8D${binding.enabled ? '已启用' : '未启用'}`)} · {t('配置版本')} {binding.version} · <code>{binding.workflowVersionId}</code></p>}
      {!canManage && <Alert type="info" title={t('当前会话仅可查看8D配置，管理需要流程与配置权限。')} />}
      {!loading && !readFailed && canManage && !candidates.length && <Alert type="error" title={t(`没有可选的${label}质量内部已发布流程，请先在流程设计器完成草稿与发布。`)} />}
      <label>{t('8D已发布流程版本')}<select aria-label={t('8D已发布流程版本')} disabled={locked || !!uncertain} value={selected} onChange={event => setSelected(event.target.value)}>
        <option value="">{t('请选择真实已发布流程')}</option>
        {selected && !candidate && <option value={selected} disabled>{t('当前绑定版本不可选择')} · {selected}</option>}
        {candidates.map(item => <option key={item.version.id} value={item.version.id}>{item.definition.name} · v{item.version.version} · {item.version.id}</option>)}
      </select></label>
      <Space wrap><Button disabled={locked || !candidate || !!uncertain} onClick={() => void write(false)}>{t('保存8D绑定')}</Button>
        <Button disabled={locked || !binding || dirty || !!uncertain} onClick={() => void write(true)}>{t(`${binding?.enabled ? '停用' : '启用'}${label}8D`)}</Button></Space>
    </Space>}
    {uncertain && <Alert type="warning" title={t('配置写入结果未确认，输入已冻结，只能重试原请求。')} action={<Button disabled={busy || denied} onClick={() => void write(false, uncertain)}>{t('重试原配置请求')}</Button>} />}
    {!denied && <Button disabled={loading || busy || !!uncertain} onClick={() => leave(() => setRevision(value => value + 1))}>{t('刷新8D配置基线')}</Button>}
  </Card>;
}
