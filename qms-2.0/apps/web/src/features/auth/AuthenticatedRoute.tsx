import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { Alert, Button, Spin } from 'antd';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ApiError, apiRequest, getSession, type AccountType, type LoginResponse, type SessionView } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { readReturnTo } from './return-to';
import { SessionVerificationGate } from './SessionVerificationGate';
import { publishSessionSignal, subscribeSessionSignals } from './session-invalidation';

type AuthenticatedRouteProps = {
  accountType: AccountType;
  children: ReactNode;
};

export function AuthenticatedRoute({ accountType, children }: AuthenticatedRouteProps) {
  const { t, locale } = useLanguage();
  const location = useLocation();
  const [retryCount, setRetryCount] = useState(0);
  const scope = useMemo(() => Symbol('authenticated-route'), [location.pathname]);
  const [verified, setVerified] = useState<{ scope: symbol; session: SessionView }>();
  const active = useRef<{ generation: number; controller?: AbortController }>({ generation: 0 });
  const binding = useRef(false);
  const bindTabs = useCallback((session?: SessionView) => {
    binding.current = true;
    try {
      if (session) useWorkTabsStore.getState().bindSession(`${session.accountType}:${session.organizationId}:${session.userId}`);
      else useWorkTabsStore.getState().reset();
    } finally { binding.current = false; }
  }, []);
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'authenticated'; session: SessionView }
    | { status: 'unauthenticated' }
    | { status: 'password-change' }
    | { status: 'denied' }
    | { status: 'error'; traceId?: string }
  >({ status: 'loading' });
  const restart = useCallback((clear = false) => {
    active.current.controller?.abort();
    active.current.generation++;
    if (clear) { setVerified(undefined); bindTabs(); }
    setState({ status: 'loading' });
    setRetryCount(count => count + 1);
  }, [bindTabs]);
  const discardPreserved = useCallback(() => setVerified(undefined), []);

  useEffect(() => subscribeSessionSignals(signal => restart(signal === 'invalidate')), [restart]);
  useEffect(() => useWorkTabsStore.subscribe((next, previous) => {
    if (!binding.current && next.sessionScope !== previous.sessionScope) restart(true);
  }), [restart]);

  useEffect(() => {
    const controller = new AbortController();
    const generation = ++active.current.generation;
    active.current.controller = controller;
    const current = () => !controller.signal.aborted && active.current.generation === generation;
    setState({ status: 'loading' });
    getSession(controller.signal)
      .then((session) => {
        if (!current()) return;
        const previous = useWorkTabsStore.getState().sessionScope;
        if (previous && previous !== `${session.accountType}:${session.organizationId}:${session.userId}`) { publishSessionSignal('invalidate'); return; }
        bindTabs(session); setVerified({ scope, session }); setState({ status: 'authenticated', session });
      })
      .catch(async (error: unknown) => {
        if (!current()) return;
        // A real refusal of the bound session crosses the same hard boundary as logout, once.
        if (useWorkTabsStore.getState().sessionScope && error instanceof ApiError && (error.status === 401 || error.status === 403 || error.code === 'HTTP_401' || error.code === 'AUTH_SESSION_REQUIRED')) { publishSessionSignal('invalidate'); return; }
        if (error instanceof ApiError && (error.status === 401 || error.code === 'HTTP_401' || error.code === 'AUTH_SESSION_REQUIRED')) {
          setVerified(undefined); bindTabs();
          try {
            const challenge = await apiRequest<LoginResponse>('/api/v1/auth/password-change', { signal: controller.signal });
            if (current()) setState({ status: challenge.securityState === 'PASSWORD_CHANGE_REQUIRED' ? 'password-change' : 'unauthenticated' });
          } catch (cause) {
            if (!current()) return;
            if (cause instanceof ApiError && (cause.status === 401 || ['HTTP_401', 'AUTH_PASSWORD_CHANGE_INVALID', 'AUTH_SESSION_REQUIRED'].includes(cause.code))) setState({ status: 'unauthenticated' });
            else setState({ status: 'error', traceId: cause instanceof ApiError ? cause.traceId : undefined });
          }
        } else if (error instanceof ApiError && error.status === 403) {
          setVerified(undefined); bindTabs(); setState({ status: 'denied' });
        } else {
          setState({ status: 'error', traceId: error instanceof ApiError ? error.traceId : undefined });
        }
      });
    return () => {
      controller.abort();
    };
  }, [scope, retryCount, bindTabs]);

  let status: ReactNode;
  if (state.status === 'loading') {
    status = (
      <main className="route-loading" aria-label={t('正在验证登录状态')}>
        <Spin size="large" />
      </main>
    );
  } else if (state.status === 'error' || state.status === 'denied') {
    status = (
      <main className="route-error" aria-label={t('登录状态验证失败')}>
        <Alert
          type="error"
          showIcon
          title={state.status === 'denied' ? locale === 'en-US' ? 'Sign-in access expired or denied' : '登录访问已失效或无权限' : t('暂时无法验证登录状态')}
          description={<><div>{t('请检查网络连接后重试。')}</div>{state.status === 'error' && state.traceId && <span>{t('追踪标识')}: <code>{state.traceId}</code></span>}</>}
          action={
            <Button type="primary" onClick={() => restart()}>
              {t('重试')}
            </Button>
          }
        />
      </main>
    );
  } else if (state.status === 'unauthenticated') {
    const returnTo = readReturnTo({ returnTo: location.pathname + location.search
      + (location.pathname === '/app/admin' || location.pathname.startsWith('/app/workflow-designer') ? location.hash : '') });
    return <Navigate to="/login" replace state={returnTo ? { returnTo } : null} />;
  } else if (state.status === 'password-change') {
    const returnTo = readReturnTo({ returnTo: location.pathname + location.search
      + (location.pathname === '/app/admin' || location.pathname.startsWith('/app/workflow-designer') ? location.hash : '') });
    return <Navigate to="/change-password" replace state={returnTo ? { returnTo } : null} />;
  } else if (state.session.accountType !== accountType) {
    return <Navigate to={state.session.landingPath} replace />;
  }

  const session = verified?.scope === scope ? verified.session : undefined;
  if (!session || session.accountType !== accountType) return status;
  return <>
    <SessionVerificationGate open={state.status !== 'authenticated'} onUnavailable={discardPreserved}>{status}</SessionVerificationGate>
    <div key={`${session.accountType}:${session.organizationId}:${session.userId}`}>{children}</div>
  </>;
}
