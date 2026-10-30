import { Alert } from 'antd';
import { useLocation } from 'react-router-dom';
import { WorkflowListPage } from '../features/workflows/WorkflowListPage';
import { WorkflowDesignerPage } from '../features/workflows/WorkflowDesignerPage';
import { useLanguage } from '../i18n/Language';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';
import { useConsoleContext } from './ConsoleLayout';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const uuidPattern = new RegExp(`^${uuid}$`, 'i');
const detailPattern = new RegExp(`^/console/workflows/(${uuid})/(${uuid})$`, 'i');

export function ConsoleWorkflowPage() {
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
  const detail = detailPattern.exec(location.pathname);
  const query = new URLSearchParams(location.search);
  const target = query.get('organizationId');
  if (location.pathname !== '/console/workflows' && !detail || /%(?![0-9a-f]{2})/i.test(location.search)
    || [...query.keys()].some(key => key !== 'organizationId') || query.getAll('organizationId').length > 1
    || target !== null && (!uuidPattern.test(target) || target.toLowerCase() !== context.targetOrganization.id.toLowerCase())) {
    return <Alert type="error" showIcon role="alert" title={t('管理定位无效：链接无效或与当前管理范围不匹配。')} />;
  }
  const key = JSON.stringify([session, module.scope, module.coverage, module.organizationId, [...module.permissions].sort()]);
  return detail ? <WorkflowDesignerPage key={key} definitionId={detail[1]!} versionId={detail[2]!} expectedOrganizationId={home} />
    : <WorkflowListPage key={key} expectedOrganizationId={home} />;
}
