import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { WorkflowDesignerPage } from './WorkflowDesignerPage';
import * as api from './workflow-api';

vi.mock('./workflow-api', () => ({ getWorkflowVersion: vi.fn(), getWorkflowOptions: vi.fn() }));
vi.mock('./WorkflowCanvas', () => ({ WorkflowCanvas: () => null }));
vi.mock('./WorkflowProperties', () => ({ WorkflowProperties: () => null }));
vi.mock('./WorkflowClosurePreview', () => ({ WorkflowClosurePreview: ({ policy, disabled }: { policy: string; disabled?: boolean }) => <button disabled={disabled}>职责配置预览 {policy}</button> }));
beforeEach(() => {
  vi.mocked(api.getWorkflowOptions).mockResolvedValue({ users: [], roles: [], permissions: [] });
  vi.mocked(api.getWorkflowVersion).mockResolvedValue({ id: 'definition', organizationId: 'org', code: 'C', name: '关闭流程', description: null, revision: 1,
    version: { id: 'version', workflowDefinitionId: 'definition', version: 1, status: 'DRAFT', publishedAt: null, publishedById: null, changeNote: null,
      structureSnapshot: { nodes: [{ id: 'handle', type: 'ACTION', name: '负责人处理' }, { id: 'review', type: 'APPROVAL', name: '关闭审核', config: { closureReview: { schemaVersion: 1, policy: 'INTERNAL', domainCode: 'process' } } }], transitions: [] } } });
});
it('shows the read-only configuration preview only for the selected controlled closure gate', async () => {
  render(<MemoryRouter><LanguageProvider><WorkflowDesignerPage definitionId="definition" versionId="version" /></LanguageProvider></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: '编辑节点 关闭审核' }));
  expect(await screen.findByRole('button', { name: '职责配置预览 INTERNAL' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '编辑节点 负责人处理' }));
  expect(screen.queryByRole('button', { name: '职责配置预览 INTERNAL' })).not.toBeInTheDocument();
});
