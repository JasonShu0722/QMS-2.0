import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Space, Spin, Typography } from 'antd';
import type { components } from '@qms/contracts';
import { Link } from 'react-router-dom';
import { ApiError, apiRequest, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { ledgerDenied, useCustomerLedgerWrite } from '../customer-quality/customer-ledger-write';
import { getSupplierWorkflowBindings, getWorkflow, getWorkflows, getWorkflowVersion, type WorkflowDefinition } from './workflow-api';

type Binding = components['schemas']['SupplierWorkflowBindingDto'];
type Permissions = components['schemas']['PermissionsResponseDto'];
type Attempt = { path: string; body: components['schemas']['SetSupplierWorkflowBindingDto'] | components['schemas']['ActivateSupplierWorkflowBindingDto'] };
const base = '/api/v1/supplier-quality/workflow-bindings';
const severities: { value: Binding['severity']; label: string }[] = [{ value: 'LOW', label: '低' }, { value: 'MEDIUM', label: '中' }, { value: 'HIGH', label: '高' }, { value: 'CRITICAL', label: '重大' }];
const fullSelector = (row: Binding, severity: Binding['severity']) => row.severity === severity && row.responseForm === 'EIGHT_D' && row.replyMode === 'SUPPLIER';

function eligible(flow: WorkflowDefinition, organizationId: string) {
  if (flow.organizationId !== organizationId || flow.version.status !== 'PUBLISHED') return false;
  const nodes = flow.version.structureSnapshot.nodes;
  const owners = nodes.filter(node => node.config?.supplierEightD);
  const reviews = nodes.filter(node => node.config?.closureReview);
  const owner = owners[0]; const config = owner?.config; const marker = config?.supplierEightD;
  const hours = marker?.reminderEveryHours;
  return owners.length === 1 && owner.type === 'ACTION' && config?.isStart === true && !config.isEnd
    && marker?.schemaVersion === 1 && (hours === null || (Number.isInteger(hours) && hours! >= 1 && hours! <= 8760))
    && config.assignment?.permission === 'supplier-quality:responses:write' && !config.assignment.roleCode && !config.assignment.assigneeUserId
    && config.slaMinutes == null && !config.reminders?.length && !config.escalation
    && nodes.filter(node => node.config?.isStart).length === 1 && !nodes.some(node => node.config?.processEightD)
    && reviews.length === 1 && reviews[0].type === 'APPROVAL' && !reviews[0].config?.isStart && !reviews[0].config?.isEnd
    && reviews[0].config?.closureReview?.schemaVersion === 1 && reviews[0].config.closureReview.policy === 'SUPPLIER' && reviews[0].config.closureReview.domainCode === 'supplier-quality';
}

export function SupplierEightDBinding() {
  const session = useWorkTabsStore(state => state.sessionScope);
  const { t } = useLanguage();
  const [deniedScope, setDeniedScope] = useState<string>();
  if (deniedScope === (session ?? '')) return <Alert type="error" title={t('供应商配置访问失效，敏感内容已清除。')} />;
  return <BindingScope key={session ?? ''} session={session} onDenied={() => setDeniedScope(session ?? '')} />;
}

function BindingScope({ session, onDenied }: { session?: string; onDenied: () => void }) {
  const { t } = useLanguage();
  const leave = useNavigationGuard();
  const [permissions, setPermissions] = useState<Permissions>();
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [candidates, setCandidates] = useState<WorkflowDefinition[]>([]);
  const [severity, setSeverity] = useState<Binding['severity']>('LOW');
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [readFailed, setReadFailed] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<unknown>();
  const [attempt, setAttempt] = useState<Attempt>();
  const lifetime = useRef<AbortController>(undefined);
  const lock = useRef(false);
  const preserve = useRef(false);
  const current = () => !!lifetime.current && !lifetime.current.signal.aborted && session === useWorkTabsStore.getState().sessionScope;
  function report(cause: unknown) {
    if (ledgerDenied(cause)) { lifetime.current?.abort(); onDenied(); }
    else setError(cause);
  }
  const writer = useCustomerLedgerWrite(report);
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    const unsubscribe = useWorkTabsStore.subscribe(state => { if (state.sessionScope !== session) controller.abort(); });
    return () => { controller.abort(); unsubscribe(); };
  }, [session]);
  useEffect(() => {
    const controller = new AbortController();
    const lifetimeSignal = lifetime.current!.signal;
    const abort = () => controller.abort();
    lifetimeSignal.addEventListener('abort', abort, { once: true });
    const signal = controller.signal;
    const active = () => current() && !signal.aborted;
    setLoading(true); setReadFailed(false); setError(undefined);
    async function load() {
      try {
        const access = await apiRequest<Permissions>('/api/v1/system/my-permissions', { signal });
        if (!active()) return;
        if (!Array.isArray(access.permissions)) throw new Error('Invalid permission response');
        setPermissions(access);
        if (!access.permissions.includes('configuration:read')) return;
        const saved = await getSupplierWorkflowBindings(signal);
        if (!active()) return;
        if (!Array.isArray(saved.items)) throw new Error('Invalid supplier binding response');
        const options: WorkflowDefinition[] = [];
        if (access.permissions.includes('workflow:manage')) {
          for (let offset = 0; ; offset += 100) {
            const page = await getWorkflows(new URLSearchParams({ pageSize: '100', offset: String(offset) }), signal);
            if (!active()) return;
            for (const item of page.items) {
              const history = await getWorkflow(item.id, signal);
              if (!active()) return;
              if (history.organizationId !== access.organizationId || history.id !== item.id) continue;
              for (const summary of history.versions) {
                if (summary.status !== 'PUBLISHED') continue;
                const flow = await getWorkflowVersion(history.id, summary.id, signal);
                if (!active()) return;
                if (flow.id === history.id && flow.version.id === summary.id && eligible(flow, access.organizationId)) options.push(flow);
              }
            }
            if (offset + page.items.length >= page.total) break;
            if (!page.items.length || offset >= 10000) throw new Error('Incomplete workflow list');
          }
        }
        if (!active()) return;
        if (saved.items.some(row => row.organizationId !== access.organizationId)) throw new ApiError({ code: 'ORGANIZATION_SCOPE_DENIED', message: '' }, 403);
        setBindings(saved.items); setCandidates(options);
        if (!preserve.current) setSelected(saved.items.find(row => fullSelector(row, severity))?.workflowVersionId ?? '');
        preserve.current = false; setConflict(false);
      } catch (cause) { if (active()) { setReadFailed(true); report(cause); } }
      finally { if (active()) setLoading(false); }
    }
    void load();
    return () => { controller.abort(); lifetimeSignal.removeEventListener('abort', abort); };
  }, [revision, session]);
  const binding = bindings.find(row => fullSelector(row, severity));
  const legacy = !!binding && binding.controlledEightD !== true;
  const candidate = candidates.find(flow => flow.version.id === selected);
  const dirty = selected !== (binding?.workflowVersionId ?? '');
  const canManage = permissions?.permissions.includes('configuration:read') && permissions.permissions.includes('configuration:manage') && permissions.permissions.includes('workflow:manage');
  const locked = loading || readFailed || conflict || !canManage || legacy || writer.busy || writer.uncertain;
  useUnsavedChanges(dirty || writer.uncertain);
  useNavigationBusy(writer.busy || writer.uncertain);
  async function write(activation: boolean, retry?: Attempt) {
    if (!current() || lock.current || (!retry && locked)) return;
    if (!retry && (activation ? !binding || dirty || (!binding.enabled && !candidate) : !candidate)) return;
    const command: Attempt = retry ?? { path: activation ? `${base}/activation` : base, body: activation
      ? { severity, responseForm: 'EIGHT_D', replyMode: 'SUPPLIER', expectedVersion: binding!.version, enabled: !binding!.enabled }
      : { severity, responseForm: 'EIGHT_D', replyMode: 'SUPPLIER', expectedVersion: binding?.version ?? 0, workflowVersionId: selected, enabled: false } };
    lock.current = true; setAttempt(command); setError(undefined);
    try {
      const result = await writer.write<Binding>(command.path, command.body, 'PUT');
      if (!current()) return;
      if (result.organizationId !== permissions!.organizationId || !fullSelector(result, severity)) { report(new ApiError({ code: 'ORGANIZATION_SCOPE_DENIED', message: '' }, 403)); return; }
      setBindings(rows => [...rows.filter(row => !fullSelector(row, severity)), result]); setSelected(result.workflowVersionId); setAttempt(undefined);
    } catch (cause) {
      if (!current()) return;
      report(cause);
      if (cause instanceof ApiError && cause.status === 409) { setConflict(true); writer.discard(); setAttempt(undefined); }
    } finally { lock.current = false; }
  }
  return <Card><Typography.Title level={3}>{t('供应商8D流程绑定与启用')}</Typography.Title>
    <p>{t('仅建设供应商完整门户8D：初始化草稿→设计器校验发布→保存独立禁用绑定→显式启用。这里不会自动发布、迁移或启用。')}</p>
    <p role="note">{t('使用列表顶部“初始化关闭审核模板”，选择 SUPPLIER，领域代码 supplier-quality。草稿不代表生产授权。')}</p>
    {loading && <Spin aria-label={t('正在读取供应商配置')} />}
    {!!error && <Alert type="error" title={t(conflict ? '供应商绑定版本冲突，输入已保留，请重读基线。' : readFailed ? '供应商配置读取失败，请重试。' : safeAccountError(error))} />}
    {permissions && !permissions.permissions.includes('configuration:read') && <Alert type="warning" title={t('当前会话无供应商配置读取权限')} />}
    {permissions?.permissions.includes('configuration:read') && <Space orientation="vertical" style={{ width: '100%', minWidth: 0 }}>
      {!canManage && <Alert type="info" title={t('供应商绑定管理需要配置管理与流程管理权限。')} />}
      <label>{t('供应商绑定风险')}<select aria-label={t('供应商绑定风险')} disabled={loading || writer.busy || writer.uncertain || conflict} value={severity} onChange={event => {
        const next = severities.find(item => item.value === event.target.value)?.value;
        if (next) leave(() => { setSeverity(next); setSelected(bindings.find(row => fullSelector(row, next))?.workflowVersionId ?? ''); });
      }}>{severities.map(item => <option key={item.value} value={item.value}>{t(item.label)}</option>)}</select></label>
      {binding ? <p style={{ overflowWrap: 'anywhere' }}>{t(binding.enabled ? '供应商8D已启用' : '供应商8D未启用')} · {t('配置版本')} {binding.version} · <code>{binding.workflowVersionId}</code></p> : <Alert type="info" title={t('当前风险尚无供应商完整门户8D绑定。')} />}
      {legacy && <Alert type="warning" title={t('旧绑定仅供只读，不自动迁移或启停；请由负责人另行确认迁移。')} />}
      {!loading && !readFailed && canManage && !candidates.length && <Alert type="warning" title={t('没有可选的供应商完整8D已发布流程，请先初始化模板并在设计器校验发布。')} />}
      <label style={{ display: 'grid', minWidth: 0 }}>{t('供应商8D已发布流程版本')}<select style={{ width: '100%', minWidth: 0 }} aria-label={t('供应商8D已发布流程版本')} disabled={locked} value={selected} onChange={event => setSelected(event.target.value)}>
        <option value="">{t('请选择供应商完整8D已发布版本')}</option>
        {selected && !candidate && <option value={selected} disabled>{t('当前绑定版本仅供查看')} · {selected}</option>}
        {candidates.map(flow => <option key={flow.version.id} value={flow.version.id}>{flow.name} · v{flow.version.version} · {flow.version.id}</option>)}
      </select></label>
      {candidate && <Link to={`/console/workflows/${candidate.id}/${candidate.version.id}`}>{t('查看供应商绑定候选流程')}</Link>}
      <Space wrap><Button disabled={locked || !candidate} onClick={() => void write(false)}>{t('保存供应商8D绑定')}</Button>
        <Button disabled={locked || !binding || dirty || (!binding.enabled && !candidate)} onClick={() => void write(true)}>{t(binding?.enabled ? '停用供应商8D' : '启用供应商8D')}</Button></Space>
      {bindings.filter(row => row.controlledEightD !== true || row.replyMode !== 'SUPPLIER' || row.responseForm !== 'EIGHT_D').length > 0 && <details><summary>{t('历史绑定（只读）')}</summary><ul>{bindings.filter(row => row.controlledEightD !== true || row.replyMode !== 'SUPPLIER' || row.responseForm !== 'EIGHT_D').map(row => <li key={row.id} style={{ overflowWrap: 'anywhere' }}>{row.severity} · {row.responseForm} · {row.replyMode} · {row.workflowVersionId} · v{row.version} · {t(row.enabled ? '已启用' : '未启用')}</li>)}</ul></details>}
    </Space>}
    {writer.uncertain && <Alert type="warning" title={t('供应商配置写入结果未确认，仅可重试原请求。')} action={<Button disabled={writer.busy} onClick={() => attempt && void write(false, attempt)}>{t('重试原供应商配置请求')}</Button>} />}
    <Button disabled={loading || writer.busy || writer.uncertain} onClick={() => {
      preserve.current = true; writer.discard(); setRevision(value => value + 1);
    }}>{t('重读供应商配置基线')}</Button>
  </Card>;
}
