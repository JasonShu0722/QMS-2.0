import type { AccountProfile } from '@qms/contracts';
import { Alert, Button, Typography } from 'antd';
import { ExternalLink } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { useLanguage } from '../i18n/Language';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';
import { getConsoleContext } from './console-api';
import { consoleNavigation } from './console-navigation';
import { subscribeSessionSignals, subscribeWindowResume } from '../features/auth/session-invalidation';

export function ConsoleEntry({ profile }: { profile: AccountProfile }) {
  const { locale } = useLanguage();
  const text = (zh: string, en: string) => locale === 'en-US' ? en : zh;
  const sessionScope = useWorkTabsStore(state => state.sessionScope);
  const { id, accountType, organization } = profile;
  const eligible = accountType === 'INTERNAL' && sessionScope === `INTERNAL:${organization.id}:${id}`;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: symbol; status: 'allowed' | 'denied' | 'network' }>();
  const key = useMemo(() => Symbol('console-entry'), [sessionScope, id, accountType, organization.id, revision]);
  const currentKey = useRef(key); currentKey.current = key;
  const entry = useRef<HTMLAnchorElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const resume = useRef<() => void>(() => {});
  const [resumeError, setResumeError] = useState<symbol>();

  useEffect(() => {
    if (!eligible) return;
    let active: AbortController | undefined;
    let pending = false;
    let allowed = false;
    const revalidate = () => { active?.abort(); setResult(undefined); setResumeError(undefined); setRevision(value => value + 1); };
    const stopSignals = subscribeSessionSignals(revalidate);
    // Invalidate even a batched A -> B -> A session transition before React renders.
    const unsubscribe = useWorkTabsStore.subscribe((next, previous) => {
      if (next.sessionScope !== previous.sessionScope) {
        revalidate();
      }
    });
    const verify = (background = false) => {
      if (pending) return;
      const controller = new AbortController(); active = controller; pending = true;
      setResumeError(undefined);
      const current = () => !controller.signal.aborted && currentKey.current === key && active === controller && useWorkTabsStore.getState().sessionScope === sessionScope;
      void getConsoleContext(undefined, controller.signal).then(context => {
        if (!current()) return;
        const matchesActor = context.actor.accountType === 'INTERNAL' && context.actor.id === id && context.actor.homeOrganization.id === organization.id;
        allowed = matchesActor && consoleNavigation(context).length > 0;
        setResult({ key, status: allowed ? 'allowed' : 'denied' });
      }).catch(error => {
        if (!current()) return;
        const denied = error instanceof ApiError && (error.status === 401 || error.status === 403);
        if (background && allowed && !denied) setResumeError(key);
        else { allowed = false; setResult({ key, status: denied ? 'denied' : 'network' }); }
      }).finally(() => { if (current()) pending = false; });
    };
    resume.current = () => verify(true);
    const stopResume = subscribeWindowResume(resume.current);
    verify();
    return () => { active?.abort(); unsubscribe(); stopSignals(); stopResume(); };
  }, [eligible, sessionScope, id, organization.id, key]);

  const status = result?.key === key ? result.status : undefined;
  useEffect(() => {
    if (!restoreFocus.current || !status) return;
    if (status === 'allowed') entry.current?.focus();
    if (status === 'network') retry.current?.focus();
    restoreFocus.current = false;
  }, [status]);

  if (!eligible || status === 'denied') return null;
  if (!status) return <Typography.Text type="secondary" role="status">{text('正在验证管理入口', 'Verifying management access')}</Typography.Text>;
  if (status === 'network') return <Alert type="error" showIcon title={text('无法验证管理入口，请重试', 'Unable to verify management access. Retry.')} action={<Button ref={retry} aria-label={text('重试', 'Retry')} style={{ minHeight: 44, minWidth: 44 }} onClick={() => { restoreFocus.current = true; setRevision(value => value + 1); }}>{text('重试', 'Retry')}</Button>} />;
  return <><Button ref={entry} href="/console" target="_blank" rel="noopener noreferrer" title={text('在新窗口打开', 'Opens in a new window')} aria-description={text('在新窗口打开', 'Opens in a new window')} icon={<ExternalLink size={16} aria-hidden="true" />} style={{ minHeight: 44, minWidth: 44 }}>{text('管理控制台', 'Management console')}</Button>{resumeError === key && <Alert role="alert" type="warning" showIcon title={text('无法验证管理入口，请重试', 'Unable to verify management access. Retry.')} action={<Button aria-label={text('重试', 'Retry')} onClick={() => resume.current()}>{text('重试', 'Retry')}</Button>} />}</>;
}
