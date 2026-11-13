import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { Link, MemoryRouter } from 'react-router-dom';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { NewProductIssueClosurePanel } from './NewProductIssueClosurePanel';
import { apiRequest, csrfToken } from '../../api/client';

vi.mock('../../api/client', async original => ({ ...await original<typeof import('../../api/client')>(), apiRequest: vi.fn(), csrfToken: vi.fn() }));
beforeEach(() => { vi.mocked(apiRequest).mockReset(); vi.mocked(csrfToken).mockResolvedValue('csrf'); });

it('searches trial issue assignees by partial name and preserves selected labels on a later page', async () => {
  const first = { id: 'person-a', username: 'D1411024', fullName: '张三', departmentName: '试产质量部' };
  vi.mocked(apiRequest).mockImplementation(async (path, init) => init?.method ? {} : { items: new URL(path, 'http://localhost').searchParams.get('page') === '2' ? [] : [first], total: 21, pageSize: 20 });
  const value = { items: [{ id: 'issue-1', status: 'OPEN', severity: 'MEDIUM', version: 1 }], stats: { total: 1, open: 1 } };
  const refresh = vi.fn();
  render(<MemoryRouter><UnsavedChangesProvider><NewProductIssueClosurePanel projectId="project-1" value={value} active currentUserId="handler" onRefresh={refresh} /></UnsavedChangesProvider></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: '分派' }));
  expect(screen.queryByLabelText('责任人用户 ID')).not.toBeInTheDocument();
  fireEvent.mouseDown(await screen.findByRole('combobox', { name: '试产问题责任人' }));
  fireEvent.click(await screen.findByText('张三 / 试产质量部（D1411024）', { selector: '.ant-select-item-option-content' }));
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索责任人姓名' }), { target: { value: '张' } });
  fireEvent.keyDown(screen.getByRole('searchbox', { name: '搜索责任人姓名' }), { key: 'Enter', code: 'Enter' });
  await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.some(([path]) => new URL(path, 'http://localhost').searchParams.get('search') === '张')).toBe(true));
  fireEvent.click(screen.getByLabelText('试产责任人候选分页').querySelector('[title="2"]')!);
  await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.some(([path]) => new URL(path, 'http://localhost').searchParams.get('page') === '2')).toBe(true));
  expect(screen.getByRole('combobox', { name: '试产问题责任人' }).closest('.ant-select')).toHaveTextContent('张三 / 试产质量部（D1411024）');
  await waitFor(() => expect(screen.getByRole('button', { name: /提\s*交/ })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  const write = vi.mocked(apiRequest).mock.calls.find(([, init]) => init?.method === 'PUT');
  expect(JSON.parse(String(write?.[1]?.body))).toEqual({ expectedVersion: 1, assigneeUserId: first.id });
});

it('links each formal internal 8D to its controlled workspace without exposing legacy close actions', () => {
  const value = { items: [], internalEightDIssues: [{ problemId: 'formal-problem', reportNumber: 'NP-8D-001', status: 'PENDING', severity: 'HIGH', problemVersion: 3, selectionIds: ['selection-1'], createdAt: '2026-10-27T00:00:00Z' }], stats: { total: 1, open: 0, escalated: 0, in_progress: 0, verified: 0, closed: 0, pending: 1, resolved: 0, archived: 0 } };
  render(<MemoryRouter><UnsavedChangesProvider><NewProductIssueClosurePanel projectId="project-1" value={value} active currentUserId="handler" onRefresh={vi.fn()} /></UnsavedChangesProvider></MemoryRouter>);
  expect(screen.getByRole('link', { name: 'NP-8D-001' })).toHaveAttribute('href', '/app/problem-workspace/formal-problem');
  expect(screen.queryByRole('button', { name: '分派' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '关闭' })).not.toBeInTheDocument();
});

it('protects an unfinished trial issue measure when navigating away', async () => {
  const value = { items: [{ id: 'issue-1', status: 'IN_PROGRESS', severity: 'MEDIUM', version: 1, owner_user_id: 'handler' }], stats: { total: 1, open: 0, escalated: 0, in_progress: 1, verified: 0, closed: 0 } };
  render(<MemoryRouter><UnsavedChangesProvider><NewProductIssueClosurePanel projectId="project-1" value={value} active currentUserId="handler" onRefresh={vi.fn()} /><Link to="/app/workbench">返回工作台</Link></UnsavedChangesProvider></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: '记录措施' }));
  fireEvent.change(screen.getByLabelText('整改措施'), { target: { value: '尚未提交的试产措施' } });
  fireEvent.click(screen.getByRole('link', { name: '返回工作台' }));
  await waitFor(() => expect(screen.getByText('当前草稿尚未保存，继续将放弃修改。')).toBeVisible());
  await waitFor(() => expect(screen.getByRole('button', { name: '继续编辑' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('整改措施')).toHaveValue('尚未提交的试产措施');
});
