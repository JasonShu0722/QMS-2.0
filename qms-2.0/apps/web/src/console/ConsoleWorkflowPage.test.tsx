import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, csrfToken } from '../api/client';
import { LanguageProvider } from '../i18n/Language';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';
import type { ConsoleContext } from './console-navigation';
import { ConsoleWorkflowPage } from './ConsoleWorkflowPage';

const verified = vi.hoisted(() => ({ context: {} as ConsoleContext, invalidate: vi.fn() }));
vi.mock('./ConsoleLayout', () => ({ useConsoleContext: () => verified }));
vi.mock('../api/client', async original => ({ ...await original<typeof import('../api/client')>(), apiRequest: vi.fn(), csrfToken: vi.fn() }));

const endpoint = '/api/v1/process-quality/ledger-workflow-configuration';
const home = { id: '11111111-1111-4111-8111-111111111111', code: 'A', name: '会话组织A', type: 'INTERNAL', status: 'ACTIVE', configurationRequired: false } as const;
const target = { ...home, id: '22222222-2222-4222-8222-222222222222', name: '管理目标B' };
const boards = ['REGISTRATION', 'ANALYSIS', 'RESPONSIBILITY', 'DISPOSITION', 'CLOSURE'] as const;
const configuration = {
  version: 4,
  boards: boards.map(board => ({ board, positionIds: board === 'ANALYSIS' ? ['analyst'] : [] })),
  positions: [{ id: 'analyst', name: '分析员' }, { id: 'reviewer', name: '复核员' }],
};

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  useWorkTabsStore.getState().reset();
  useWorkTabsStore.getState().bindSession(`INTERNAL:${home.id}:actor`);
  verified.context = {
    actor: { id: 'actor', accountType: 'INTERNAL', homeOrganization: home }, targetOrganization: target,
    organizations: [home, target], hasPlatformAdministrator: true,
    modules: [{ key: 'workflows', scope: 'SESSION_HOME', coverage: 'ORGANIZATION', organizationId: home.id, permissions: ['workflow:manage'] }],
  };
  vi.mocked(csrfToken).mockResolvedValue('csrf');
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (path !== endpoint) throw new Error(`Unexpected endpoint ${path}`);
    return init?.method === 'PUT' ? { ...configuration, version: 5, boards: JSON.parse(String(init.body)).boards } : configuration;
  });
});

function view(path = `/console/workflows?organizationId=${target.id}`) {
  return render(<MemoryRouter initialEntries={[path]}><LanguageProvider><ConsoleWorkflowPage /></LanguageProvider></MemoryRouter>);
}

async function openConfiguration() {
  fireEvent.click(screen.getByRole('button', { name: '制程不合格台账' }));
  return screen.findByRole('combobox', { name: '分析进度维护' });
}

async function addReviewer() {
  const analysis = await openConfiguration();
  fireEvent.mouseDown(analysis);
  fireEvent.click(await screen.findByText('复核员'));
}

it('loads the home organization configuration on demand and saves all five boards with multiple positions', async () => {
  view();
  expect(apiRequest).not.toHaveBeenCalled();
  expect(screen.queryByText(/8D流程绑定|受控流程列表/)).not.toBeInTheDocument();
  await addReviewer();
  expect(screen.getAllByRole('combobox').map(control => control.getAttribute('aria-label'))).toEqual([
    '表单登记', '分析进度维护', '责任判定', '处置维护', '台账关闭判定',
  ]);
  expect(screen.getByText('会话组织A')).toBeVisible();
  const save = screen.getByRole('button', { name: '保存配置' });
  fireEvent.click(save);
  await waitFor(() => expect(save).toBeDisabled());
  expect(vi.mocked(apiRequest).mock.calls.map(([path]) => path)).toEqual([endpoint, endpoint]);
  expect(vi.mocked(apiRequest).mock.calls[1][1]).toMatchObject({
    method: 'PUT', headers: { 'x-csrf-token': 'csrf', 'Idempotency-Key': expect.any(String) },
  });
  expect(JSON.parse(String(vi.mocked(apiRequest).mock.calls[1][1]?.body))).toEqual({
    expectedVersion: 4,
    boards: boards.map(board => ({ board, positionIds: board === 'ANALYSIS' ? ['analyst', 'reviewer'] : [] })),
  });
});

it('denies users without the workflow management capability before requesting configuration', () => {
  verified.context.hasPlatformAdministrator = false;
  verified.context.modules[0].permissions = ['configuration:read'];
  view();
  expect(screen.getByRole('alert')).toHaveTextContent('无权访问此管理模块');
  expect(apiRequest).not.toHaveBeenCalled();
});

it('keeps edits on a version conflict and requires a reload before saving again', async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce(configuration).mockRejectedValueOnce(new ApiError({ code: 'CONCURRENCY_CONFLICT', message: '' }, 409));
  view();
  await addReviewer();
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('配置版本已变化');
  expect(screen.getByRole('button', { name: '保存配置' })).toBeDisabled();
  expect(screen.getByText('复核员', { selector: '.ant-select-selection-item-content' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '重新读取配置' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(3));
});

it('invalidates the verified console and clears position data after a denied write', async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce(configuration).mockRejectedValueOnce(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: '' }, 403));
  view();
  await addReviewer();
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await waitFor(() => expect(verified.invalidate).toHaveBeenCalledOnce());
  expect(screen.queryByText('分析员')).not.toBeInTheDocument();
});

it('explains first-save behavior and allows explicitly saving empty boards', async () => {
  const empty = { ...configuration, version: 0, boards: boards.map(board => ({ board, positionIds: [] })) };
  vi.mocked(apiRequest).mockResolvedValueOnce(empty).mockResolvedValueOnce({ ...empty, version: 1 });
  view();
  await openConfiguration();
  expect(screen.getByText(/首次保存前，台账沿用现有业务权限/)).toHaveTextContent('保存后，未选择岗位的板块无法维护');
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(2));
  expect(JSON.parse(String(vi.mocked(apiRequest).mock.calls[1][1]?.body))).toEqual({ expectedVersion: 0, boards: empty.boards });
  await waitFor(() => expect(screen.queryByText(/首次保存前，台账沿用现有业务权限/)).not.toBeInTheDocument());
});
