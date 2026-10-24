import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import type { ReactNode } from 'react';
import { fireEvent, render as testingRender, screen, waitFor, within } from '@testing-library/react';
import baseUserEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import type { AdminOrganization } from '../admin/admin';
import { OrganizationAdministration } from './OrganizationAdministration';
import { StructureAdministration } from './StructureAdministration';
import type { Department, Organization, Position } from './governance';

const render = (children: ReactNode) => testingRender(<ConfigProvider locale={zhCN} theme={{ token: { motion: false } }}>{children}</ConfigProvider>);

const organization: AdminOrganization = { id: 'org-a', code: 'A', name: '甲组织', type: 'INTERNAL', permissions: ['organization:read', 'organization:manage', 'organization:structure:read', 'organization:structure:manage'] };
const record: Organization = { id: organization.id, code: organization.code, name: organization.name, type: 'INTERNAL', parentId: null, status: 'ACTIVE', version: 2 };
const department: Department = { id: 'dept-a', organizationId: organization.id, code: 'QA', name: '质量部', parentId: null, status: 'ACTIVE', version: 3 };
const position: Position = { id: 'position-a', organizationId: organization.id, code: 'SQE', name: '质量工程师', departmentId: department.id, categoryId: null, status: 'ACTIVE', version: 4 };
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
beforeEach(() => { localStorage.clear(); // rc-component uses one shared test-id in test mode; keep dialog and Select IDs distinct.
  vi.stubEnv('NODE_ENV', 'development'); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it.each(['organization', 'department', 'position'] as const)('guards the %s edit cancel and Esc paths without writing or losing the draft on continue', async (kind) => {
  const user = baseUserEvent.setup();
  const writes: RequestInit[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (init.method && init.method !== 'GET') writes.push(init);
    return json(path.includes('/tree?') ? [record] : path.includes('/departments?') ? [department] : path.includes('/positions?') ? [position] : []);
  }));
  render(<MemoryRouter><UnsavedChangesProvider>{kind === 'organization'
    ? <OrganizationAdministration organization={organization} organizations={[organization]} items={[record]} />
    : <StructureAdministration organization={organization} />}</UnsavedChangesProvider></MemoryRouter>);
  if (kind === 'position') await user.click(screen.getByRole('tab', { name: '岗位' }));
  await user.click(await screen.findByRole('button', { name: /^编\s*辑$/ }));
  const editor = screen.getByRole('dialog');
  fireEvent.change(within(editor).getByLabelText('名称'), { target: { value: '未保存名称' } });
  await user.click(within(editor).getByRole('button', { name: /^取\s*消$/ }));
  await screen.findByText('当前草稿尚未保存，继续将放弃修改。');
  await user.click(screen.getByRole('button', { name: '继续编辑' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' })).not.toBeInTheDocument());
  expect(within(editor).getByLabelText('名称')).toHaveValue('未保存名称');
  fireEvent.keyDown(editor, { key: 'Escape', code: 'Escape', keyCode: 27 });
  await user.click(await screen.findByRole('button', { name: /^放弃修改(?:并关闭)?$/ }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await user.click(screen.getByRole('button', { name: /^编\s*辑$/ }));
  expect(screen.getByLabelText('名称')).toHaveValue(kind === 'organization' ? record.name : kind === 'department' ? department.name : position.name);
  expect(writes).toEqual([]);
}, 30000);
