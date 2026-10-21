import { LanguageProvider } from '../../i18n/Language';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { apiRequest, csrfToken, getSession } from '../../api/client';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { AuditManagementPage } from './AuditManagementPage';
import { AuditNcClosurePanel } from './AuditNcClosurePanel';
import { AuditMobileExecution } from './AuditMobileExecution';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';

vi.mock('../../api/client', async () => ({ ...(await vi.importActual<typeof import('../../api/client')>('../../api/client')), apiRequest: vi.fn(), csrfToken: vi.fn(), getSession: vi.fn() }));
const permissions = { organizationId: 'org', permissions: ['audit-management:write', 'workflow:start'] };
const row = { id: 'row1', external_key: 'audit-a', organization_id: 'org', status: 'ACCEPTED', version: 1, source_system: 'CUSTOMER', created_at: '2026-10-01' };
const nc = { id: 'nc1', status: 'RESPONDED', assignee_user_id: 'handler', response: '已整改', severity: 'MAJOR', due_at: '2026-10-01', version: 1 };

beforeEach(() => {
  vi.mocked(csrfToken).mockReset().mockResolvedValue('csrf');
  vi.mocked(getSession).mockReset().mockResolvedValue({ userId: 'reviewer', organizationId: 'org', accountType: 'INTERNAL', landingPath: '/app/workbench' });
  vi.mocked(apiRequest).mockReset().mockImplementation(async (url) => {
    if (url.includes('/my-permissions')) return permissions;
    if (url.includes('/imports?')) return { items: [row], total: 1 };
    if (url.endsWith('/ncs')) return [nc];
    return undefined;
  });
});

it('retains an audit issue draft when drawer closing is declined', async () => {
  render(<LanguageProvider><MemoryRouter><UnsavedChangesProvider><AuditManagementPage /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>);
  fireEvent.click(await screen.findByRole('button', { name: '发起正式问题' }));
  fireEvent.change(screen.getByLabelText('实例标识'), { target: { value: 'audit-draft' } });
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /close|关闭/i }));
  await waitFor(() => expect(screen.getByText('当前草稿尚未保存，继续将放弃修改。')).toBeVisible());
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('实例标识')).toHaveValue('audit-draft');
});

it.each(['cancel', 'lookup'] as const)('protects an independent verification on %s', async (action) => {
  render(<LanguageProvider><MemoryRouter><UnsavedChangesProvider><AuditNcClosurePanel /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>);
  fireEvent.change(screen.getByLabelText('整改审核执行 ID'), { target: { value: 'exec1' } });
  fireEvent.click(screen.getByRole('button', { name: '查看整改记录' }));
  fireEvent.click(await screen.findByRole('button', { name: '验证整改' }));
  fireEvent.change(screen.getByLabelText('验证结论'), { target: { value: '未提交的独立验证' } });
  if (action === 'cancel') fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /取\s*消/ }));
  else {
    fireEvent.change(screen.getByLabelText('整改审核执行 ID'), { target: { value: 'exec2' } });
    fireEvent.click(screen.getByRole('button', { name: '查看整改记录' }));
  }
  await waitFor(() => expect(screen.getByText('当前草稿尚未保存，继续将放弃修改。')).toBeVisible());
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('验证结论')).toHaveValue('未提交的独立验证');
});

it('does not allow editing a mobile draft or opening another execution while sync is pending', async () => {
  let complete!: (value: unknown) => void;
  const pending = new Promise((resolve) => { complete = resolve; });
  const snapshot = { execution: { id: 'exec1', status: 'OPEN', version: 1 }, items: [{ key: 'P1', text: '过程受控' }], checklist: [] };
  useWorkTabsStore.getState().bindSession('INTERNAL:org:reviewer');
  localStorage.clear();
  vi.mocked(apiRequest).mockResolvedValueOnce(snapshot).mockReturnValueOnce(pending).mockResolvedValue(snapshot);
  render(<LanguageProvider><MemoryRouter><UnsavedChangesProvider><AuditMobileExecution initialExecutionId="exec1" /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>);
  fireEvent.change(await screen.findByLabelText('P1 备注'), { target: { value: '待同步' } });
  fireEvent.click(screen.getByRole('button', { name: '同步草稿' }));
  const noteDisabled = screen.getByLabelText('P1 备注').hasAttribute('disabled');
  const lookupDisabled = screen.getByRole('button', { name: '打开执行' }).hasAttribute('disabled');
  await act(async () => { complete({ id: 'saved' }); await pending; });
  expect(noteDisabled).toBe(true);
  expect(lookupDisabled).toBe(true);
});

beforeEach(() => { localStorage.clear(); vi.stubEnv('NODE_ENV', 'development'); });
afterEach(() => vi.unstubAllEnvs());
