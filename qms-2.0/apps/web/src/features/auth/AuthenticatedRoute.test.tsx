import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AuthenticatedRoute } from './AuthenticatedRoute';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';

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
    useWorkTabsStore.getState().reset();
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

  it('recovers an active password challenge from a protected business deep link', async () => {
    globalThis.fetch = vi.fn<typeof fetch>((path) => path === '/api/v1/auth/session'
      ? mockJsonResponse({ code: 'AUTH_SESSION_REQUIRED' }, 401)
      : mockJsonResponse({ accountType: 'INTERNAL', securityState: 'PASSWORD_CHANGE_REQUIRED', landingPath: '/change-password' }));
    render(<MemoryRouter initialEntries={['/app/workbench']}><Routes>
      <Route path="/app/*" element={<AuthenticatedRoute accountType="INTERNAL"><div>应用壳</div></AuthenticatedRoute>} />
      <Route path="/change-password" element={<LocationProbe />} /><Route path="/login" element={<LocationProbe />} />
    </Routes></MemoryRouter>);
    expect(await screen.findByLabelText('current path')).toHaveTextContent('/change-password');
    expect(screen.queryByText('应用壳')).not.toBeInTheDocument();
  });

  it('keeps a failed challenge lookup retryable rather than discarding it as logged out', async () => {
    let fail = true;
    globalThis.fetch = vi.fn<typeof fetch>((path) => path === '/api/v1/auth/session'
      ? mockJsonResponse({ code: 'AUTH_SESSION_REQUIRED' }, 401)
      : fail ? Promise.reject(new TypeError('network lost')) : mockJsonResponse({ securityState: 'PASSWORD_CHANGE_REQUIRED', landingPath: '/change-password' }));
    render(<MemoryRouter initialEntries={['/app/workbench']}><Routes>
      <Route path="/app/*" element={<AuthenticatedRoute accountType="INTERNAL"><div>应用壳</div></AuthenticatedRoute>} />
      <Route path="/change-password" element={<LocationProbe />} /><Route path="/login" element={<LocationProbe />} />
    </Routes></MemoryRouter>);
    expect(await screen.findByText('暂时无法验证登录状态')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    expect(await screen.findByLabelText('current path')).toHaveTextContent('/change-password');
  });

  it('ignores a challenge lookup resolved after the protected route unmounts', async () => {
    let resolveChallenge: ((response: Response) => void) | undefined;
    globalThis.fetch = vi.fn<typeof fetch>((path) => path === '/api/v1/auth/session'
      ? mockJsonResponse({ code: 'AUTH_SESSION_REQUIRED' }, 401)
      : new Promise<Response>((resolve) => { resolveChallenge = resolve; }));
    const view = render(<MemoryRouter><AuthenticatedRoute accountType="INTERNAL"><div>应用壳</div></AuthenticatedRoute></MemoryRouter>);
    await act(async () => { await Promise.resolve(); });
    expect(resolveChallenge).toBeDefined();
    view.unmount();
    await act(async () => { resolveChallenge!(await mockJsonResponse({ securityState: 'PASSWORD_CHANGE_REQUIRED', landingPath: '/change-password' })); });
    expect(screen.queryByText('应用壳')).not.toBeInTheDocument();
  });

  it.each([
    ['INTERNAL', '/app/workbench', '内部壳'],
    ['SUPPLIER', '/supplier/inbox', '供应商壳'],
  ] as const)('allows an authenticated %s account into its own portal', async (accountType, path, shell) => {
    globalThis.fetch = vi.fn<typeof globalThis.fetch>(() =>
      mockJsonResponse({
        user: { id: 'user-1', organizationId: 'org-1', accountType },
        landingPath: path, securityState: 'AUTHENTICATED',
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
        landingPath: '/supplier/inbox', securityState: 'AUTHENTICATED',
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
          landingPath: '/app/workbench', securityState: 'AUTHENTICATED',
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
