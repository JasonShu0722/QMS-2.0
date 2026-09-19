import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { InternalLayout } from '../../layouts/InternalLayout';

afterEach(() => vi.unstubAllGlobals());
it('rejects an unauthorized direct admin URL without a placeholder or empty context', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { headers: { 'content-type': 'application/json' } })));
  render(<MemoryRouter initialEntries={['/app/admin']}><InternalLayout /></MemoryRouter>);
  expect(await screen.findByText('无系统管理访问权限')).toBeInTheDocument();
  expect(screen.queryByText(/基础入口已就绪|系统管理上下文/)).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: '系统管理' })).not.toBeInTheDocument();
});
it('shows authorized organization and read-only user list', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(JSON.stringify(url.endsWith('/organizations') ? [{ id: 'org', name: '测试组织', code: 'test', type: 'INTERNAL', permissions: ['account:users:read'] }] : []), { headers: { 'content-type': 'application/json' } }))));
  render(<MemoryRouter initialEntries={['/app/admin']}><InternalLayout /></MemoryRouter>);
  expect(await screen.findByRole('tab', { name: '用户' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '创建用户' })).not.toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: '角色' })).not.toBeInTheDocument();
});
