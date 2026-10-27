import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Link, MemoryRouter } from 'react-router-dom';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { NewProductIssueClosurePanel } from './NewProductIssueClosurePanel';

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
