import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { Alert, Button, Spin } from 'antd';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ApiError, getSession, type AccountType, type SessionView } from '../../api/client';
import { useLanguage } from '../../i18n/Language';

type AuthenticatedRouteProps = {
  accountType: AccountType;
  children: ReactNode;
};

export function AuthenticatedRoute({ accountType, children }: AuthenticatedRouteProps) {
  const { t } = useLanguage();
  const location = useLocation();
  const [retryCount, setRetryCount] = useState(0);
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'authenticated'; session: SessionView }
    | { status: 'unauthenticated' }
    | { status: 'error'; traceId?: string }
  >({ status: 'loading' });

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    getSession()
      .then((session) => {
        if (active) { useWorkTabsStore.getState().bindSession(`${session.accountType}:${session.organizationId}:${session.userId}`); setState({ status: 'authenticated', session }); }
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && (error.code === 'HTTP_401' || error.code === 'AUTH_SESSION_REQUIRED')) {
          useWorkTabsStore.getState().reset(); setState({ status: 'unauthenticated' });
        } else {
          setState({ status: 'error', traceId: error instanceof ApiError ? error.traceId : undefined });
        }
      });
    return () => {
      active = false;
    };
  }, [location.pathname, retryCount]);

  if (state.status === 'loading') {
    return (
      <main className="route-loading" aria-label={t('正在验证登录状态')}>
        <Spin size="large" />
      </main>
    );
  }

  if (state.status === 'error') {
    return (
      <main className="route-error" aria-label={t('登录状态验证失败')}>
        <Alert
          type="error"
          showIcon
          title={t('暂时无法验证登录状态')}
          description={<><div>{t('请检查网络连接后重试。')}</div>{state.traceId && <span>{t('追踪标识')}: <code>{state.traceId}</code></span>}</>}
          action={
            <Button type="primary" onClick={() => setRetryCount((count) => count + 1)}>
              {t('重试')}
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
