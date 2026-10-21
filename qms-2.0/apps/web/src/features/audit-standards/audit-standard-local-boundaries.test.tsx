import { LanguageProvider } from '../../i18n/Language';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { apiRequest } from '../../api/client';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { AuditStandardsPage } from './AuditStandardsPage';

vi.mock('../../api/client', async () => ({ ...(await vi.importActual<typeof import('../../api/client')>('../../api/client')), apiRequest: vi.fn() }));
const first = { id: 's1', name: '标准一', auditType: 'PROCESS', status: 'DRAFT', version: 1, latestVersion: 0, draftDefinition: { items: [{ key: 'P1', text: '过程受控' }] }, versions: [] };
const second = { ...first, id: 's2', name: '标准二' };
beforeEach(() => { vi.mocked(apiRequest).mockReset().mockImplementation(async (url) => url.includes('/s1') ? first : url.includes('/s2') ? second : { items: [first, second], total: 2 }); });

it.each(['close', 'switch', 'refresh'] as const)('preserves an audit-standard draft on local %s', async (action) => {
  render(<LanguageProvider><MemoryRouter><UnsavedChangesProvider><AuditStandardsPage /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>);
  const catalog = screen.getByRole('region', { name: '审核标准目录' });
  const title = await within(catalog).findByText('标准一');
  fireEvent.click(within(title.closest('.ant-list-item')!).getByRole('button', { name: '查看版本' }));
  fireEvent.click(await screen.findByRole('button', { name: '编辑草稿' }));
  fireEvent.change(screen.getByPlaceholderText('检查内容'), { target: { value: '未保存检查项' } });
  if (action === 'refresh') {
    fireEvent.click(screen.getByRole('button', { name: /^刷\s*新$/ }));
    await within(catalog).findByText('标准一');
  } else {
    if (action === 'close') fireEvent.click(within(screen.getByRole('dialog', { name: '编辑标准草稿' })).getByRole('button', { name: /close|关闭/i }));
    else fireEvent.click(within(within(catalog).getByText('标准二').closest('.ant-list-item')!).getByRole('button', { name: '查看版本' }));
    await waitFor(() => expect(screen.getByText('当前草稿尚未保存，继续将放弃修改。')).toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  }
  expect(screen.getByPlaceholderText('检查内容')).toHaveValue('未保存检查项');
});

beforeEach(() => { localStorage.clear(); vi.stubEnv('NODE_ENV', 'development'); });
afterEach(() => vi.unstubAllEnvs());
