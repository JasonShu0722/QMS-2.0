import { Alert, Button, Collapse, Form, Select, Space, Spin, Typography } from 'antd';
import type { components } from '@qms/contracts';
import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { ApiError, apiRequest, csrfToken, safeAccountError } from '../api/client';
import { ProcessEightDBinding, type EightDBindingDomain } from '../features/workflows/ProcessEightDBinding';
import { SupplierEightDBinding } from '../features/workflows/SupplierEightDBinding';
import { useLanguage } from '../i18n/Language';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';
import { useConsoleContext } from './ConsoleLayout';
import '../features/workflows/workflows.css';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const uuidPattern = new RegExp(`^${uuid}$`, 'i');
const ledgerEndpoint = '/api/v1/process-quality/ledger-workflow-configuration';
const eightDEndpoint = '/api/v1/process-quality/eight-d-workflow-configuration';
type LedgerConfiguration = components['schemas']['ProcessLedgerWorkflowConfigurationDto'];
type LedgerUpdate = components['schemas']['UpdateProcessLedgerWorkflowConfigurationDto'];
type EightDConfiguration = components['schemas']['ProcessEightDWorkflowConfigurationDto'];
type EightDUpdate = components['schemas']['UpdateProcessEightDWorkflowConfigurationDto'];
type PositionSelection<Key extends string> = { key: Key; positionIds: string[] };
type EditorConfiguration<Key extends string> = Pick<LedgerConfiguration, 'version' | 'positions'> & {
  selections: PositionSelection<Key>[];
  missing?: readonly Key[];
};
type WorkflowEditor<Key extends string> = {
  endpoint: string;
  labels: readonly (readonly [Key, string, string])[];
  read: (init: RequestInit) => Promise<EditorConfiguration<Key>>;
  body: (expectedVersion: number, selections: PositionSelection<Key>[]) => LedgerUpdate | EightDUpdate;
};

const ledgerEditor: WorkflowEditor<LedgerUpdate['boards'][number]['board']> = {
  endpoint: ledgerEndpoint,
  labels: [
    ['REGISTRATION', '表单登记', 'Registration'],
    ['ANALYSIS', '分析进度维护', 'Analysis progress'],
    ['RESPONSIBILITY', '责任判定', 'Responsibility assessment'],
    ['DISPOSITION', '处置维护', 'Disposition'],
    ['CLOSURE', '台账关闭判定', 'Ledger closure'],
  ],
  async read(init) {
    const { version, positions, boards } = await apiRequest<LedgerConfiguration>(ledgerEndpoint, init, init.method === 'PUT' ? { replayAfterReauthentication: false } : undefined);
    return { version, positions, selections: boards.map(({ board, positionIds }) => ({ key: board, positionIds })) };
  },
  body: (expectedVersion, selections) => ({ expectedVersion, boards: selections.map(({ key, positionIds }) => ({ board: key, positionIds })) }),
};

const eightDEditor: WorkflowEditor<EightDUpdate['stages'][number]['stage']> = {
  endpoint: eightDEndpoint,
  labels: [
    ['ISSUE', '发单', 'Issue'],
    ['ANALYSIS', '分析与对策', 'Analysis and countermeasures'],
    ['IMPLEMENTATION', '实施与验证', 'Implementation and verification'],
    ['CLOSURE', '关闭审核', 'Closure review'],
  ],
  async read(init) {
    const { version, positions, stages, missingStages } = await apiRequest<EightDConfiguration>(eightDEndpoint, init, init.method === 'PUT' ? { replayAfterReauthentication: false } : undefined);
    return { version, positions, selections: stages.map(({ stage, positionIds }) => ({ key: stage, positionIds })), missing: missingStages };
  },
  body: (expectedVersion, selections) => ({ expectedVersion, stages: selections.map(({ key, positionIds }) => ({ stage: key, positionIds })) }),
};

export function ConsoleWorkflowPage() {
  const { locale } = useLanguage();
  return <WorkflowScope path="/console/workflows">{session => <Collapse items={[{
    key: 'process-ledger', label: locale === 'en-US' ? 'Process defect ledger' : '制程不合格台账',
    children: <WorkflowPositionConfiguration session={session} editor={ledgerEditor} />,
  }, {
    key: 'process-eight-d', label: locale === 'en-US' ? 'Internal Process 8D' : '制程内部 8D',
    children: <WorkflowPositionConfiguration session={session} editor={eightDEditor} />,
  }]} />}</WorkflowScope>;
}

export function ConsoleEightDBindingsPage() {
  const [domain, setDomain] = useState<EightDBindingDomain>('customer-quality');
  return <WorkflowScope path="/console/eight-d-bindings">{() => <section className="workflow-bindings">
    <ProcessEightDBinding domain={domain} onDomainChange={setDomain} allowedDomains={['customer-quality', 'new-product-quality']} />
    <SupplierEightDBinding />
  </section>}</WorkflowScope>;
}

function WorkflowScope({ path, children }: { path: string; children: (session: string) => ReactNode }) {
  const { context } = useConsoleContext();
  const session = useWorkTabsStore(state => state.sessionScope);
  const location = useLocation();
  const { t } = useLanguage();
  const module = context.modules.find(item => item.key === 'workflows');
  const home = context.actor.homeOrganization.id;
  if (!module?.permissions.includes('workflow:manage') || module.scope !== 'SESSION_HOME' || module.coverage !== 'ORGANIZATION'
    || module.organizationId !== home || session !== `INTERNAL:${home}:${context.actor.id}`) {
    return <Alert type="warning" showIcon role="alert" title={t('无权访问此管理模块')} />;
  }
  const query = new URLSearchParams(location.search);
  const target = query.get('organizationId');
  if (location.pathname !== path || /%(?![0-9a-f]{2})/i.test(location.search)
    || [...query.keys()].some(key => key !== 'organizationId') || query.getAll('organizationId').length > 1
    || target !== null && (!uuidPattern.test(target) || target.toLowerCase() !== context.targetOrganization.id.toLowerCase())) {
    return <Alert type="error" showIcon role="alert" title={t('管理定位无效：链接无效或与当前管理范围不匹配。')} />;
  }
  return <Fragment key={session}>{children(session)}</Fragment>;
}

function WorkflowPositionConfiguration<Key extends string>({ session, editor }: { session: string; editor: WorkflowEditor<Key> }) {
  const { context, invalidate } = useConsoleContext();
  const { locale, t } = useLanguage();
  const text = (zh: string, en: string) => locale === 'en-US' ? en : zh;
  const fieldId = useId();
  const [configuration, setConfiguration] = useState<EditorConfiguration<Key>>();
  const [changes, setChanges] = useState<Partial<Record<Key, string[]>>>({});
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [reloadRequired, setReloadRequired] = useState(false);
  const [error, setError] = useState<unknown>();
  const lifetime = useRef<AbortController>(undefined);
  const writeLock = useRef(false);
  const leave = useNavigationGuard();
  const dirty = Object.keys(changes).length > 0;
  const positions = configuration?.positions.map(position => ({ value: position.id, label: position.name })) ?? [];
  const available = new Set(positions.map(position => position.value));
  const ledger = editor.endpoint === ledgerEndpoint;
  const selections = editor.labels.map(([key]) => ({ key, positionIds: changes[key] ?? configuration?.selections.find(item => item.key === key)?.positionIds ?? [] }));
  const missing = editor.labels.filter(([key]) => configuration?.missing?.includes(key)).map(([, zh, en]) => text(zh, en));
  const hasInactivePositions = selections.some(({ positionIds }) => positionIds.some(id => !available.has(id)));
  const canSave = !hasInactivePositions && (configuration?.version === 0 || dirty);
  useUnsavedChanges(dirty);
  useNavigationBusy(busy);

  function report(cause: unknown) {
    if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
      lifetime.current?.abort();
      setConfiguration(undefined);
      setChanges({});
      setBusy(false);
      setDenied(true);
      invalidate();
    } else setError(cause);
  }

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    const unsubscribe = useWorkTabsStore.subscribe((next, previous) => {
      if (next.sessionScope !== previous.sessionScope) controller.abort();
    });
    setLoading(true);
    setError(undefined);
    void editor.read({ signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      setConfiguration(result);
      setChanges({});
      setReloadRequired(false);
    }).catch(cause => {
      if (!controller.signal.aborted) report(cause);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => { controller.abort(); unsubscribe(); };
  }, [editor, revision, session]);

  async function save() {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || writeLock.current || loading || reloadRequired || !configuration || !canSave) return;
    const body = editor.body(configuration.version, selections);
    writeLock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const token = await csrfToken(signal);
      signal.throwIfAborted();
      const saved = await editor.read({
        method: 'PUT', signal, headers: { 'x-csrf-token': token, 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body),
      });
      if (signal.aborted) return;
      setConfiguration(saved);
      setChanges({});
    } catch (cause) {
      if (signal.aborted) return;
      report(cause);
      if (!(cause instanceof ApiError) || !cause.status || cause.code === 'CLIENT_REAUTHENTICATION_COMPLETED' || [408, 409, 425].includes(cause.status) || cause.status >= 500) setReloadRequired(true);
    } finally {
      writeLock.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }

  if (denied) return <Alert type="warning" role="alert" title={t('无权访问此管理模块')} />;
  const locked = loading || busy || reloadRequired;
  return <Form layout="vertical" onFinish={() => void save()} style={{ maxWidth: 640 }}>
    <Space wrap style={{ marginBottom: 16 }}>
      <Typography.Text type="secondary">{text('会话组织', 'Session organization')}</Typography.Text>
      <Typography.Text>{context.actor.homeOrganization.name}</Typography.Text>
    </Space>
    {error != null && <Alert type="error" showIcon role="alert" style={{ marginBottom: 16 }}
      title={reloadRequired
        ? error instanceof ApiError && error.status === 409
          ? text('配置版本已变化，请重新读取配置。', 'The configuration has changed. Reload to continue.')
          : text('配置保存结果未确认，请重新读取配置。', 'The save result could not be confirmed. Reload to continue.')
        : t(safeAccountError(error))}
      action={(reloadRequired || !configuration) && <Button disabled={loading} onClick={() => leave(() => setRevision(value => value + 1))}>{text('重新读取配置', 'Reload configuration')}</Button>} />}
    {loading && <Spin aria-label={text('正在读取配置', 'Loading configuration')} />}
    {configuration && <>
      {ledger && <Typography.Paragraph>
        {configuration.version === 0 && text('首次保存前，台账沿用现有业务权限。', 'Until the first save, existing ledger permissions apply. ')}
        {text('可为每个板块选择多个岗位。保存后，未选择岗位的板块无法维护。', 'Select multiple positions per board. After saving, boards with no positions cannot be maintained.')}
      </Typography.Paragraph>}
      {missing.length > 0 && <Alert type="warning" showIcon style={{ marginBottom: 16 }}
        title={text(`缺少有效岗位，无法发单：${missing.join('、')}`, `Issue is unavailable until active positions are configured for: ${missing.join(', ')}`)} />}
      {hasInactivePositions && <Alert type="warning" showIcon style={{ marginBottom: 16 }} title={text('请移除已失效的岗位后再保存。', 'Remove inactive positions before saving.')} />}
      {editor.labels.map(([board, zh, en]) => {
        const label = text(zh, en);
        const id = `${fieldId}-${board}`;
        const saved = configuration.selections.find(item => item.key === board)?.positionIds ?? [];
        return <Form.Item key={board} label={label} htmlFor={id}
          extra={ledger && board === 'RESPONSIBILITY' && text('同时适用于物料登记和 SQE 指派。', 'Also applies to material registration and SQE assignment.')}>
          <Select id={id} aria-label={label} mode="multiple" allowClear disabled={locked} style={{ maxWidth: '100%' }}
            placeholder={text('选择岗位', 'Select positions')}
            value={changes[board] ?? saved}
            options={positions}
            labelRender={({ label: positionLabel, value }) => positionLabel ?? `${text('已失效岗位', 'Inactive position')} · ${value}`}
            showSearch={{ optionFilterProp: 'label' }}
            onChange={(positionIds: string[]) => setChanges(current => {
              const next = { ...current, [board]: positionIds };
              if (positionIds.length === saved.length && positionIds.every(id => saved.includes(id))) delete next[board];
              return next;
            })} />
        </Form.Item>;
      })}
      <Button htmlType="submit" type="primary" loading={busy} disabled={locked || !canSave}>{text('保存配置', 'Save configuration')}</Button>
    </>}
  </Form>;
}
