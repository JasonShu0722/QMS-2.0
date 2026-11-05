import '../src/styles/global.css';
import '../src/layouts/shell.css';
import { Button } from 'antd';
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/Language';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { ConsoleTheme } from '../src/console/ConsoleTheme';
import { ConfigurationAdministration } from '../src/features/governance/ConfigurationAdministration';
import { OrganizationWorkspace } from '../src/features/governance/OrganizationWorkspace';
import { StructureAdministration } from '../src/features/governance/StructureAdministration';
import type { AdminOrganization } from '../src/features/admin/admin';
import { UnsavedChangesProvider } from '../src/layouts/UnsavedChanges';

const query = new URLSearchParams(location.search);
const host = query.get('host') === 'console' ? 'console' : 'business';
const page = query.get('page') ?? 'configuration';
const organization: AdminOrganization = { id: 'layout-fixture-org', code: 'LAYOUT', name: '布局验证组织', type: 'INTERNAL', permissions: ['configuration:read', 'configuration:manage', 'organization:read', 'organization:structure:read', 'organization:structure:manage'] };
const departments = [{ id: 'department-a', organizationId: organization.id, parentId: null, code: 'QUALITY', name: '质量保证部门', status: 'ACTIVE', version: 1 }];
const categories = [{ id: 'category-a', code: 'ENGINEER', name: '质量工程师', status: 'ACTIVE', sortOrder: 0, version: 1 }];
const requests: string[] = [];
window.fetch = async (input, init) => {
  const path = String(input);
  requests.push(path);
  if (init?.method && init.method !== 'GET') throw new Error(`Fixture rejects writes: ${path}`);
  let body: unknown;
  if (path.startsWith('/api/v1/admin/configuration/settings?')) body = { notificationLocale: 'zh-CN', exportRetentionMinutes: 60, version: 1 };
  else if (path.startsWith('/api/v1/admin/configuration/notification-rules?')) body = [{ kind: 'TASK_ASSIGNED', enabled: true, subjectTemplate: '任务标题', bodyTemplate: '任务正文', version: 1 }];
  else if (path.startsWith('/api/v1/admin/configuration/position-categories?')) body = categories;
  else if (path.startsWith('/api/v1/organizations/tree?')) body = [{ ...organization, parentId: null, status: 'ACTIVE', version: 1 }];
  else if (path.startsWith(`/api/v1/organizations/${organization.id}/departments?`)) body = departments;
  else if (path.startsWith(`/api/v1/organizations/${organization.id}/positions?`)) body = [{ id: 'position-a', organizationId: organization.id, departmentId: null, categoryId: 'category-a', code: 'SQE', name: '供应商质量工程师', status: 'ACTIVE', version: 1 }];
  else throw new Error(`Fixture rejects unknown request: ${path}`);
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
};

function Fixture() {
  const panel = useRef<HTMLDivElement>(null);
  const output = useRef<HTMLOutputElement>(null);
  const [constrained, setConstrained] = useState(false);
  const [sampling, setSampling] = useState(0);
  useEffect(() => {
    const values: unknown[] = [];
    let frame = 0;
    let waiting = 0;
    const measure = (element: Element) => ({ className: element.className, width: element.getBoundingClientRect().width, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth });
    const sample = () => {
      const target = panel.current;
      if (!target) return;
      if (!target.querySelector('tbody tr[data-row-key]') || target.querySelector('.ant-spin-spinning')) {
        if (++waiting < 600) frame = requestAnimationFrame(sample);
        return;
      }
      values.push({ frame: values.length, host: measure(target), nodes: Array.from(target.querySelectorAll('.governance-panel,.ant-card,.ant-tabs,.organization-workspace,.organization-workspace-context,.ant-table-container,.ant-table-content,table')).map(measure), columns: Array.from(target.querySelectorAll('col')).map(element => ({ width: element.style.width, measured: element.getBoundingClientRect().width })), measures: Array.from(target.querySelectorAll('.ant-table-measure-row td')).map(measure) });
      if (output.current) output.current.textContent = JSON.stringify({ host, page, constrained, sampling, requests, frames: values });
      if (values.length < 10) frame = requestAnimationFrame(sample);
    };
    frame = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(frame);
  }, [constrained, sampling]);
  const width = Number(query.get('width') ?? 900);
  const pageContent = <div ref={panel} className={host === 'console' ? 'qms-console-content' : 'qms-content'} style={{ width, maxWidth: '100%', boxSizing: 'border-box' }}>
    {page === 'configuration' ? <ConfigurationAdministration organization={organization} /> : page === 'structure' ? <StructureAdministration organization={organization} /> : <OrganizationWorkspace organization={organization} organizations={[organization]} onSelectOrganization={() => {}} />}
  </div>;
  const content = <MemoryRouter><UnsavedChangesProvider>{host === 'console'
    ? <div className="qms-console-layout" style={{ width: width + 240, maxWidth: '100%' }}><aside aria-label="模拟导航" /><div className="qms-console-body">{pageContent}</div></div>
    : <div className="qms-shell internal-shell" style={{ width: width + 240, maxWidth: '100%' }}><div className="qms-main">{pageContent}</div></div>}
  </UnsavedChangesProvider></MemoryRouter>;
  return <LanguageProvider><main>
    <h1>布局回归验证：仅模拟数据，不连接业务API</h1>
    <Button onClick={() => setConstrained(value => !value)}>切换约束实验：{constrained ? '启用' : '原样'}</Button>
    <Button onClick={() => setSampling(value => value + 1)}>重新采样</Button>
    {constrained && <style>{'.governance-panel { grid-template-columns: minmax(0, 1fr); }'}</style>}
    {host === 'console' ? <ConsoleTheme>{content}</ConsoleTheme> : <ThemeProvider>{content}</ThemeProvider>}
    <output ref={output} aria-label="布局连续采样" style={{ display: 'block', overflowWrap: 'anywhere' }} />
  </main></LanguageProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
