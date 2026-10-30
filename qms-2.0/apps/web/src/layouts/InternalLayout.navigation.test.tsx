import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InternalLayout } from './InternalLayout';
import { internalDomains } from '../features/navigation/navigation';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';
import { LanguageProvider } from '../i18n/Language';

vi.mock('../workbench/Workbench', () => ({ Workbench: () => <div>Workbench</div> }));
vi.mock('../features/problem-center/ProblemCenterPage', () => ({ ProblemCenterPage: () => <div>Problem ledger</div> }));
vi.mock('../features/problem-workspace/ProblemWorkspacePage', () => ({ ProblemWorkspacePage: () => <div>Problem detail</div> }));
vi.mock('../features/supplier-quality/SupplierQualityPage', () => ({ SupplierQualityPage: () => <div>Supplier ledger</div> }));
vi.mock('../features/supplier-pcn/SupplierPcnPage', () => ({ SupplierPcnPage: () => <div>PCN ledger</div> }));
vi.mock('../features/customer-quality/CustomerQualityPage', () => ({ CustomerQualityPage: () => <div>Customer ledger</div> }));
vi.mock('../layouts/AnnouncementReminder', () => ({ AnnouncementReminder: () => null }));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useWorkTabsStore.getState().reset();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [], permissions: [] }), { headers: { 'content-type': 'application/json' } })));
});
afterEach(() => vi.unstubAllGlobals());

function RouteControls() {
  const location = useLocation();
  const navigate = useNavigate();
  return <>
    <output aria-label="current path">{location.pathname}{location.search}</output>
    <button onClick={() => navigate('/app/supplier-pcn?organizationId=org-1')}>Direct PCN</button>
    <button onClick={() => navigate(-1)}>History back</button>
  </>;
}
function mount(path = '/app/workbench') {
  return render(<MemoryRouter initialEntries={[path]}><LanguageProvider><InternalLayout /><RouteControls /></LanguageProvider></MemoryRouter>);
}
function desktop() { return within(screen.getByRole('navigation', { name: '内部领域导航' })); }

it('uses disclosure buttons without navigating and retains every real leaf href including former defaults', () => {
  mount();
  const navigation = desktop();
  for (const domain of internalDomains) {
    const parent = navigation.getByRole('button', { name: domain.label });
    expect(parent).toHaveAttribute('aria-expanded', 'false');
    expect(parent).not.toHaveAttribute('href');
    const entries = document.getElementById(parent.getAttribute('aria-controls')!);
    expect(entries).toHaveAttribute('hidden');
    fireEvent.click(parent);
    expect(parent).toHaveAttribute('aria-expanded', 'true');
    expect(entries).not.toHaveAttribute('hidden');
    const context = within(navigation.getByRole('navigation', { name: `${domain.label} 上下文菜单` }));
    for (const entry of domain.children) expect(context.getByRole('link', { name: entry.label })).toHaveAttribute('href', entry.path);
    expect(screen.getByLabelText('current path')).toHaveTextContent('/app/workbench');
  }
  expect(useWorkTabsStore.getState().tabs).toEqual([]);
  expect(navigation.getAllByRole('button', { expanded: true })).toHaveLength(internalDomains.length);
});

it('supports Enter and Space on parents, then keyboard activation of an actual leaf', async () => {
  mount();
  const user = userEvent.setup();
  const parent = desktop().getByRole('button', { name: '供应商质量' });
  parent.focus();
  await user.keyboard('{Enter}');
  expect(parent).toHaveFocus();
  expect(parent).toHaveAttribute('aria-expanded', 'true');
  await user.keyboard(' ');
  expect(parent).toHaveAttribute('aria-expanded', 'false');
  await user.keyboard(' ');
  await user.tab();
  expect(screen.getByRole('link', { name: '供应商问题台账' })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(screen.getByLabelText('current path')).toHaveTextContent('/app/supplier-quality');
});

it('remembers multiple open domains across leaves, work tabs, direct navigation and history', () => {
  mount('/app/problem-center');
  fireEvent.click(desktop().getByRole('button', { name: '供应商质量' }));
  fireEvent.click(desktop().getByRole('link', { name: 'PCN 变更' }));
  fireEvent.click(desktop().getByRole('button', { name: '问题中心' }));
  expect(desktop().getByRole('button', { name: '问题中心' })).toHaveAttribute('aria-expanded', 'false');
  const tabs = within(screen.getByRole('navigation', { name: '工作标签' }));
  fireEvent.click(tabs.getByRole('link', { name: '问题管理面板' }));
  expect(desktop().getByRole('button', { name: '问题中心' })).toHaveAttribute('aria-expanded', 'true');
  expect(desktop().getByRole('button', { name: '供应商质量' })).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(desktop().getByRole('button', { name: '供应商质量' }));
  fireEvent.click(screen.getByRole('button', { name: 'Direct PCN' }));
  expect(desktop().getByRole('button', { name: '供应商质量' })).toHaveAttribute('aria-expanded', 'true');
  expect(desktop().getByRole('link', { name: 'PCN 变更' })).toHaveAttribute('aria-current', 'page');
  fireEvent.click(desktop().getByRole('button', { name: '问题中心' }));
  fireEvent.click(screen.getByRole('button', { name: 'History back' }));
  expect(desktop().getByRole('button', { name: '问题中心' })).toHaveAttribute('aria-expanded', 'true');
});

it.each([
  ['/app/supplier-quality/eight-d/11111111-1111-4111-8111-111111111111', '供应商质量', '供应商问题台账'],
  ['/app/customer-quality/11111111-1111-4111-8111-111111111111', '客户质量', '客户质量'],
  ['/app/problem-workspace/11111111-1111-4111-8111-111111111111', '问题中心', '问题管理面板'],
])('opens the ledger ancestor on detail deep link %s', (path, domain, ledger) => {
  mount(path);
  expect(desktop().getByRole('button', { name: domain })).toHaveAttribute('aria-expanded', 'true');
  const context = within(desktop().getByRole('navigation', { name: `${domain} 上下文菜单` }));
  expect(context.getByRole('link', { name: ledger })).toHaveAttribute('aria-current', 'page');
  expect(context.getAllByRole('link')).toHaveLength(internalDomains.find(item => item.label === domain)!.children.length);
});

it('retains expansion after whole-menu collapse and opens a collapsed icon domain without navigating', () => {
  mount('/app/problem-center');
  fireEvent.click(screen.getByRole('button', { name: '收起业务菜单' }));
  const rail = within(screen.getByRole('navigation', { name: '内部领域图标导航' }));
  expect(rail.queryByRole('link', { name: '问题管理面板' })).not.toBeInTheDocument();
  expect(rail.getByRole('button', { name: '问题中心' })).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(screen.getByRole('button', { name: '展开业务菜单' }));
  expect(desktop().getByRole('button', { name: '问题中心' })).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(screen.getByRole('button', { name: '收起业务菜单' }));
  fireEvent.click(screen.getByRole('button', { name: '供应商质量' }));
  expect(desktop().getByRole('button', { name: '供应商质量' })).toHaveAttribute('aria-expanded', 'true');
  expect(desktop().getByRole('link', { name: '供应商问题台账' })).toHaveAttribute('href', '/app/supplier-quality');
  expect(screen.getByLabelText('current path')).toHaveTextContent('/app/problem-center');
});

it('shares disclosure state with the dismissible mobile Drawer and closes it only after leaf navigation', async () => {
  mount('/app/problem-center');
  fireEvent.click(screen.getByRole('button', { name: '收起业务菜单' }));
  fireEvent.click(screen.getByRole('button', { name: '打开导航' }));
  const drawer = within(screen.getByRole('dialog', { name: '业务导航' }));
  expect(drawer.getByRole('button', { name: '问题中心' })).toHaveAttribute('aria-expanded', 'true');
  const supplier = drawer.getByRole('button', { name: '供应商质量' });
  fireEvent.click(supplier);
  expect(supplier).toHaveAttribute('aria-expanded', 'true');
  expect(drawer.getByRole('button', { name: '问题中心' })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByLabelText('current path')).toHaveTextContent('/app/problem-center');
  fireEvent.click(drawer.getByRole('button', { name: '关闭' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '业务导航' })).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: '打开导航' }));
  const reopened = within(screen.getByRole('dialog', { name: '业务导航' }));
  expect(reopened.getByRole('button', { name: '供应商质量' })).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(reopened.getByRole('link', { name: 'PCN 变更' }));
  expect(screen.getByLabelText('current path')).toHaveTextContent('/app/supplier-pcn');
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '业务导航' })).not.toBeInTheDocument());
});

it('resets disclosure memory when the bound session changes', () => {
  mount();
  fireEvent.click(desktop().getByRole('button', { name: '供应商质量' }));
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:org:next-user'));
  expect(desktop().getByRole('button', { name: '供应商质量' })).toHaveAttribute('aria-expanded', 'false');
});
