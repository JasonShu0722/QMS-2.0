import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Alert, Button, Collapse, Descriptions, Input, Modal, Pagination, Select, Space, Table, Typography } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, csrfToken, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useCompletedSessionNavigation, useNavigationBusy } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';

type Preview = components['schemas']['WorkflowClosurePreviewDto'];
type Options = components['schemas']['WorkflowClosureOptionsDto'];
type PreviewInput = components['schemas']['WorkflowClosurePreviewInputDto'];
type Choice = { value: string; label: string };
type Props = { policy: PreviewInput['policy']; disabled?: boolean };
const duties = { PROFESSIONAL: '专业人员', SECTION_MANAGER: '科室经理', MINISTER: '部长', OWNER: '负责人' };
const statuses = { PENDING: '待审', WAITING: '尚未启动', SKIPPED_SAME_PERSON: '同人跳过' };
const issues = {
  PARTICIPANT_NOT_ELIGIBLE: '人员当前不符合资格', STRUCTURE_INACTIVE: '组织或科室已失效',
  BINDING_MISSING: '缺少职责绑定', BINDING_AMBIGUOUS: '存在多个职责绑定',
  ASSIGNMENT_MISSING: '缺少有效任职', ASSIGNMENT_AMBIGUOUS: '存在多个有效任职',
  SCOPE_MISSING: '缺少有效分管', SCOPE_AMBIGUOUS: '存在多个有效分管',
};
const english: Record<string, string> = {
  '关闭职责预览': 'Closure responsibility preview', '打开关闭职责预览': 'Open closure responsibility preview',
  '预览说明': 'About this preview', '只读配置测试，不会发单或审批；目录仅供选择配置测试身份，不代表执行授权。': 'Read-only configuration test. No problem issuance or approval. Directory choices are test identities, not execution authorization.',
  '责任科室': 'Responsible section', '专业人员（配置测试）': 'Professional (configuration test)', '内部负责人（配置测试）': 'Internal owner (configuration test)',
  '严重度': 'Severity', '低': 'Low', '中': 'Medium', '高': 'High', '严重': 'Critical',
  '搜索科室或内部人员': 'Search sections or internal users', '科室': 'Sections', '内部人员': 'Internal users',
  '目录分页': 'Directory pages', '运行配置预览': 'Run configuration preview', '关闭预览': 'Close preview',
  '关闭职责配置测试': 'Closure configuration test',
  '重试配置预览': 'Retry configuration preview', '重试目录': 'Retry directory', '暂无匹配选项': 'No matching options',
  '请先选择责任科室、专业人员及内部负责人（仅内部策略需要）。': 'Choose a section, professional and internal owner (internal policy only).',
  '配置缺项，请维护后重新预览；本页不提供审批。': 'Configuration is incomplete. Maintain it and preview again; this page does not approve.',
  '配置解析完成，不代表执行授权或审批结果。': 'Configuration resolved, not execution authorization or an approval result.',
  '专业人员': 'Professional', '科室经理': 'Section manager', '部长': 'Minister', '负责人': 'Owner',
  '待审': 'Pending', '尚未启动': 'Not started', '同人跳过': 'Skipped: same person',
  '职责': 'Duty', '状态': 'Status', '人员': 'Person', '尚未解析': 'Unresolved',
  '展开来源明细': 'Expand source details', '组织 ID': 'Organization ID', '科室 ID': 'Section ID', '解析时间': 'Resolved at',
  '执行顺序': 'Execution order', '并行审核': 'Parallel review', '专业先审，再启动管理审核': 'Professional first, then management review',
  '用户 ID': 'User ID', '任职 ID': 'Assignment ID', '岗位 ID': 'Position ID', '部门 ID': 'Department ID',
  '职责绑定 ID': 'Binding ID', '分管 ID': 'Scope ID', '职责绑定版本': 'Binding version', '分管版本': 'Scope version', '未提供': 'Not provided',
  '同人职责说明': 'Same-person duties', '一次确认两项管理职责；正式办理时需明确两项职责并原子记录，本页不执行确认。': 'Confirm both management duties once, explicitly and atomically during actual processing. No confirmation is performed here.',
  '人员当前不符合资格': 'Person is not currently eligible', '组织或科室已失效': 'Organization or section is inactive',
  '缺少职责绑定': 'Missing responsibility binding', '存在多个职责绑定': 'Ambiguous responsibility binding',
  '缺少有效任职': 'Missing active assignment', '存在多个有效任职': 'Ambiguous active assignment',
  '缺少有效分管': 'Missing active scope', '存在多个有效分管': 'Ambiguous active scope',
};

export function WorkflowClosurePreview(props: Props) {
  const session = useWorkTabsStore(state => state.sessionScope);
  const location = useLocation();
  return <ClosureScope key={JSON.stringify([session, props.policy, !!props.disabled, location.pathname, location.search])} {...props} session={session} />;
}

function ClosureScope({ policy, disabled, session }: Props & { session?: string }) {
  const { t: translate, locale } = useLanguage();
  const t = (text: string) => locale === 'en-US' ? english[text] ?? translate(text) : translate(text);
  const navigate = useNavigate();
  const completeSessionNavigation = useCompletedSessionNavigation();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<Choice>();
  const [professional, setProfessional] = useState<Choice>();
  const [owner, setOwner] = useState<Choice>();
  const [severity, setSeverity] = useState<PreviewInput['severity']>('MEDIUM');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [options, setOptions] = useState<Options>();
  const [loading, setLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState<unknown>();
  const [error, setError] = useState<unknown>();
  const [result, setResult] = useState<Preview>();
  const [busy, setBusy] = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);
  const [denied, setDenied] = useState(false);
  const alive = useRef(false);
  const ending = useRef(false);
  const locked = useRef(false);
  const directoryController = useRef<AbortController | undefined>(undefined);
  const previewController = useRef<AbortController | undefined>(undefined);
  const current = useCallback(() => alive.current && !ending.current && session === useWorkTabsStore.getState().sessionScope, [session]);
  const abort = useCallback(() => { directoryController.current?.abort(); previewController.current?.abort(); }, []);
  useNavigationBusy(busy);
  useEffect(() => {
    alive.current = true;
    // Invalidate synchronously even if the identity changes twice before React renders.
    const unsubscribe = useWorkTabsStore.subscribe(state => { if (state.sessionScope !== session) { ending.current = true; abort(); } });
    return () => { alive.current = false; unsubscribe(); abort(); };
  }, [session, abort]);
  useEffect(() => {
    if (!unauthorized || !alive.current || session !== useWorkTabsStore.getState().sessionScope) return;
    // Release this preview's busy registration before bypassing the parent draft guard.
    completeSessionNavigation(() => { useWorkTabsStore.getState().reset(); navigate('/login', { replace: true }); });
  }, [unauthorized, session, completeSessionNavigation, navigate]);
  const report = useCallback((cause: unknown, directory = false) => {
    if (!current()) return;
    if (cause instanceof ApiError && cause.status === 401) {
      ending.current = true; abort(); setBusy(false); setLoading(false); setOpen(false); setResult(undefined); setOptions(undefined); setUnauthorized(true);
      return;
    }
    if (cause instanceof ApiError && (cause.status === 403 || ['FEATURE_PERMISSION_DENIED', 'ORGANIZATION_SCOPE_DENIED'].includes(cause.code))) {
      ending.current = true; abort(); setDenied(true); setBusy(false); setLoading(false); setOptions(undefined); setResult(undefined);
    }
    if (directory) setDirectoryError(cause); else setError(cause);
  }, [current, abort]);
  useEffect(() => {
    if (!open || disabled || denied) return;
    const controller = new AbortController(); directoryController.current = controller;
    setLoading(true); setOptions(undefined); setDirectoryError(undefined);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ search, page: String(page), pageSize: '20' });
      void apiRequest<Options>(`/api/v1/workflows/closure-options?${params}`, { signal: controller.signal })
        .then(value => { if (current() && !controller.signal.aborted) setOptions(value); })
        .catch(cause => { if (current() && !controller.signal.aborted) report(cause, true); })
        .finally(() => { if (current() && !controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, disabled, denied, search, page, revision, current, report]);

  function invalidate() { setResult(undefined); setError(undefined); }
  function searchDirectory(value: string) { setSearch(value.slice(0, 100)); setPage(1); }
  function close() { if (locked.current) return; abort(); setOpen(false); invalidate(); }
  async function run() {
    if (!current() || disabled || denied || locked.current || !section || !professional || (policy === 'INTERNAL' && !owner)) return;
    locked.current = true; setBusy(true); invalidate();
    const controller = new AbortController(); previewController.current = controller;
    const body: PreviewInput = { policy, severity, responsibleSectionDepartmentId: section.value, professionalUserId: professional.value,
      ...(policy === 'INTERNAL' ? { ownerUserId: owner!.value } : {}) };
    try {
      const token = await csrfToken(controller.signal);
      if (!current() || controller.signal.aborted) return;
      const value = await apiRequest<Preview>('/api/v1/workflows/closure-preview', {
        method: 'POST', signal: controller.signal, headers: { 'x-csrf-token': token }, body: JSON.stringify(body),
      }, { replayAfterReauthentication: false });
      if (current() && !controller.signal.aborted) setResult(value);
    } catch (cause) { if (current() && !controller.signal.aborted) report(cause); }
    finally { locked.current = false; if (current() && !controller.signal.aborted) setBusy(false); }
  }
  const frozen = disabled || denied || busy;
  const userOptions = options?.users.map(user => ({ value: user.id, label: user.fullName ? `${user.fullName} (${user.username})` : user.username })) ?? [];
  const select = (suffix: string, label: string, value: Choice | undefined, values: Choice[], change: (next: Choice | undefined) => void) => <div>
    <label htmlFor={`${id}-${suffix}`}>{t(label)}</label>
    <Select<Choice> id={`${id}-${suffix}`} aria-label={t(label)} style={{ width: '100%' }} labelInValue allowClear showSearch={false}
      value={value} options={values} loading={loading} disabled={frozen || loading || !!directoryError}
      notFoundContent={t('暂无匹配选项')} onChange={next => { change(next); invalidate(); }} />
  </div>;
  function feedback(cause: unknown, directory = false) {
    return <Alert type="error" title={t(safeAccountError(cause))} description={<Space orientation="vertical">
      {cause instanceof ApiError && cause.traceId ? <code>{cause.traceId}</code> : null}
      {!denied ? <Button disabled={busy} onClick={() => directory ? setRevision(value => value + 1) : void run()}>{t(directory ? '重试目录' : '重试配置预览')}</Button> : null}
    </Space>} />;
  }
  function person(value: Preview['duties'][number]['participant']) { return value ? value.fullName ? `${value.fullName} (${value.username})` : value.username : t('尚未解析'); }
  return <Space orientation="vertical" style={{ width: '100%', minWidth: 0 }}>
    <Collapse size="small" items={[{ key: 'about', label: t('预览说明'), children: t('只读配置测试，不会发单或审批；目录仅供选择配置测试身份，不代表执行授权。') }]} />
    <Button disabled={disabled || denied} onClick={() => setOpen(true)}>{t('打开关闭职责预览')}</Button>
    <Modal title={t('关闭职责预览')} open={open} width={800} destroyOnHidden onCancel={close} closable={!busy} keyboard={!busy} mask={{ closable: !busy }}
      footer={<Space wrap><Button disabled={busy} onClick={close}>{t('关闭预览')}</Button><Button aria-label={t('运行配置预览')} type="primary" htmlType="submit" form={`${id}-form`} loading={busy}
        disabled={frozen || !section || !professional || (policy === 'INTERNAL' && !owner)}>{t('运行配置预览')}</Button></Space>}
      styles={{ body: { maxHeight: '70vh', overflow: 'auto' } }}>
      <Space orientation="vertical" style={{ width: '100%', minWidth: 0 }}>
        <Alert type="info" title={t('只读配置测试，不会发单或审批；目录仅供选择配置测试身份，不代表执行授权。')} />
        {directoryError ? feedback(directoryError, true) : null}
        <form id={`${id}-form`} aria-label={t('关闭职责配置测试')} onSubmit={event => { event.preventDefault(); void run(); }}>
          <Space orientation="vertical" style={{ width: '100%' }}>
            <label htmlFor={`${id}-search`}>{t('搜索科室或内部人员')}</label>
            <Input id={`${id}-search`} value={search} maxLength={100} disabled={frozen} onChange={event => searchDirectory(event.target.value)}
              onPressEnter={event => { event.preventDefault(); void run(); }} />
            <Typography.Text>{t('科室')}：{options?.departmentTotal ?? '—'} / {t('内部人员')}：{options?.userTotal ?? '—'}</Typography.Text>
            <nav aria-label={t('目录分页')}><Pagination current={page} pageSize={20} total={Math.max(options?.departmentTotal ?? 0, options?.userTotal ?? 0)}
              size="small" responsive showLessItems showSizeChanger={false} disabled={frozen || loading || !!directoryError} onChange={setPage} /></nav>
            {select('section', '责任科室', section, options?.departments.map(department => ({ value: department.id, label: `${department.name} (${department.code})` })) ?? [], setSection)}
            {select('professional', '专业人员（配置测试）', professional, userOptions, setProfessional)}
            {policy === 'INTERNAL' ? select('owner', '内部负责人（配置测试）', owner, userOptions, setOwner) : null}
            <div><label htmlFor={`${id}-severity`}>{t('严重度')}</label><Select id={`${id}-severity`} aria-label={t('严重度')} style={{ width: '100%' }} value={severity} disabled={frozen}
              options={(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).map((value, index) => ({ value, label: t(['低', '中', '高', '严重'][index]!) }))}
              onChange={value => { setSeverity(value); invalidate(); }} /></div>
            <Typography.Text type="secondary">{t('请先选择责任科室、专业人员及内部负责人（仅内部策略需要）。')}</Typography.Text>
          </Space>
        </form>
        {error ? feedback(error) : null}
        {result ? <>
          <Alert type={result.configurationReady ? 'info' : 'warning'} title={t(result.configurationReady ? '配置解析完成，不代表执行授权或审批结果。' : '配置缺项，请维护后重新预览；本页不提供审批。')} />
          <Descriptions size="small" column={1} items={[
            { key: 'section', label: t('责任科室'), children: section?.label },
            { key: 'at', label: t('解析时间'), children: result.at },
            { key: 'mode', label: t('执行顺序'), children: t(result.executionMode === 'PARALLEL' ? '并行审核' : '专业先审，再启动管理审核') },
          ]} />
          {result.issues.length ? <Alert type="warning" title={<ul>{result.issues.map((issue, index) => <li key={index}>{t(duties[issue.duty])}：{t(issues[issue.code])}</li>)}</ul>} /> : null}
          <Table<Preview['duties'][number]> size="small" rowKey="duty" pagination={false} scroll={{ x: 520 }} dataSource={result.duties} columns={[
            { title: t('职责'), dataIndex: 'duty', render: (value: keyof typeof duties) => t(duties[value]) },
            { title: t('状态'), dataIndex: 'status', render: (value: keyof typeof statuses) => t(statuses[value]) },
            { title: t('人员'), render: (_, duty) => person(duty.participant) },
          ]} expandable={{ rowExpandable: duty => !!duty.participant, expandedRowRender: duty => duty.participant ? <Descriptions size="small" column={1} items={[
            ['用户 ID', duty.participant.userId], ['任职 ID', duty.participant.assignmentId], ['岗位 ID', duty.participant.positionId],
            ['部门 ID', duty.participant.departmentId], ['职责绑定 ID', duty.participant.bindingId], ['分管 ID', duty.participant.scopeId],
            ['职责绑定版本', duty.participant.bindingVersion], ['分管版本', duty.participant.scopeVersion],
          ].map(([label, value]) => ({ key: String(label), label: t(String(label)), children: <span style={{ overflowWrap: 'anywhere' }}>{value ?? t('未提供')}</span> }))} /> : null }} />
          {result.samePersonGroups.map(group => <Alert key={group.userId} type="info" title={t('同人职责说明')}
            description={<>{person(result.duties.find(duty => duty.participant?.userId === group.userId)?.participant ?? null)} · {group.duties.map(duty => t(duties[duty])).join(' / ')}：{t('一次确认两项管理职责；正式办理时需明确两项职责并原子记录，本页不执行确认。')}</>} />)}
          <Collapse size="small" items={[{ key: 'sources', label: t('展开来源明细'), children: <Descriptions column={1} size="small" items={[
            { key: 'org', label: t('组织 ID'), children: result.organizationId },
            { key: 'section', label: t('科室 ID'), children: result.sectionDepartmentId },
          ]} /> }]} />
        </> : null}
      </Space>
    </Modal>
  </Space>;
}
