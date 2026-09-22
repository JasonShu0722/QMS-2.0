import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { WorkflowListPage } from './WorkflowListPage';
import * as api from './workflow-api';

vi.mock('./workflow-api', () => ({ getWorkflows: vi.fn(), getWorkflow: vi.fn(), createWorkflow: vi.fn(), initialGraph: vi.fn(), workflowPath: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); });
const renderList = () => render(<MemoryRouter><LanguageProvider><WorkflowListPage /></LanguageProvider></MemoryRouter>);
it('shows a read failure instead of an empty successful list and retries explicitly', async () => {
  vi.mocked(api.getWorkflows).mockRejectedValueOnce(new Error('raw unsafe')).mockResolvedValue({ items: [], total: 0 });
  renderList();
  expect(await screen.findByText('请求失败，请重试')).toBeVisible();
  expect(screen.queryByText('暂无流程')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(await screen.findByText('暂无流程')).toBeVisible();
});
it('lists exact historical versions without replacing their version IDs with the latest one', async () => {
  const version = { id: 'new', workflowDefinitionId: 'definition', version: 2, status: 'DRAFT' as const, publishedAt: null, publishedById: null, changeNote: null };
  const head = { id: 'definition', organizationId: 'org', code: 'QA', name: '质量流程', description: null, revision: 7 };
  vi.mocked(api.getWorkflows).mockResolvedValue({ items: [{ ...head, version, draftVersionId: 'new' }], total: 1 });
  vi.mocked(api.getWorkflow).mockResolvedValue({ ...head, versions: [version, { ...version, id: 'old', version: 1, status: 'PUBLISHED' }] });
  renderList();
  fireEvent.click(await screen.findByRole('button', { name: '版本历史 质量流程' }));
  expect(await screen.findByRole('link', { name: /版本 1/ })).toHaveAttribute('href', '/app/workflow-designer/definition/old');
  expect(screen.getByRole('link', { name: /版本 2/ })).toHaveAttribute('href', '/app/workflow-designer/definition/new');
});
