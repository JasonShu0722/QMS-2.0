import { useEffect, useId, useRef, useState } from 'react';
import { Alert, Button, Descriptions, Empty, Form, Select, Space, Spin, Table, Typography } from 'antd';
import type { components, operations } from '@qms/contracts';
import type { AdminOrganization } from '../admin/admin';
import { ApiError, apiRequest, createAdminMutation } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { GovernanceFeedback } from './GovernanceFeedback';
import './AdministrativeProblemReconfiguration.css';

type Props = { organization: AdminOrganization; onChanged?: () => void; onDenied?: (error: ApiError) => void };
type Internal = components['schemas']['InternalEightDAdministrativePendingItemDto'];
type Supplier = components['schemas']['SupplierEightDAdministrativeItemDto'];
type Item = Internal | Supplier;
type Page = components['schemas']['InternalEightDAdministrativePendingPageDto'] | components['schemas']['SupplierEightDAdministrativePageDto'];
type Body = components['schemas']['AdministrativeProblemReconfigureDto'];
type Result = components['schemas']['InternalEightDAdministrativeResultDto'] | components['schemas']['SupplierEightDAdministrativeResultDto'];
type Assignment = components['schemas']['AdministrativeProblemAssignmentDto'];
type AssignmentPage = components['schemas']['AdministrativeProblemAssignmentPageDto'];
type Duty = operations['AdministrativeProblemReconfigurationController_assignments']['parameters']['query']['duty'];
type Field = Exclude<keyof Body, 'expectedVersion'>;
const domains = { PROCESS: '制程质量', CUSTOMER: '客户质量', NEW_PRODUCT: '新产品质量', SUPPLIER: '供应商质量' };
type Domain = keyof typeof domains;
const domainCodes = { PROCESS: 'process-quality', CUSTOMER: 'customer-quality', NEW_PRODUCT: 'new-product-quality' };
const pageSize = 20;
const path = (domain: Domain) => `/api/v1/admin/problem-reconfiguration/${domain}`;
const itemId = (item: Item | Result) => 'supplierProblemId' in item ? item.supplierProblemId : item.problemId;
const fields: { field: Field; duty: Duty; label: string }[] = [
  { field: 'professionalAssignmentId', duty: 'PROFESSIONAL', label: '专业责任任职' },
  { field: 'ownerAssignmentId', duty: 'OWNER', label: '负责人任职' },
  { field: 'sqeAssignmentId', duty: 'PROFESSIONAL', label: 'SQE 任职' },
  { field: 'internalResponderAssignmentId', duty: 'RESPONDER', label: '内部答复人任职' },
];

export function isCompleteResponsibilityRecoveryReceipt(result: Result, item: Item, body: Body,
  domain: operations['AdministrativeProblemReconfigurationController_reconfigure']['parameters']['path']['domain']): boolean {
  return !(!result || itemId(result) !== itemId(item) || result.problemId !== item.problemId || result.originalOrganizationId !== item.originalOrganizationId ||
    !Number.isInteger(result.version) || result.version <= body.expectedVersion || !Number.isFinite(result.problemVersion) ||
    ![result.reportNumber, result.responsibleSectionDepartmentId].every(value => typeof value === 'string' && value.trim().length > 0) ||
    (domain === 'SUPPLIER' ? !('supplierProblemId' in result) ||
      ![result.sqeUserId, result.sqeAssignmentId, result.status].every(value => typeof value === 'string' && value.trim().length > 0) ||
      (body.sqeAssignmentId !== undefined && result.sqeAssignmentId !== body.sqeAssignmentId) ||
      (result.internalResponderId === null ? body.internalResponderAssignmentId !== undefined : typeof result.internalResponderId !== 'string' || !result.internalResponderId.trim())
      : !('domainCode' in result) || result.domainCode !== domainCodes[domain as keyof typeof domainCodes] || result.status !== 'PROCESSING' ||
      typeof result.professionalUserId !== 'string' || !result.professionalUserId.trim() ||
      (result.ownerUserId === null ? body.ownerAssignmentId !== undefined : typeof result.ownerUserId !== 'string' || !result.ownerUserId.trim())));
}

export function AdministrativeProblemReconfiguration(props: Props) {
  const principal = useWorkTabsStore(state => state.sessionScope);
  const { t } = useLanguage();
  if (props.organization.type !== 'INTERNAL' || !props.organization.permissions.includes('organization:reconfigure')) {
    return <Alert type="warning" showIcon title={t('无责任恢复管理权限')} />;
  }
  return <ProblemReconfigurationScope key={JSON.stringify([principal, props.organization.id, [...props.organization.permissions].sort()])} {...props} />;
}

function ProblemReconfigurationScope({ onChanged, onDenied }: Props) {
  const { t } = useLanguage();
  const requestLeave = useNavigationGuard();
  const [principal] = useState(() => useWorkTabsStore.getState().sessionScope);
  const [domain, setDomain] = useState<Domain>('PROCESS');
  const [offsets, setOffsets] = useState([0]);
  const offset = offsets[offsets.length - 1];
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<Page>();
  const [selected, setSelected] = useState<Item>();
  const [choices, setChoices] = useState<Partial<Body>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [conflict, setConflict] = useState<'version' | 'receipt'>();
  const [error, setError] = useState<unknown>();
  const [success, setSuccess] = useState(false);
  const [denied, setDenied] = useState(false);
  const alive = useRef(false);
  const invalid = useRef(false);
  const lifetime = useRef<AbortController | undefined>(undefined);
  const pending = useRef(false);
  const attempt = useRef<{ path: string; body: Body; item: Item; domain: Domain } | undefined>(undefined);
  const mutate = useRef(createAdminMutation({ replayAfterReauthentication: false }));
  const callbacks = useRef({ onChanged, onDenied }); callbacks.current = { onChanged, onDenied };
  const current = () => alive.current && !invalid.current && principal === useWorkTabsStore.getState().sessionScope;
  const dirty = Object.keys(choices).length > 0;
  useUnsavedChanges(dirty || unknown);
  useNavigationBusy(busy);

  function clearSensitive() {
    attempt.current = undefined; mutate.current = createAdminMutation({ replayAfterReauthentication: false });
    setPage(undefined); setSelected(undefined); setChoices({}); setError(undefined); setSuccess(false);
    setUnknown(false); setConflict(undefined); setBusy(false); setLoading(false); setDenied(true);
  }
  useEffect(() => {
    alive.current = true; lifetime.current = new AbortController();
    const invalidate = () => {
      if (invalid.current) return;
      // Store subscriptions observe A -> B -> A even when React batches the render.
      invalid.current = true; lifetime.current?.abort(); clearSensitive();
    };
    const unsubscribe = useWorkTabsStore.subscribe(state => { if (state.sessionScope !== principal) invalidate(); });
    if (principal !== useWorkTabsStore.getState().sessionScope) invalidate();
    return () => { alive.current = false; lifetime.current?.abort(); attempt.current = undefined; unsubscribe(); };
  }, [principal]);

  function fail(cause: unknown) {
    if (!current()) return;
    if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
      invalid.current = true; lifetime.current?.abort(); clearSensitive(); callbacks.current.onDenied?.(cause);
    } else setError(cause);
  }
  useEffect(() => {
    if (!current()) return;
    let active = true;
    const controller = new AbortController();
    const abort = () => controller.abort();
    lifetime.current?.signal.addEventListener('abort', abort);
    setLoading(true); setPage(undefined); setError(undefined);
    void apiRequest<Page>(`${path(domain)}?offset=${offset}&pageSize=${pageSize}`, { signal: controller.signal })
      .then(result => { if (active && current()) setPage(result); })
      .catch(cause => { if (active && current()) fail(cause); })
      .finally(() => { if (active && current()) setLoading(false); });
    return () => { active = false; controller.abort(); lifetime.current?.signal.removeEventListener('abort', abort); };
  }, [domain, offset, revision]);

  const supplier = selected && 'supplierProblemId' in selected;
  const requirements: readonly string[] = selected?.requiredConfiguration ?? [];
  const allowed = domain === 'SUPPLIER' ? ['sqeAssignmentId', 'internalResponderAssignmentId'] : ['professionalAssignmentId', 'ownerAssignmentId'];
  const supported = !!selected && !!requirements.length && (domain === 'SUPPLIER') === !!supplier && requirements.every(field => allowed.includes(field));
  const requiredFields = supported ? fields.filter(entry => requirements.includes(entry.field)) : [];
  const locked = busy || unknown;
  const canSave = supported && !locked && !loading && !conflict && requiredFields.every(entry => !!choices[entry.field]);

  function closeEditor() {
    setSelected(undefined); setChoices({}); setConflict(undefined); setUnknown(false); setError(undefined);
    attempt.current = undefined; mutate.current = createAdminMutation({ replayAfterReauthentication: false });
  }
  function reload() {
    if (!current() || pending.current || unknown) return;
    closeEditor(); setSuccess(false); setRevision(value => value + 1);
  }
  function edit(item: Item) {
    if (!current() || pending.current || unknown) return;
    requestLeave(() => { if (!current()) return; closeEditor(); setSelected(item); setSuccess(false); });
  }
  async function submit(retry = false) {
    if (!current() || pending.current || (retry ? !unknown || !attempt.current : !canSave || !selected)) return;
    if (!retry && selected) {
      const body: Body = { expectedVersion: selected.version };
      for (const entry of requiredFields) body[entry.field] = choices[entry.field];
      if (domain === 'SUPPLIER' && 'supplierProblemId' in selected && !requirements.includes('sqeAssignmentId')) body.sqeAssignmentId = selected.sqeAssignmentId;
      attempt.current = { path: `${path(domain)}/${encodeURIComponent(itemId(selected))}`, body: Object.freeze(body), item: selected, domain };
    }
    const frozen = attempt.current;
    if (!frozen) return;
    pending.current = true; setBusy(true); setError(undefined);
    let received = false;
    let changed = false;
    try {
      const result = await mutate.current<Result>(frozen.path, 'POST', frozen.body, lifetime.current?.signal);
      received = true;
      if (!current()) return;
      if (!isCompleteResponsibilityRecoveryReceipt(result, frozen.item, frozen.body, frozen.domain)) {
        throw new Error('Unexpected responsibility recovery receipt');
      }
      closeEditor(); setSuccess(true); setRevision(value => value + 1); changed = true;
    } catch (cause) {
      if (!current()) return;
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) { fail(cause); return; }
      if (received || cause instanceof ApiError && cause.status === 409) { setUnknown(false); setConflict(received ? 'receipt' : 'version'); }
      else {
        const unresolved = retry || !(cause instanceof ApiError) || !cause.status || cause.status >= 500 || cause.status === 408;
        setUnknown(unresolved);
        if (!unresolved) attempt.current = undefined;
      }
      fail(cause);
    } finally { pending.current = false; if (current()) setBusy(false); }
    if (changed && current()) callbacks.current.onChanged?.();
  }

  if (denied) return <Alert type="error" showIcon title={t('管理权限、会话或范围已变化，已清除问题责任内容')} />;
  return <section className="administrative-problem-reconfiguration" aria-label={t('问题责任恢复')}>
    <Typography.Title level={5}>{t('问题责任恢复')}</Typography.Title>
    <Alert type="info" showIcon title={t('仅恢复失效的当前责任，不代替业务人员审批；原业务归属和已批准历史保持不变。')} description={t('恢复后由真实责任人继续办理并重新提交，不自动批准、关闭或迁移历史业务。')} />
    <Space wrap>
      <Select aria-label={t('问题领域')} value={domain} disabled={locked} options={Object.entries(domains).map(([value, label]) => ({ value, label: t(label) }))}
        onChange={value => requestLeave(() => { if (!current()) return; closeEditor(); setDomain(value); setOffsets([0]); setSuccess(false); })} />
      <Button disabled={locked || loading} onClick={() => requestLeave(reload)}>{t('刷新问题责任')}</Button>
    </Space>
    <GovernanceFeedback error={error} />
    {!!error && !selected && <Button disabled={locked || loading} onClick={reload}>{t('重试问题读取')}</Button>}
    {success && <Alert type="success" showIcon title={t('责任恢复成功；仅更新当前责任，历史归属与已批准历史保持不变。')} />}
    {loading ? <div role="status" aria-label={t('读取问题责任')}><Spin /></div> : page && <>
      {!page.items.length ? <Empty description={t('当前扫描窗口无待配置问题')} /> : <Table<Item> rowKey={itemId} size="small" dataSource={page.items} pagination={false} scroll={{ x: 620 }} columns={[
        { key: 'report', title: t('原报告编号'), width: 190, render: (_, item) => item.reportNumber },
        { key: 'scope', title: t('原归属（历史范围）'), width: 240, render: (_, item) => item.originalOrganizationId },
        { key: 'action', title: t('操作'), width: 160, render: (_, item) => <Button disabled={locked} aria-label={`${t('恢复责任')} · ${item.reportNumber}`} onClick={() => edit(item)}>{t('恢复责任')}</Button> },
      ]} />}
      <Space wrap>
        <Button disabled={locked || offsets.length < 2} onClick={() => requestLeave(() => { if (!current()) return; closeEditor(); setOffsets(value => value.slice(0, -1)); })}>{t('上一扫描页')}</Button>
        <Typography.Text type="secondary">{t('扫描窗口')} {offset}</Typography.Text>
        <Button disabled={locked || page.nextOffset === null || !Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset} onClick={() => requestLeave(() => { if (!current() || page.nextOffset === null) return; closeEditor(); setOffsets(value => [...value, page.nextOffset!]); })}>{t('下一扫描页')}</Button>
      </Space>
    </>}
    {selected && <section className="administrative-problem-reconfiguration-editor" aria-label={`${t('恢复责任')} · ${selected.reportNumber}`}>
      <Typography.Title level={5}>{t('恢复责任')} · {selected.reportNumber}</Typography.Title>
      <Descriptions size="small" column={1} items={[
        { key: 'report', label: t('原报告编号'), children: selected.reportNumber },
        { key: 'scope', label: t('原归属（历史范围）'), children: selected.originalOrganizationId },
        { key: 'version', label: t('当前版本'), children: selected.version },
      ]} />
      <p>{t('只选择当前失效职责的有效任职；仍有效的责任不覆盖，不授予额外业务权限。')}</p>
      {!supported && <Alert type="warning" showIcon title={t('配置要求暂不支持，请刷新并核对服务端版本。')} />}
      <Form layout="vertical" onFinish={() => void submit()}>
        {requiredFields.map(entry => <AssignmentPicker key={`${domain}:${itemId(selected)}:${entry.field}`} domain={domain} organizationId={selected.originalOrganizationId} duty={entry.duty} label={entry.label} disabled={locked || !!conflict} signal={lifetime.current?.signal} isCurrent={current} onDenied={fail}
          onChange={assignment => { if (current() && !pending.current && !unknown && !conflict) setChoices(value => ({ ...value, [entry.field]: assignment.assignmentId })); }} />)}
        {conflict && <Alert type="warning" showIcon title={t(conflict === 'receipt' ? '响应无法核对，草稿已保留；请重新读取核对，不创建新请求重放。' : '版本已变化，草稿已保留；请显式重新读取并重选责任，不自动沿用旧基线。')} />}
        {unknown && <Alert type="warning" showIcon title={t('结果尚未确认，原请求与幂等键已冻结；仅可显式重试原责任恢复请求。')} />}
        <Space wrap>
          <Button type="primary" htmlType="submit" disabled={!canSave} loading={busy}>{t('确认恢复责任')}</Button>
          {unknown && <Button disabled={busy} onClick={() => void submit(true)}>{t('重试原责任恢复请求')}</Button>}
          {conflict && <Button disabled={locked || loading} onClick={() => requestLeave(reload)}>{t('重新读取并重选责任')}</Button>}
          <Button disabled={locked} onClick={() => requestLeave(() => { if (current()) closeEditor(); })}>{t('关闭编辑')}</Button>
        </Space>
      </Form>
    </section>}
  </section>;
}

function AssignmentPicker({ domain, organizationId, duty, label, disabled, signal, isCurrent, onDenied, onChange }: {
  domain: Domain; organizationId: string; duty: Duty; label: string; disabled: boolean; signal?: AbortSignal;
  isCurrent: () => boolean; onDenied: (error: ApiError) => void; onChange: (assignment: Assignment) => void;
}) {
  const { t } = useLanguage();
  const id = useId();
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<AssignmentPage>();
  const [selected, setSelected] = useState<Assignment>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const callbacks = useRef({ isCurrent, onDenied, onChange }); callbacks.current = { isCurrent, onDenied, onChange };
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort);
    if (signal?.aborted || !callbacks.current.isCurrent()) { controller.abort(); return; }
    setLoading(true); setPage(undefined); setError(undefined);
    const query = new URLSearchParams({ organizationId, duty, search, pageSize: String(pageSize), offset: String(offset) });
    void apiRequest<AssignmentPage>(`${path(domain)}/assignments?${query}`, { signal: controller.signal })
      .then(result => { if (active && callbacks.current.isCurrent()) setPage(result); })
      .catch(cause => {
        if (!active || !callbacks.current.isCurrent()) return;
        if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) callbacks.current.onDenied(cause);
        else setError(cause);
      }).finally(() => { if (active && callbacks.current.isCurrent()) setLoading(false); });
    return () => { active = false; controller.abort(); signal?.removeEventListener('abort', abort); };
  }, [domain, organizationId, duty, search, offset, revision, signal]);
  const options = [...(selected ? [selected] : []), ...(page?.items.filter(item => item.assignmentId !== selected?.assignmentId) ?? [])];
  return <Form.Item label={t(label)} htmlFor={id} required>
    <Select id={id} value={selected?.assignmentId} disabled={disabled} loading={loading} showSearch filterOption={false} searchValue={search}
      notFoundContent={loading ? <Spin size="small" /> : t(error ? '候选读取失败，请重试' : '无有效候选任职')}
      options={options.map(item => ({ value: item.assignmentId, label: `${item.fullName ?? item.username} · ${item.departmentName} · ${item.positionName} · ${item.username}` }))}
      onSearch={value => { setSearch(value); setOffset(0); }}
      onChange={value => { const assignment = options.find(item => item.assignmentId === value); if (assignment && !disabled && callbacks.current.isCurrent()) { setSelected(assignment); callbacks.current.onChange(assignment); } }} />
    <GovernanceFeedback error={error} />
    {!!error && <Button disabled={disabled || loading} onClick={() => setRevision(value => value + 1)}>{t(`重试${label}`)}</Button>}
    <Space wrap className="administrative-problem-reconfiguration-candidates">
      <Button size="small" aria-label={t(`${label}上一页`)} disabled={disabled || loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - pageSize))}>{t('上一页')}</Button>
      <Button size="small" aria-label={t(`${label}下一页`)} disabled={disabled || loading || !page || offset + pageSize >= page.total} onClick={() => setOffset(value => value + pageSize)}>{t('下一页')}</Button>
    </Space>
  </Form.Item>;
}
