import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Empty, Space, Spin, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useCompletedSessionNavigation } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import type { AdminOrganization } from '../admin/admin';
import { organizationPath } from './governance';
import { GovernanceFeedback } from './GovernanceFeedback';
import './legacy-authorization.css';

export type AuthorizationSourcesProps = { organization: AdminOrganization; userId?: string; positionId?: string; onDenied?: (error: ApiError) => void };
type Labels = components['schemas']['LegacyAuthorizationLabelsDto'];
type History = components['schemas']['LegacyAuthorizationHistoryPageDto'];
type SourcePage = components['schemas']['LegacyAuthorizationSourcePageDto'];
export const canReadAuthorizationSources = (organization: AdminOrganization) => organization.type === 'INTERNAL' && ['account:roles:read', 'organization:structure:read', 'account:users:read'].every(code => organization.permissions.includes(code));

const authorizationTranslations: Record<string, string> = {
  '名称不可用': 'Name unavailable', '部门不可用': 'Department unavailable', '原组织': 'Original organization', '全局共享': 'Globally shared',
  '平台管理标记': 'Platform administrator marker', '总计': 'Total', '当前来源': 'Current sources', '上一页': 'Previous page', '下一页': 'Next page',
  '暂无已解除历史': 'No released authorization history', '历史已解除': 'Historically released', '历史标签不可用，不以当前名称替代历史事实。': 'Historical labels are unavailable. Current names do not replace historical facts.',
  '兼容岗位映射': 'Legacy position mapping', '兼容直接授权': 'Legacy direct grant', '系统初始化来源': 'System initialization source',
  '本次解除': 'Released in this operation', '本次保留': 'Retained in this operation', '保留来源数': 'Retained source count', '处置策略': 'Disposition strategy',
  '无授权来源读取权限或对象范围无效': 'Authorization sources are not readable, or the subject scope is invalid', '暂无授权来源': 'No authorization sources',
  '来源状态': 'Source status', '生效': 'Effective', '不生效': 'Not effective', '任职窗口': 'Appointment window', '解除历史': 'Release history',
  '兼容授权迁移/清理': 'Legacy authorization migration / cleanup', '只处置明确选择的来源；权限与稳定角色资格分别核对，不自动转换。': 'Only explicitly selected sources are changed. Review permissions and stable role qualifications separately. No automatic conversion.',
  '刷新兼容来源': 'Refresh legacy sources', '收起已解除历史': 'Hide release history', '查看已解除历史': 'View release history',
  '兼容授权处置完成，历史事实已保留。': 'Legacy authorization disposition completed. Historical facts are retained.', '暂无兼容授权': 'No legacy authorizations', '查看兼容来源': 'View legacy sources',
  '处置草稿': 'Disposition draft', '处置基线已变化，请保留草稿并重新预览。': 'The disposition baseline changed. Your draft is retained; preview again.',
  '执行结果未知，已锁定原请求。只能原样重试，不可变更来源或目标。': 'The outcome is unknown. The original request is locked. Retry it unchanged; sources and target cannot be edited.',
  '精确来源选择': 'Exact source selection', '处置方式': 'Disposition', '解除并移除': 'Release and remove', '迁入已有岗位': 'Migrate to an existing position', '迁入新岗位': 'Migrate to a new position',
  '目标岗位': 'Target position', '请选择目标岗位': 'Select a target position', '明确保留稳定角色代码资格（可能保留兼容映射）': 'Explicitly preserve stable role-code qualification (a legacy mapping may remain)',
  '仅可读取来源，没有本处置所需的完整权限。': 'Read-only sources. You do not have all permissions needed for this disposition.', '预览处置': 'Preview disposition', '处置预览': 'Disposition preview',
  '未选来源保持不变；资格兼容映射仍是保留来源，不代表已全部清理。': 'Unselected sources stay unchanged. Qualification compatibility mappings remain retained sources, not a completed cleanup.',
  '稳定角色代码': 'Stable role code', '目标原岗位自有授权': 'Original canonical authorization of target', '流程引用与稳定资格': 'Workflow references and stable qualifications',
  '全部受影响人员与扩散确认': 'All affected people and diffusion confirmation', '权限前后': 'Permissions before / after', '角色代码前后': 'Role codes before / after',
  '确认该人员全部扩散影响': 'Confirm all diffusion effects for this person', '确认执行': 'Confirm execution', '原样重试确认结果': 'Retry the original request unchanged', '取消处置': 'Cancel disposition',
  '重新读取兼容来源': 'Reload legacy sources', '无兼容授权读取权限': 'You cannot read legacy authorization sources', '已绑定': 'Enrolled', '不可用': 'Unavailable',
  '仅可读取角色定义与权限概览，缺少结构及完整来源读取权限。': 'Only role definitions and permission summaries are readable. Structure and full authorization sources are not authorized.', '收起授权来源': 'Hide authorization sources',
};
export function useAuthorizationLanguage() {
  const language = useLanguage();
  return { ...language, t: (text: string) => language.locale === 'en-US' ? authorizationTranslations[text] ?? language.t(text) : language.t(text) };
}

export function AuthorizationLabel({ labels, kind, id }: { labels: Labels | null; kind: 'users' | 'positions' | 'organizations'; id: string | null }) {
  const { t } = useAuthorizationLanguage();
  if (!id) return <span>{t('无')}</span>;
  const row = labels?.[kind].find(entry => entry.id === id);
  return <span className="authorization-label">{!row ? t('名称不可用') : 'username' in row ? `${row.fullName ? `${row.fullName} · ` : ''}${row.username}` : `${row.name} · ${row.code}`}
    {row && 'unavailable' in row && row.unavailable && <small>{t('不可用')}</small>}
    {row && 'status' in row && <small>{row.status}</small>}
    {row && 'departmentId' in row && <small>{row.departmentId === null ? t('组织直属') : row.department ? `${row.department.name} · ${row.department.code}` : `${t('部门不可用')} · ${row.departmentId}`}</small>}
    <small>ID: {id}</small>
  </span>;
}

export function AuthorizationRoleFacts({ role, labels = null }: { role: components['schemas']['LegacyAuthorizationRoleDto']; labels?: Labels | null }) {
  const { t } = useAuthorizationLanguage();
  return <div className="authorization-facts"><strong>{role.name} · {role.code}</strong><small>ID: {role.id}</small><span>{t('原组织')}：{role.organizationId ? <AuthorizationLabel labels={labels} kind="organizations" id={role.organizationId} /> : t('全局共享')}</span>
    <span>{t('权限')}：{role.permissionCodes.join(' · ') || t('无系统权限')}</span><span>MFA: {t(role.mfaRequired ? '要求 MFA' : '登录时不要求 MFA')}</span>
    <span>{t('平台管理标记')}：{t(role.platformMarker ? '是' : '否')}</span>
  </div>;
}

export function AuthorizationPager({ total, offset, pageSize, label, loading, onPage }: { total: number; offset: number; pageSize: number; label: string; loading: boolean; onPage: (offset: number) => void }) {
  const { t } = useAuthorizationLanguage();
  return <Space wrap><span>{t('总计')} {total}</span><Button aria-label={`${t(label)}${t('上一页')}`} disabled={loading || offset === 0} onClick={() => onPage(Math.max(0, offset - pageSize))}>{t('上一页')}</Button><span>{Math.floor(offset / pageSize) + 1}</span><Button aria-label={`${t(label)}${t('下一页')}`} disabled={loading || offset + pageSize >= total} onClick={() => onPage(offset + pageSize)}>{t('下一页')}</Button></Space>;
}

export function AuthorizationHistoryFacts({ page }: { page: History }) {
  const { t } = useAuthorizationLanguage();
  return <>{!page.items.length ? <Empty description={t('暂无已解除历史')} /> : page.items.map(item => <article className="authorization-record" key={item.archiveId}>
    <strong>{t('历史已解除')} · {item.operation} · {item.createdAt}</strong><small>ID: {item.archiveId}</small>
    {item.role ? <AuthorizationRoleFacts role={item.role} labels={item.labels} /> : <span>{t('名称不可用')} · ID: {item.roleId}</span>}
    {item.labelsUnavailable && <Alert type="info" title={t('历史标签不可用，不以当前名称替代历史事实。')} />}
    <span>{t('操作人')}：<AuthorizationLabel labels={item.labels} kind="users" id={item.actorUserId} /></span>
    {item.directSources.map(source => <div key={`${source.organizationId}:${source.userId}`}><span>{t(source.initialization ? '系统初始化来源' : '兼容直接授权')} · {t(source.selected ? '本次解除' : '本次保留')}</span><AuthorizationLabel labels={item.labels} kind="users" id={source.userId} /><AuthorizationLabel labels={item.labels} kind="organizations" id={source.organizationId} /></div>)}
    {item.mappedSources.map(source => <div key={`${source.organizationId}:${source.positionId}`}><span>{t('兼容岗位映射')} · {t(source.selected ? '本次解除' : '本次保留')}</span><AuthorizationLabel labels={item.labels} kind="positions" id={source.positionId} />{source.assignments.map(assignment => <p key={assignment.id}><AuthorizationLabel labels={item.labels} kind="users" id={assignment.userId} />{assignment.temporalState} · {assignment.startedAt} → {assignment.endedAt ?? t('未结束')}</p>)}</div>)}
    <span>{t('保留来源数')}：{item.retainedSourceCount ?? t('不可用')}</span>
    {item.target && <span>{t('处置策略')}：{item.target.strategy} · {item.target.name} · {item.target.code} · ID: {item.target.positionId}</span>}
  </article>)}</>;
}

export function AuthorizationSources(props: AuthorizationSourcesProps) {
  const session = useWorkTabsStore(state => state.sessionScope);
  return <SourcesScope key={JSON.stringify([session, props.organization.id, [...props.organization.permissions].sort(), props.userId, props.positionId])} {...props} />;
}

function SourcesScope({ organization, userId, positionId, onDenied }: AuthorizationSourcesProps) {
  const { t } = useAuthorizationLanguage();
  const navigate = useNavigate(); const completeSessionNavigation = useCompletedSessionNavigation();
  const [offsets, setOffsets] = useState({ current: 0, history: 0 }); const [revision, setRevision] = useState(0);
  const [current, setCurrent] = useState<SourcePage>(); const [history, setHistory] = useState<History>(); const [labels, setLabels] = useState<Labels>();
  const [loading, setLoading] = useState(false); const [error, setError] = useState<unknown>(); const [denied, setDenied] = useState(false);
  const callbacks = useRef({ onDenied }); callbacks.current = { onDenied };
  const authorized = canReadAuthorizationSources(organization) && Number(!!userId) + Number(!!positionId) === 1;
  useEffect(() => {
    if (!authorized || denied) return;
    const controller = new AbortController(); let active = true; const scope = useWorkTabsStore.getState().sessionScope;
    const valid = () => active && useWorkTabsStore.getState().sessionScope === scope;
    setLoading(true); setError(undefined);
    const read = (offset: number) => apiRequest<components['schemas']['LegacyAuthorizationSourcesDto']>(organizationPath(organization.id, `/authorization-sources?${userId ? `userId=${encodeURIComponent(userId)}` : `positionId=${encodeURIComponent(positionId!)}`}&pageSize=20&offset=${offset}`), { signal: controller.signal });
    void Promise.all(offsets.current === offsets.history ? [read(offsets.current)] : [read(offsets.current), read(offsets.history)]).then(([sources, historical]) => {
      if (!valid()) return; setCurrent(sources.currentSources); setHistory((historical ?? sources).history); setLabels(sources.labels);
    }).catch(cause => {
      if (!valid()) return;
      if (cause instanceof ApiError && [401, 403].includes(cause.status ?? 0)) {
        setDenied(true); setCurrent(undefined); setHistory(undefined); setLabels(undefined); callbacks.current.onDenied?.(cause);
        if (cause.status === 401) completeSessionNavigation(() => { useWorkTabsStore.getState().reset(); navigate('/login', { replace: true }); });
      }
      setError(cause);
    }).finally(() => { if (valid()) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [authorized, denied, organization.id, userId, positionId, offsets.current, offsets.history, revision, completeSessionNavigation, navigate]);
  const kinds = { POSITION_CANONICAL: '岗位自有权限', LEGACY_MAPPING: '兼容岗位映射', LEGACY_DIRECT: '兼容直接授权', SYSTEM_INITIALIZATION: '系统初始化来源' };
  if (!authorized || denied) return <Alert role="alert" type="warning" title={t('无授权来源读取权限或对象范围无效')} />;
  return <section className="legacy-authorization" aria-label={t('授权来源')}><Typography.Title level={4}>{t('授权来源')}</Typography.Title>
    <GovernanceFeedback error={error} retry={() => setRevision(value => value + 1)} />{loading && <Spin />}
    {!error && !loading && current && <><Typography.Title level={5}>{t('当前来源')}</Typography.Title>{!current.items.length && <Empty description={t('暂无授权来源')} />}
      {current.items.map((source, index) => <article className="authorization-record" key={`${source.role.id}:${source.assignmentId}:${source.kind}:${index}`}><strong>{t(kinds[source.kind])}</strong><span>{t('来源状态')}：{source.temporalState} · {t(source.active ? '生效' : '不生效')}</span>
        <AuthorizationLabel labels={labels ?? null} kind="users" id={source.userId} /><AuthorizationLabel labels={labels ?? null} kind="positions" id={source.positionId} /><AuthorizationLabel labels={labels ?? null} kind="organizations" id={source.organizationId} />
        <AuthorizationRoleFacts role={source.role} labels={labels} /><span>{t('任职窗口')}：{source.startedAt ?? t('无')} → {source.endedAt ?? t('未结束')}</span>
      </article>)}<AuthorizationPager {...current} label="当前来源" loading={loading} onPage={offset => setOffsets(value => ({ ...value, current: offset }))} /></>}
    {!error && !loading && history && <><Typography.Title level={5}>{t('历史已解除')}</Typography.Title><AuthorizationHistoryFacts page={history} /><AuthorizationPager {...history} label="解除历史" loading={loading} onPage={offset => setOffsets(value => ({ ...value, history: offset }))} /></>}
  </section>;
}
