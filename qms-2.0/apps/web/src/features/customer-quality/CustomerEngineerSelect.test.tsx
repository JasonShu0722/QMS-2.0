import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiRequest } from '../../api/client';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { CustomerEngineerSelect } from './CustomerEngineerSelect';

vi.mock('../../api/client', async original => ({ ...await original<typeof import('../../api/client')>(), apiRequest: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); useWorkTabsStore.getState().bindSession('people-test'); });
afterEach(() => useWorkTabsStore.getState().reset());

it('searches partial names over the authorized server scope and preserves selected appointment labels across pages', async () => {
  const person = { assignmentId: 'assignment-a', userId: 'user', username: 'D1411024', fullName: '张三', departmentName: '质量保证部', positionName: '质量工程师' };
  vi.mocked(apiRequest).mockResolvedValue({ items: [], total: 41, limit: 20, offset: 0 });
  render(<CustomerEngineerSelect label="接任质量工程师" value={person.assignmentId} candidates={[person]} organizationId="org" onChange={vi.fn()} onDenied={vi.fn()}><option value="">请选择</option></CustomerEngineerSelect>);
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索接任质量工程师' }), { target: { value: '张' } });
  fireEvent.keyDown(screen.getByRole('searchbox', { name: '搜索接任质量工程师' }), { key: 'Enter', code: 'Enter' });
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/customer-quality/ledger/candidates?search=%E5%BC%A0&limit=20&offset=0&organizationId=org', expect.anything()));
  expect(screen.getByRole('option', { name: '张三 / 质量保证部（D1411024） · 质量工程师' })).toHaveValue(person.assignmentId);
  fireEvent.click(screen.getByTitle('2'));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/customer-quality/ledger/candidates?search=%E5%BC%A0&limit=20&offset=20&organizationId=org', expect.anything()));
});

it('does not revive a pending candidate result after an identity changes A to B to A before rendering', async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(apiRequest).mockImplementation(() => new Promise(done => { resolve = done; }));
  render(<CustomerEngineerSelect label="接任质量工程师" value="" candidates={[]} organizationId="org" onChange={vi.fn()} onDenied={vi.fn()}><option value="">请选择</option></CustomerEngineerSelect>);
  fireEvent.keyDown(screen.getByRole('searchbox', { name: '搜索接任质量工程师' }), { key: 'Enter', code: 'Enter' });
  await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1));
  act(() => { useWorkTabsStore.getState().bindSession('other'); useWorkTabsStore.getState().bindSession('people-test'); });
  await act(async () => resolve({ items: [{ assignmentId: 'private', userId: 'private', username: 'private', fullName: '旧会话人员', departmentName: '旧部门' }], total: 1 }));
  expect(screen.queryByRole('option', { name: /旧会话人员/ })).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: '接任质量工程师' })).toBeDisabled();
});
