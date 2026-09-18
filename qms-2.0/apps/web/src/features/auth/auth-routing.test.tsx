import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LoginPage } from './LoginPage';

function mockJsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
  } as Response);
}

describe('authenticated routing', () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = window.localStorage.setItem;
  const originalSessionStorage = window.sessionStorage.setItem;

  beforeEach(() => {
    vi.spyOn(window.localStorage.__proto__, 'setItem');
    vi.spyOn(window.sessionStorage.__proto__, 'setItem');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    window.localStorage.setItem = originalLocalStorage;
    window.sessionStorage.setItem = originalSessionStorage;
    vi.restoreAllMocks();
  });

  it.each([
    ['INTERNAL', '/app/workbench'],
    ['SUPPLIER', '/supplier/inbox'],
  ] as const)('routes %s users from the server-owned landing path', async (accountType, landingPath) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementationOnce(() => mockJsonResponse({ csrfToken: 'csrf-token' }))
      .mockImplementationOnce(() => mockJsonResponse({ accountType, landingPath }));
    globalThis.fetch = fetch;

    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path={landingPath} element={<div>{landingPath}</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByRole('button', { name: /切换|供应商门户|内部门户/i })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('账号'), `${accountType.toLowerCase()}@example.test`);
    await userEvent.type(screen.getByLabelText('密码'), 'Correct horse battery staple!');
    await userEvent.click(screen.getByRole('button', { name: '登录' }));

    await screen.findByText(landingPath);
    expect(fetch).toHaveBeenNthCalledWith(1, '/api/v1/auth/csrf', expect.objectContaining({ credentials: 'include' }));
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/v1/auth/login',
      expect.objectContaining({
        credentials: 'include',
        method: 'POST',
        headers: expect.objectContaining({ 'x-csrf-token': 'csrf-token' }),
      }),
    );
    await waitFor(() => expect(window.localStorage.setItem).not.toHaveBeenCalled());
    expect(window.sessionStorage.setItem).not.toHaveBeenCalled();
  });

  it('maps structured API errors without exposing implementation details', async () => {
    globalThis.fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementationOnce(() => mockJsonResponse({ csrfToken: 'csrf-token' }))
      .mockImplementationOnce(() =>
        mockJsonResponse(
          {
            code: 'AUTH_INVALID_CREDENTIALS',
            message: '账号或密码错误',
            fields: { identifier: ['账号不存在或密码错误'] },
            traceId: 'trace-123',
          },
          401,
        ),
      );

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    await userEvent.type(screen.getByLabelText('账号'), 'missing@example.test');
    await userEvent.type(screen.getByLabelText('密码'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByText('账号或密码错误')).toBeInTheDocument();
    expect(screen.getByText('trace-123')).toBeInTheDocument();
    expect(screen.getByText('账号不存在或密码错误')).toBeInTheDocument();
  });
});

