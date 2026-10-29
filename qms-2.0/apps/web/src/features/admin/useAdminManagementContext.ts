import { useEffect, useRef, useState } from 'react';
import type { components } from '@qms/contracts';
import { apiRequest } from '../../api/client';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';

type Context = components['schemas']['AdminOrganizationContextDto'];
type State = { organizationId?: string; session?: string; context?: Context; error?: unknown; loading: boolean };

export function useAdminManagementContext(organizationId?: string) {
  const session = useWorkTabsStore(state => state.sessionScope);
  const [revision, setRevision] = useState(0);
  const epoch = useRef(0);
  const generation = epoch.current;
  const [state, setState] = useState<State>({ loading: true });
  useEffect(() => {
    if (!organizationId || !session) { setState({ organizationId, session, loading: false }); return; }
    const controller = new AbortController();
    let active = true;
    const current = () => active && useWorkTabsStore.getState().sessionScope === session;
    const unsubscribe = useWorkTabsStore.subscribe(state => {
      if (state.sessionScope === session || !active) return;
      active = false; epoch.current++; controller.abort();
      setState(previous => previous.organizationId === organizationId && previous.session === session
        ? { organizationId, session, loading: false } : previous);
    });
    setState({ organizationId, session, loading: true });
    void apiRequest<Context>(`/api/v1/admin/organizations/context?organizationId=${encodeURIComponent(organizationId)}`, { signal: controller.signal })
      .then(context => {
        if (context?.targetOrganizationId !== organizationId || typeof context.hasPlatformAdministrator !== 'boolean' || !Array.isArray(context.permissions)) {
          throw new Error('Management context does not match the selected scope');
        }
        if (current()) setState({ organizationId, session, context, loading: false });
      }).catch(error => { if (current()) setState({ organizationId, session, error, loading: false }); });
    return () => { active = false; epoch.current++; controller.abort(); unsubscribe(); };
  }, [organizationId, session, revision]);
  const current = state.organizationId === organizationId && state.session === session ? state : { loading: true };
  return { ...current, reload: () => setRevision(value => value + 1), invalidate: (error: unknown) => {
    if (!session || epoch.current !== generation || useWorkTabsStore.getState().sessionScope !== session) return;
    setState(previous => previous.organizationId === organizationId && previous.session === session
      ? { organizationId, session, error, loading: false } : previous);
  } };
}
