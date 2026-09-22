import { useCallback, useRef, useState } from 'react';
import { Alert, Button, Space, Spin, Tag } from 'antd';
import { Link, useSearchParams } from 'react-router-dom';
import { useLanguage } from '../../i18n/Language';
import { mutateInbox } from '../tasks/task-inbox';
import { problemScope, readWorkspace } from './problem-workspace-api';
import { ProblemError, ProblemEvidence, ProblemNodes, ProblemSections, useProblemRead } from './problem-read';
import { ProblemReportPanel } from './ProblemReportPanel';
import { ProblemAuditPanel } from './ProblemAuditPanel';
import { ProblemUpgradePanel } from './ProblemUpgradePanel';
import { useProblemDomainUi } from './problem-ui';
import './problem-workspace.css';

export function ProblemWorkspacePage({ problemId }: { problemId?: string }) {
  const { t } = useLanguage();
  const [params] = useSearchParams();
  if (!problemId) return <main className="problem-workspace"><h1>{t('问题处理工作空间')}</h1><p>{t('请从问题中心选择一个问题。')}</p><Link to="/app/problem-center">{t('问题中心')}</Link></main>;
  const organizationId = params.get('organizationId') || undefined;
  const instanceId = params.get('instanceId') || undefined;
  return <Workspace key={`${problemId}:${organizationId}:${instanceId}`} problemId={problemId} organizationId={organizationId} instanceId={instanceId} />;
}

function Workspace({ problemId, organizationId, instanceId }: { problemId: string; organizationId?: string; instanceId?: string }) {
  const { t, locale } = useLanguage();
  const [, setParams] = useSearchParams();
  const read = useCallback((signal: AbortSignal) => readWorkspace(problemId, organizationId, instanceId, signal), [problemId, organizationId, instanceId]);
  const state = useProblemRead(read, `${problemId}:${organizationId}:${instanceId}`);
  const [tab, setTab] = useState('overview');
  const [focused, setFocused] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const writing = useRef(false);
  const workspace = state.data;
  const DomainUi = useProblemDomainUi(workspace?.domain?.summary.domainUiKey);
  const selected = workspace?.selectedInstance;
  const current = !!selected?.current;
  async function claim(action: 'claim' | 'release') {
    if (writing.current || !workspace?.task || !current) return;
    writing.current = true; setPending(true); setError(undefined);
    try { await mutateInbox(`/api/v1/tasks/${workspace.task.id}/${action}?${problemScope(workspace.problem.organizationId)}`, workspace.task.version); }
    catch (cause) { setError(cause); }
    finally { writing.current = false; setPending(false); state.refresh(); }
  }
  const choose = (value?: string) => setParams(problemScope(workspace?.problem.organizationId ?? organizationId, value));
  return <main className={`problem-workspace${focused ? ' is-focused' : ''}`}><div className="problem-workspace__heading"><h1>{t('问题处理工作空间')}</h1><Button aria-pressed={focused} onClick={() => setFocused((value) => !value)}>{t(focused ? '退出专注' : '专注处理')}</Button></div><ProblemError cause={state.error ?? error} />
    <Button disabled={state.loading || pending} onClick={() => { setError(undefined); setUpgrading(false); state.refresh(); }}>{t('刷新工作空间')}</Button>
    {state.loading ? <Spin aria-label={t('正在加载')} /> : workspace ? <>
      <header className="problem-header"><div><Tag>{workspace.problem.reportNumber}</Tag>{tab === 'overview' ? <h2>{current ? workspace.problem.summary.title : workspace.domain?.summary.title ?? t('历史数据不可用')}</h2> : null}</div>
        <Link to={`/app/problem-center?${problemScope(workspace.problem.organizationId)}`}>{t('返回问题中心')}</Link></header>
      <label>{t('流程实例')} <select aria-label={t('流程实例')} value={selected?.id ?? ''} onChange={(event) => choose(event.target.value)}>
        {!workspace.instances.length ? <option value={selected?.id ?? ''}>{selected?.id ?? t('暂无流程实例')}</option> : workspace.instances.map((instance) => <option key={instance.id} value={instance.id}>{instance.current ? t('当前实例') : t('历史实例')} · {new Date(instance.createdAt).toLocaleString(locale)} · {instance.id}</option>)}
      </select></label>
      {selected && !current ? <Alert type="info" title={t('历史实例只读')} /> : null}
      <nav aria-label={t('问题视图')} className="problem-tabs">{[['overview', '问题概览'], ['report', '报告预览'], ['audit', '追溯']].map(([key, label]) => <Button key={key} aria-label={t(label!)} type={tab === key ? 'primary' : 'default'} aria-pressed={tab === key} onClick={() => { setTab(key!); setUpgrading(false); }}>{t(label!)}</Button>)}</nav>
      {tab === 'overview' ? <>
        <p>{workspace.domain?.summary.description ?? t('领域数据不可用')}</p>
        {selected ? <p>{t('固定流程版本')}：<code>{selected.workflowVersionId}</code> · {t('实例版本')} {selected.version}</p> : null}
        {workspace.capabilities.projectionPending ? <Alert type="info" title={t('任务正在同步，请稍后刷新。')} /> : null}
        <Space wrap>{current && workspace.task?.canClaim ? <Button loading={pending} onClick={() => { void claim('claim'); }}>{t(workspace.task.claimedByUserId ? '重新领取任务' : '领取任务')}</Button> : null}
          {current && workspace.task?.canRelease ? <Button loading={pending} onClick={() => { void claim('release'); }}>{t('释放任务')}</Button> : null}
          {current && workspace.actions.some((action) => action.actionKey === 'platform.upgrade') ? <Button disabled={pending || !workspace.actions.some((action) => action.actionKey === 'platform.upgrade' && action.enabled)} onClick={() => setUpgrading(true)}>{t('升级预览')}</Button> : null}</Space>
        {upgrading ? <ProblemUpgradePanel problemId={problemId} organizationId={workspace.problem.organizationId} onClose={() => setUpgrading(false)} onSuccess={() => { setUpgrading(false); choose(); state.refresh(); }} /> : null}
        <div className="problem-workspace__body">
          <aside className="problem-workspace__nodes"><ProblemNodes nodes={workspace.nodes} /></aside>
          <div className="problem-workspace__main">
            <ProblemSections sections={workspace.domain?.sections ?? []} />
            {current && DomainUi ? <DomainUi workspace={workspace} refresh={state.refresh} /> : current ? <p>{t('该领域处理表单尚未接入。')}</p> : null}
          </div>
          <aside className="problem-workspace__context">
            <ProblemEvidence evidence={workspace.evidence} />
            <section className="problem-section"><h3>{t('升级记录')}</h3><ul>{workspace.upgrades.map((entry) => <li key={entry.id}>{entry.reason} · {new Date(entry.createdAt).toLocaleString(locale)} <Link to={`?${problemScope(workspace.problem.organizationId, entry.beforeInstanceId)}`}>{t('查看升级前实例')}</Link> · <Link to={`?${problemScope(workspace.problem.organizationId, entry.afterInstanceId)}`}>{t('查看升级后实例')}</Link></li>)}</ul></section>
          </aside>
        </div>
      </> : null}
      {tab === 'report' ? <ProblemReportPanel problemId={problemId} organizationId={workspace.problem.organizationId} instanceId={selected?.id} /> : null}
      {tab === 'audit' ? <ProblemAuditPanel problemId={problemId} organizationId={workspace.problem.organizationId} /> : null}
    </> : null}
  </main>;
}
