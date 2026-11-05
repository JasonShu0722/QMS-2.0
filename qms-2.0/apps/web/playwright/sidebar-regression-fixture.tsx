import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { components } from '@qms/contracts';
import { AuthenticatedRoute } from '../src/features/auth/AuthenticatedRoute';
import { LanguageProvider } from '../src/i18n/Language';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { InternalLayout } from '../src/layouts/InternalLayout';
import { ConsoleLayout } from '../src/console/ConsoleLayout';
import { useNavigationBusy, useUnsavedChanges } from '../src/layouts/UnsavedChanges';
import { publishSessionSignal } from '../src/features/auth/session-invalidation';
import '../src/styles/global.css';

const organization = { id: 'a', code: 'DEMO', name: '模拟组织', type: 'INTERNAL', status: 'ACTIVE', configurationRequired: false } as const;
let actor = 'demo-actor';
let holdSession = false;
let holdContext = false;
const pendingSession: (() => void)[] = [];
const pendingContext: (() => void)[] = [];
const response = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const moduleKeys = ['users', 'organizations', 'supplier-accounts', 'reconfiguration', 'problem-reconfiguration', 'master-data', 'configuration', 'workflows', 'audit', 'outbox', 'api-monitoring', 'data-exchanges', 'services'] as const;
function context(): components['schemas']['ConsoleContextDto'] {
  return {
    actor: { id: actor, accountType: 'INTERNAL', homeOrganization: organization }, targetOrganization: organization, organizations: [organization], hasPlatformAdministrator: false,
    modules: moduleKeys.map(key => ({ key, scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: organization.id, permissions: ['supplier-quality:profiles:read', 'customer-quality:complaints:read', 'material-master:read', 'component-project:read', 'console:api:read', 'console:exchanges:read', 'console:services:read'] })),
  };
}
const originalFetch = window.fetch;
window.fetch = async (input, init) => {
  const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!path.startsWith('/api/v1/')) return originalFetch(input, init);
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  if (method.toUpperCase() !== 'GET') return new Response(JSON.stringify({ code: 'FIXTURE_READ_ONLY', message: 'This fixture only simulates reads.' }), { status: 405, headers: { 'content-type': 'application/json' } });
  if (path.endsWith('/auth/session')) {
    if (holdSession) { holdSession = false; await new Promise<void>(resolve => pendingSession.push(resolve)); }
    return response({ user: { id: actor, organizationId: organization.id, accountType: 'INTERNAL' }, landingPath: '/app/workbench', securityState: 'AUTHENTICATED' });
  }
  if (path.startsWith('/api/v1/admin/console/context')) {
    if (holdContext) { holdContext = false; await new Promise<void>(resolve => pendingContext.push(resolve)); }
    return response(context());
  }
  if (path.includes('my-permissions')) return response({ permissions: ['supplier-barcode:scan'] });
  if (path.includes('announcements')) return response({ items: [], total: 0, page: 1, pageSize: 20 });
  return response({ items: [], total: 0, page: 1, pageSize: 20, permissions: [] });
};

function DraftProbe() {
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  useUnsavedChanges(dirty); useNavigationBusy(busy);
  return <section><p>正式外壳与安全gate；内容及身份均为模拟，不连接业务API。</p><label><input type="checkbox" checked={dirty} onChange={event => setDirty(event.target.checked)} />模拟未保存</label><label><input type="checkbox" checked={busy} onChange={event => setBusy(event.target.checked)} />模拟提交中</label></section>;
}
function Controls() {
  const [sample, setSample] = useState('');
  useEffect(() => {
    const timer = setInterval(() => {
      const element = document.querySelector<HTMLElement>('.qms-primary-navigation, .qms-console-sidebar');
      setSample(JSON.stringify({ path: document.querySelector('[aria-current="page"]')?.getAttribute('href'), scrollTop: element?.scrollTop, clientHeight: element?.clientHeight, scrollHeight: element?.scrollHeight, windowScrollY: window.scrollY, activeElement: document.activeElement?.tagName, pendingSession: pendingSession.length, pendingContext: pendingContext.length }));
    }, 100);
    return () => clearInterval(timer);
  }, []);
  return <div style={{ position: 'fixed', right: 16, bottom: 12, width: 490, maxWidth: 'calc(100vw - 32px)', padding: 8, background: '#fff', border: '1px solid #999', zIndex: 100 }}>
    <strong>侧栏模拟测试（非生产）</strong> <a href="?portal=business">业务</a> <a href="?portal=console">控制台</a>
    <div><button onClick={() => { holdSession = true; holdContext = true; }}>延迟下一次双重验证</button><button onClick={() => pendingSession.splice(0).forEach(resolve => resolve())}>完成模拟会话验证</button><button onClick={() => pendingContext.splice(0).forEach(resolve => resolve())}>完成模拟管理验证</button><button onClick={() => { actor = actor === 'demo-actor' ? 'other-actor' : 'demo-actor'; publishSessionSignal('invalidate'); }}>切换模拟身份</button></div>
    <output aria-label="侧栏采样">{sample}</output>
  </div>;
}
const portal = new URLSearchParams(window.location.search).get('portal') === 'console' ? 'console' : 'business';
const router = createMemoryRouter([
  { path: '/console/*', element: <AuthenticatedRoute accountType="INTERNAL"><ConsoleLayout><DraftProbe /></ConsoleLayout></AuthenticatedRoute> },
  { path: '/app/*', element: <AuthenticatedRoute accountType="INTERNAL"><InternalLayout /></AuthenticatedRoute> },
], { initialEntries: [portal === 'console' ? '/console/users' : '/app/site-scanning'] });
createRoot(document.getElementById('root')!).render(<LanguageProvider><ThemeProvider><Controls /><RouterProvider router={router} /></ThemeProvider></LanguageProvider>);
