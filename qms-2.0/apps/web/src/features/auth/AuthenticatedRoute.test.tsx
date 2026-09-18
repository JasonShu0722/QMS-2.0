import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AuthenticatedRoute } from './AuthenticatedRoute';

function mockJsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
  } as Response);
}

function LocationProbe() {
  return <output aria-label="current path">{useLocation().pathname}</output>;
}

describe('authenticated route', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('redirects an unauthenticated request to login without rendering the application shell', async () => {
    globalThis.fetch = vi.fn<typeof globalThis.fetch>(() => mockJsonResponse({ code: 'AUTH_SESSION_REQUIRED' }, 401));

    render(
      <MemoryRouter initialEntries={['/app/workbench']}>
        <Routes>
          <Route
            path="/app/*"
            element={
              <AuthenticatedRoute accountType="INTERNAL">
                <div>应用壳</div>
              </AuthenticatedRoute>
            }
          />
          <Route path="/login" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByText('应用壳')).not.toBeInTheDocument();
    expect(await screen.findByLabelText('current path')).toHaveTextContent('/login');
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/v1/auth/session', expect.objectContaining({ credentials: 'include' }));
  });

  it.each([
    ['INTERNAL', '/app/workbench', '内部壳'],
    ['SUPPLIER', '/supplier/inbox', '供应商壳'],
  ] as const)('allows an authenticated %s account into its own portal', async (accountType, path, shell) => {
    globalThis.fetch = vi.fn<typeof globalThis.fetch>(() =>
      mockJsonResponse({
        user: { id: 'user-1', organizationId: 'org-1', accountType },
      }),
    );

    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path={accountType === 'INTERNAL' ? '/app/*' : '/supplier/*'}
            element={
              <AuthenticatedRoute accountType={accountType}>
                <div>{shell}</div>
              </AuthenticatedRoute>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(shell)).toBeInTheDocument();
  });

  it('redirects an authenticated account to the server-owned landing portal', async () => {
    globalThis.fetch = vi.fn<typeof globalThis.fetch>(() =>
      mockJsonResponse({
        user: { id: 'supplier-1', organizationId: 'org-1', accountType: 'SUPPLIER' },
        landingPath: '/supplier/inbox',
      }),
    );

    render(
      <MemoryRouter initialEntries={['/app/workbench']}>
        <Routes>
          <Route
            path="/app/*"
            element={
              <AuthenticatedRoute accountType="INTERNAL">
                <div>内部壳</div>
              </AuthenticatedRoute>
            }
          />
          <Route path="/supplier/inbox" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText('current path')).toHaveTextContent('/supplier/inbox');
    expect(screen.queryByText('内部壳')).not.toBeInTheDocument();
  });

  it('shows a retryable error for a server failure and retries the session request', async () => {
    const user = userEvent.setup();
    globalThis.fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementationOnce(() => mockJsonResponse({ code: 'HTTP_500', message: '服务暂不可用' }, 500))
      .mockImplementationOnce(() =>
        mockJsonResponse({
          user: { id: 'user-1', organizationId: 'org-1', accountType: 'INTERNAL' },
        }),
      );

    render(
      <MemoryRouter initialEntries={['/app/workbench']}>
        <Routes>
          <Route
            path="/app/*"
            element={
              <AuthenticatedRoute accountType="INTERNAL">
                <div>应用壳</div>
              </AuthenticatedRoute>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('暂时无法验证登录状态')).toBeInTheDocument();
    expect(screen.queryByText('应用壳')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /重\s*试/ }));

    expect(await screen.findByText('应用壳')).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});
