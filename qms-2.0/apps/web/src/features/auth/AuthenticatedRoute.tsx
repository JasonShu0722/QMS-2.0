import { Spin } from 'antd';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ApiError, getSession, type AccountType, type SessionResponse } from '../../api/client';

type AuthenticatedRouteProps = {
  accountType: AccountType;
  children: ReactNode;
};

export function AuthenticatedRoute({ accountType, children }: AuthenticatedRouteProps) {
  const location = useLocation();
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'authenticated'; session: SessionResponse } | { status: 'unauthenticated' }
  >({ status: 'loading' });

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    getSession()
      .then((session) => {
        if (active) setState({ status: 'authenticated', session });
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.code !== 'HTTP_401' && error.code !== 'AUTH_SESSION_REQUIRED') {
          setState({ status: 'unauthenticated' });
          return;
        }
        setState({ status: 'unauthenticated' });
      });
    return () => {
      active = false;
    };
  }, [location.pathname]);

  if (state.status === 'loading') {
    return (
      <main className="route-loading" aria-label="正在验证登录状态">
        <Spin size="large" />
      </main>
    );
  }

  if (state.status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (state.session.accountType !== accountType) {
    return <Navigate to={state.session.landingPath} replace />;
  }

  return children;
}
