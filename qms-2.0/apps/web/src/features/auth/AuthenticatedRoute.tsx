import { Alert, Button, Spin } from 'antd';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ApiError, getSession, type AccountType, type SessionView } from '../../api/client';

type AuthenticatedRouteProps = {
  accountType: AccountType;
  children: ReactNode;
};

export function AuthenticatedRoute({ accountType, children }: AuthenticatedRouteProps) {
  const location = useLocation();
  const [retryCount, setRetryCount] = useState(0);
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'authenticated'; session: SessionView }
    | { status: 'unauthenticated' }
    | { status: 'error' }
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
        if (error instanceof ApiError && (error.code === 'HTTP_401' || error.code === 'AUTH_SESSION_REQUIRED')) {
          setState({ status: 'unauthenticated' });
        } else {
          setState({ status: 'error' });
        }
      });
    return () => {
      active = false;
    };
  }, [location.pathname, retryCount]);

  if (state.status === 'loading') {
    return (
      <main className="route-loading" aria-label="正在验证登录状态">
        <Spin size="large" />
      </main>
    );
  }

  if (state.status === 'error') {
    return (
      <main className="route-error" aria-label="登录状态验证失败">
        <Alert
          type="error"
          showIcon
          title="暂时无法验证登录状态"
          description="请检查网络连接后重试。"
          action={
            <Button type="primary" onClick={() => setRetryCount((count) => count + 1)}>
              重试
            </Button>
          }
        />
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
