import { Layout, Typography } from 'antd';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { activeInternalDomain, internalNavigation } from '../features/navigation/navigation';
import { WorkTabs } from '../work-tabs/WorkTabs';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';
import { Workbench } from '../workbench/Workbench';
import { ProblemCenterPage } from '../features/problem-center/ProblemCenterPage';
import { MyTasksPage } from '../features/tasks/MyTasksPage';

const { Content, Sider } = Layout;

function EmptyDomain({ title }: { title: string }) {
  return (
    <section className="empty-domain">
      <Typography.Title level={2}>{title}</Typography.Title>
      <Typography.Paragraph type="secondary">基础入口已就绪，业务功能将在后续阶段接入。</Typography.Paragraph>
    </section>
  );
}

export function InternalLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const openTab = useWorkTabsStore((state) => state.openTab);
  const isWorkbench = location.pathname === '/app/workbench' || location.pathname === '/app';
  const active = activeInternalDomain(location.pathname);
  const collapsed = !isWorkbench;

  function openNavigationTab(item: { label: string; path: string }) {
    openTab({ id: item.path, title: item.label, path: item.path });
    navigate(item.path);
  }

  return (
    <Layout className="app-shell">
      <Sider className={collapsed ? 'domain-sider collapsed' : 'domain-sider'} width={232} collapsedWidth={72}>
        <Link className="brand" to="/app/workbench">
          QMS 2.0
        </Link>
        <nav aria-label={collapsed ? '内部领域图标导航' : '内部领域导航'} className="domain-nav">
          {internalNavigation.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                className={item.path === active?.path ? 'nav-item active' : 'nav-item'}
                key={item.path}
                onClick={(event) => {
                  event.preventDefault();
                  openNavigationTab(item);
                }}
                to={item.path}
              >
                <Icon size={18} />
                {!collapsed ? <span>{item.label}</span> : <span className="sr-only">{item.label}</span>}
              </Link>
            );
          })}
        </nav>
      </Sider>
      <Layout>
        <Content className="content-shell">
          <WorkTabs />
          {!collapsed ? <Workbench /> : null}
          {active ? (
            <aside className="context-panel">
              <Typography.Title level={3}>{active.label}上下文</Typography.Title>
              <nav aria-label={`${active.label}上下文菜单`}>
                {active.context?.map((entry) => (
                  <Link key={entry} to={`${active.path}/${entry.toLowerCase()}`}>
                    {entry}
                  </Link>
                ))}
              </nav>
            </aside>
          ) : null}
          {collapsed && active ? <EmptyDomain title={active.label} /> : null}
          {location.pathname.startsWith('/app/problem-center') ? <ProblemCenterPage /> : null}
          {location.pathname.startsWith('/app/my-tasks') ? <MyTasksPage /> : null}
        </Content>
      </Layout>
    </Layout>
  );
}
