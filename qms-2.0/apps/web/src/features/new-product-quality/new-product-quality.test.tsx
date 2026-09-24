import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiRequest } from '../../api/client';
import { NewProductQualityPage } from './NewProductQualityPage';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, apiRequest: vi.fn() };
});

const project = {
  id: 'project-1', organization_id: 'org-1', code: 'NP-2026-001', name: '电驱平台项目', product_code: 'EDRIVE-X', status: 'ACTIVE' as const, version: 2,
  stages: [{ id: 'stage-1', project_id: 'project-1', code: 'DV', name: '设计验证', status: 'OPEN' as const, version: 1 }],
  lessons: [], batches: [], selected_defects: [],
};

beforeEach(() => vi.mocked(apiRequest).mockReset());

it('loads a project and renders its stages', async () => {
  vi.mocked(apiRequest).mockResolvedValue(project);
  render(<NewProductQualityPage />);
  fireEvent.change(screen.getByLabelText('新产品项目 ID'), { target: { value: project.id } });
  fireEvent.click(screen.getByRole('button', { name: '查看项目' }));
  expect(await screen.findByText('电驱平台项目')).toBeVisible();
  expect(screen.getByText('设计验证')).toBeVisible();
  expect(apiRequest).toHaveBeenCalledWith(`/api/v1/new-product-quality/projects/${project.id}`);
});

it('shows an explicit empty state after a successful lookup with no project', async () => {
  vi.mocked(apiRequest).mockResolvedValue(undefined as never);
  render(<NewProductQualityPage projectId="missing-project" />);
  expect(await screen.findByText('未找到新产品项目')).toBeVisible();
});

it('keeps the empty state explicit before a project is selected', () => {
  render(<NewProductQualityPage />);
  expect(screen.getByText('输入新产品项目 ID 后查看详情')).toBeVisible();
});
