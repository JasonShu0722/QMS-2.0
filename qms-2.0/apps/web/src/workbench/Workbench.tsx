import { ArrowRight, ClipboardCheck, ShieldAlert, UserCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../i18n/Language';
import './workbench.css';

const metrics = ['个人待办', '待审批', '即将逾期', '高风险', '关键指标'] as const;
const entries = [
  { title: '我的待办', description: '查看任务与通知，进入关联问题继续处理。', path: '/app/my-tasks', icon: ClipboardCheck },
  { title: '问题中心', description: '查找问题并查看处理进展、报告与追溯记录。', path: '/app/problem-center', icon: ShieldAlert },
  { title: '个人账号', description: '管理个人资料、密码与登录会话。', path: '/app/account', icon: UserCircle },
] as const;

export function Workbench() {
  const { t } = useLanguage();
  return (
    <section className="qms-workbench" aria-label={t('综合工作台')}>
      <header className="qms-workbench__heading">
        <div><h1>{t('综合工作台')}</h1><p>{t('从待办开始，推进每一项质量改进。')}</p></div>
        <Link className="qms-workbench__primary" to="/app/my-tasks">{t('处理我的待办')}<ArrowRight size={16} aria-hidden="true" /></Link>
      </header>
      <section className="qms-workbench__entries" aria-labelledby="workbench-entry-title">
        <h2 id="workbench-entry-title">{t('工作入口')}</h2>
        <div>{entries.map(({ title, description, path, icon: Icon }) => (
          <Link className="qms-workbench__entry" key={path} to={path} aria-label={t(description)}>
            <Icon size={22} aria-hidden="true" /><span><strong>{t(title)}</strong><span>{t(description)}</span></span><ArrowRight size={16} aria-hidden="true" />
          </Link>
        ))}</div>
      </section>
      <section className="qms-workbench__overview" aria-labelledby="workbench-overview-title">
        <h2 id="workbench-overview-title">{t('质量概览')}</h2>
        <p>{t('统计尚未接入，当前不展示汇总数值。请从待办或问题中心查看实际记录。')}</p>
        <dl>{metrics.map((label) => <div key={label}><dt>{t(label)}</dt><dd>{t('待接入')}</dd></div>)}</dl>
      </section>
    </section>
  );
}
