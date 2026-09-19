import { Layout, Typography } from 'antd';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supplierNavigation } from '../features/navigation/navigation';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';
import { AccountCenterPage } from '../features/account/AccountCenterPage';

const { Content, Sider } = Layout;

export function SupplierLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const openTab = useWorkTabsStore((state) => state.openTab);
  const active = supplierNavigation.find((item) => location.pathname.startsWith(item.path)) ?? supplierNavigation[0];

  function openNavigationTab(item: { label: string; path: string }) {
    openTab({ id: item.path, title: item.label, path: item.path });
    navigate(item.path);
  }

  return (
    <Layout className="app-shell supplier-shell">
      <Sider className="domain-sider supplier" width={212}>
        <Link className="brand" to="/supplier/inbox">
          供应商门户
        </Link>
        <nav aria-label="供应商导航" className="domain-nav">
          {supplierNavigation.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                className={item.path === active.path ? 'nav-item active' : 'nav-item'}
                key={item.path}
                onClick={(event) => {
                  event.preventDefault();
                  openNavigationTab(item);
                }}
                to={item.path}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </Sider>
      <Content className="content-shell">
        {location.pathname.startsWith('/supplier/account') ? <AccountCenterPage /> : <section className="empty-domain">
          <Typography.Title level={2}>{active.label}</Typography.Title>
          <Typography.Paragraph type="secondary">供应商协作基础入口已就绪，暂无业务数据。</Typography.Paragraph>
        </section>}
      </Content>
    </Layout>
  );
}
