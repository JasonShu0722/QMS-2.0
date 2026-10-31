import type { AccountProfile } from '@qms/contracts';
import { Alert, Button, Typography } from 'antd';
import { ExternalLink } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { useLanguage } from '../i18n/Language';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';
import { getConsoleContext } from './console-api';
import { consoleNavigation } from './console-navigation';
import { subscribeSessionSignals } from '../features/auth/session-invalidation';

export function ConsoleEntry({ profile }: { profile: AccountProfile }) {
  const { locale } = useLanguage();
  const text = (zh: string, en: string) => locale === 'en-US' ? en : zh;
  const sessionScope = useWorkTabsStore(state => state.sessionScope);
  const { id, accountType, organization } = profile;
  const eligible = accountType === 'INTERNAL' && sessionScope === `INTERNAL:${organization.id}:${id}`;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: symbol; status: 'allowed' | 'denied' | 'network' }>();
  const key = useMemo(() => Symbol('console-entry'), [sessionScope, id, accountType, organization.id, revision]);
  const entry = useRef<HTMLAnchorElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);

  useEffect(() => {
    if (!eligible) return;
    const controller = new AbortController();
    const revalidate = () => { controller.abort(); setResult(undefined); setRevision(value => value + 1); };
    const stopSignals = subscribeSessionSignals(revalidate);
    // Invalidate even a batched A -> B -> A session transition before React renders.
    const unsubscribe = useWorkTabsStore.subscribe((next, previous) => {
      if (next.sessionScope !== previous.sessionScope) {
        revalidate();
      }
    });
    void getConsoleContext(undefined, controller.signal).then(context => {
      if (controller.signal.aborted || useWorkTabsStore.getState().sessionScope !== sessionScope) return;
      const matchesActor = context.actor.accountType === 'INTERNAL' && context.actor.id === id && context.actor.homeOrganization.id === organization.id;
      setResult({ key, status: matchesActor && consoleNavigation(context).length > 0 ? 'allowed' : 'denied' });
    }).catch(error => {
      if (controller.signal.aborted || useWorkTabsStore.getState().sessionScope !== sessionScope) return;
      setResult({ key, status: error instanceof ApiError && (error.status === 401 || error.status === 403) ? 'denied' : 'network' });
    });
    return () => { controller.abort(); unsubscribe(); stopSignals(); };
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
  return <Button ref={entry} href="/console" target="_blank" rel="noopener noreferrer" title={text('在新窗口打开', 'Opens in a new window')} aria-description={text('在新窗口打开', 'Opens in a new window')} icon={<ExternalLink size={16} aria-hidden="true" />} style={{ minHeight: 44, minWidth: 44 }}>{text('管理控制台', 'Management console')}</Button>;
}
