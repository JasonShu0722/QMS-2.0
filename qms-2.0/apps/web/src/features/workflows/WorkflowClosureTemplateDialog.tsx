import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal, Space, Spin } from 'antd';
import { useNavigate } from 'react-router-dom';
import { ApiError, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useCompletedSessionNavigation, useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { createWorkflowClosureTemplate, getWorkflowClosureTemplates, unknownWorkflowWrite, type WorkflowClosureTemplateInput, type WorkflowDefinition } from './workflow-api';

type Props = { onClose: () => void; onCreated: (result: WorkflowDefinition) => void; onBusyChange?: (busy: boolean) => void };
type Attempt = { body: WorkflowClosureTemplateInput; key: string };
const english: Record<string, string> = {
  '初始化关闭审核模板': 'Initialize closure review template', '模板策略': 'Template policy', '请选择模板策略': 'Choose a template policy',
  '模板领域代码': 'Template domain code', '模板流程代码': 'Template workflow code', '模板流程名称': 'Template workflow name', '创建模板草稿': 'Create template draft',
  '仅初始化草稿，不自动发布或绑定；不写入具体人员或岗位 UUID。': 'Creates a draft only. No automatic publication or binding; no specific user or position UUIDs.',
  '发布时校验对应领域是否已接入；创建候选草稿不会自动发布、绑定或启用。': 'Publishing checks whether the domain is integrated. Creating a candidate draft does not publish, bind or enable it.',
  '结果尚未确认，输入已冻结，请使用原请求重试。': 'The result is unknown. Inputs are frozen; retry the original request.',
  '重试原请求': 'Retry original request', '重试加载模板': 'Retry loading templates',
  '内部问题关闭审核': 'Internal problem closure review', '供应商问题关闭审核': 'Supplier problem closure review',
};

export function WorkflowClosureTemplateDialog(props: Props) {
  const session = useWorkTabsStore(state => state.sessionScope);
  return <TemplateScope key={session ?? ''} {...props} />;
}

function TemplateScope({ onClose, onCreated, onBusyChange }: Props) {
  const { t: translate, locale } = useLanguage();
  const t = (text: string) => locale === 'en-US' ? english[text] ?? translate(text) : translate(text);
  const navigate = useNavigate();
  const completeSessionNavigation = useCompletedSessionNavigation();
  const leave = useNavigationGuard();
  const [session] = useState(() => useWorkTabsStore.getState().sessionScope);
  const [options, setOptions] = useState<Awaited<ReturnType<typeof getWorkflowClosureTemplates>>>();
  const [values, setValues] = useState({ policy: '', domainCode: '', code: '', name: '' });
  const [error, setError] = useState<unknown>();
  const [readError, setReadError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);
  const [denied, setDenied] = useState(false);
  const [uncertain, setUncertain] = useState<Attempt>();
  const [created, setCreated] = useState<WorkflowDefinition>();
  const lock = useRef(false);
  const ending = useRef(false);
  const lifetime = useRef<AbortController | undefined>(undefined);
  const pending = useRef<Attempt | undefined>(undefined);
  const current = () => !ending.current && !!lifetime.current && !lifetime.current.signal.aborted && session === useWorkTabsStore.getState().sessionScope;
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    // Abort synchronously on session change, including while CSRF is awaiting a response.
    const unsubscribe = useWorkTabsStore.subscribe(state => { if (state.sessionScope !== session) controller.abort(); });
    return () => { controller.abort(); unsubscribe(); };
  }, [session]);
  function report(cause: unknown) {
    if (!current()) return;
    if (cause instanceof ApiError && (cause.status === 401 || cause.code === 'AUTH_SESSION_REQUIRED')) {
      ending.current = true; lifetime.current?.abort(); setBusy(false); setUnauthorized(true);
    } else {
      setError(cause);
      if (cause instanceof ApiError && (cause.status === 403 || ['FEATURE_PERMISSION_DENIED', 'ORGANIZATION_SCOPE_DENIED'].includes(cause.code))) setDenied(true);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setReadError(undefined);
    getWorkflowClosureTemplates(controller.signal).then(result => { if (current() && !controller.signal.aborted) setOptions(result); })
      .catch(cause => { if (current() && !controller.signal.aborted) { setReadError(cause); report(cause); } })
      .finally(() => { if (current() && !controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  const dirty = !created && (!!uncertain || Object.values(values).some(Boolean));
  useUnsavedChanges(dirty);
  useNavigationBusy(busy);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  useEffect(() => {
    if (!unauthorized || session !== useWorkTabsStore.getState().sessionScope) return;
    // Release this dialog's busy registration before bypassing the parent draft guard.
    completeSessionNavigation(() => { useWorkTabsStore.getState().reset(); navigate('/login', { replace: true }); });
  }, [unauthorized, session, completeSessionNavigation, navigate]);
  useEffect(() => { if (created && !busy && current()) onCreated(created); }, [created, busy, onCreated]);
  function close() { if (!lock.current && current()) leave(() => { if (current()) onClose(); }, true); }
  async function submit() {
    if (lock.current || !current() || denied || created || loading || !options) return;
    const candidate = options.items.find(item => item.policy === values.policy);
    if (!uncertain && (!candidate || !values.domainCode.trim() || !values.code.trim() || !values.name.trim())) return;
    const body = uncertain?.body ?? { policy: candidate!.policy, domainCode: values.domainCode.trim(), code: values.code.trim(), name: values.name.trim() };
    if (!pending.current || JSON.stringify(pending.current.body) !== JSON.stringify(body)) pending.current = { body, key: crypto.randomUUID() };
    const attempt = uncertain ?? pending.current;
    lock.current = true; setBusy(true); setError(undefined);
    try {
      const result = await createWorkflowClosureTemplate(attempt.body, attempt.key, lifetime.current?.signal);
      if (current()) { setUncertain(undefined); pending.current = undefined; setCreated(result); }
    } catch (cause) {
      if (current()) {
        report(cause);
        if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403 || cause.status === 409)) setUncertain(undefined);
        else setUncertain(uncertain || unknownWorkflowWrite(cause) ? attempt : undefined);
      }
    } finally { lock.current = false; if (current()) setBusy(false); }
  }
  const frozen = busy || !!uncertain || denied || !!created;
  const displayed = error ?? readError;
  const valid = !!options?.items.some(item => item.policy === values.policy) && !!values.domainCode.trim() && !!values.code.trim() && !!values.name.trim();
  return <Modal open title={t('初始化关闭审核模板')} onCancel={close} closable={!busy} keyboard={!busy} mask={{ closable: !busy }} footer={null}>


    {!!displayed && <Alert type="error" title={t(displayed instanceof ApiError && displayed.status === 403 ? '无权执行此操作' : safeAccountError(displayed))} description={displayed instanceof ApiError && displayed.traceId ? <code>{displayed.traceId}</code> : undefined} />}
    {loading && <Spin aria-label={t('加载中')} />}
    {!!readError && <Button disabled={loading || denied || busy} onClick={() => { setError(undefined); setRevision(value => value + 1); }}>{t('重试加载模板')}</Button>}
    <form className="workflow-editor" onSubmit={event => { event.preventDefault(); if (!uncertain) void submit(); }}>
      <fieldset disabled={frozen || loading || !options} className="workflow-properties-fields">
        <label>{t('模板策略')}<select aria-label={t('模板策略')} required value={values.policy} onChange={event => setValues({ ...values, policy: event.target.value })}>
          <option value="">{t('请选择模板策略')}</option>{options?.items.map(item => <option key={item.policy} value={item.policy}>{t(item.name)}</option>)}
        </select></label>
        {(['domainCode', 'code', 'name'] as const).map((key, index) => <label key={key}>{t(['模板领域代码', '模板流程代码', '模板流程名称'][index]!)}<input aria-label={t(['模板领域代码', '模板流程代码', '模板流程名称'][index]!)} required maxLength={key === 'name' ? 200 : 100} value={values[key]} onChange={event => setValues({ ...values, [key]: event.target.value })} /></label>)}
      </fieldset>
      {uncertain && <Alert type="warning" title={t('结果尚未确认，输入已冻结，请使用原请求重试。')} action={<Button disabled={busy || denied} onClick={() => void submit()}>{t('重试原请求')}</Button>} />}
      <Space wrap><Button type="primary" htmlType="submit" disabled={frozen || loading || !valid}>{t('创建模板草稿')}</Button><Button aria-label={t('取消')} disabled={busy} onClick={close}>{t('取消')}</Button></Space>
    </form>
  </Modal>;
}
