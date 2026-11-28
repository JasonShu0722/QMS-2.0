import { Button } from 'antd';
import { ArrowRight, ChevronDown, ClipboardCheck, Network, ShieldAlert, UserCircle } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { QmsLoading } from '../components/QmsLoading';
import { useLanguage } from '../i18n/Language';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';
import { WorkbenchGraphBoundary } from './WorkbenchGraphBoundary';
import './workbench.css';

const GraphPanel = lazy(() => import('./WorkbenchGraph').then(module => ({ default: module.WorkbenchGraph })));
const metrics = ['个人待办', '待审批', '即将逾期', '高风险', '关键指标'] as const;
const entries = [
  { title: '我的待办', path: '/app/my-tasks', icon: ClipboardCheck },
  { title: '问题中心', path: '/app/problem-center', icon: ShieldAlert },
  { title: '个人账号', path: '/app/account', icon: UserCircle },
] as const;

function GraphDisclosure({ sessionScope }: { sessionScope: string }) {
  const { locale } = useLanguage();
  const [params, setParams] = useSearchParams();
  const hasSelection = params.has('graphNode') || params.has('graphRelation');
  const [expanded, setExpanded] = useState(hasSelection);
  const [saving, setSaving] = useState(false);
  const open = expanded || hasSelection || saving;
  const title = locale === 'en-US' ? 'Capability graph' : '功能图谱';
  const toggle = () => {
    setExpanded(!open);
    if (open && hasSelection) {
      const next = new URLSearchParams(params);
      next.delete('graphNode'); next.delete('graphRelation');
      setParams(next, { replace: true });
    }
  };
  return <section className="qms-workbench__graph qms-display-card" aria-labelledby="workbench-graph-title">
    <h2 id="workbench-graph-title">
      <Button block type="text" className="qms-workbench__graph-toggle" icon={<Network size={18} aria-hidden="true" />} aria-expanded={open} aria-controls="workbench-graph-panel" disabled={saving} onClick={toggle}>
        {title}<ChevronDown size={16} aria-hidden="true" />
      </Button>
    </h2>
    <div id="workbench-graph-panel" hidden={!open}>
      {open && <WorkbenchGraphBoundary fallback={<p role="alert">{locale === 'en-US' ? 'The capability graph could not start. Reload the page to try again.' : '功能图谱无法打开，请刷新页面重试。'}</p>}>
        <Suspense fallback={<QmsLoading label={locale === 'en-US' ? 'Loading capability graph…' : '正在加载功能图谱…'} />}>
          <GraphPanel sessionScope={sessionScope} keepOpen={() => setExpanded(true)} onSavingChange={setSaving} />
        </Suspense>
      </WorkbenchGraphBoundary>}
    </div>
  </section>;
}

export function Workbench() {
  const { t } = useLanguage();
  const sessionScope = useWorkTabsStore(state => state.sessionScope);
  return (
    <section className="qms-workbench" aria-label={t('综合工作台')}>
      <h1 className="sr-only">{t('综合工作台')}</h1>
      <section className="qms-workbench__entries" aria-labelledby="workbench-entry-title">
        <h2 id="workbench-entry-title">{t('工作入口')}</h2>
        <div>{entries.map(({ title, path, icon: Icon }) => (
          <Link className="qms-workbench__entry qms-display-card" key={path} to={path} aria-label={t(title)}>
            <Icon size={22} aria-hidden="true" /><strong>{t(title)}</strong><ArrowRight size={16} aria-hidden="true" />
          </Link>
        ))}</div>
      </section>
      {sessionScope?.startsWith('INTERNAL:') && <GraphDisclosure key={sessionScope} sessionScope={sessionScope} />}
      <section className="qms-workbench__overview qms-display-card" aria-labelledby="workbench-overview-title">
        <h2 id="workbench-overview-title">{t('质量概览')}</h2>

        <dl>{metrics.map((label) => <div key={label}><dt>{t(label)}</dt><dd>{t('待接入')}</dd></div>)}</dl>
      </section>
    </section>
  );
}
