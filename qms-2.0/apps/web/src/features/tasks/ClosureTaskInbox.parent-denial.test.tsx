import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { ClosureTaskInbox } from './ClosureTaskInbox';

afterEach(() => { vi.unstubAllGlobals(); });

it('reports a current 403 to its embedding workspace so the whole sensitive projection can be cleared', async () => {
  useWorkTabsStore.getState().bindSession('INTERNAL:org:actor');
  vi.stubGlobal('fetch', vi.fn(async (path: string) => new Response(JSON.stringify(path.includes('/tasks/closure')
    ? { code: 'FEATURE_PERMISSION_DENIED', message: 'denied', traceId: 'trace-current' } : { items: [], total: 0 }),
  { status: path.includes('/tasks/closure') ? 403 : 200, headers: { 'content-type': 'application/json' } })));
  const onDenied = vi.fn();
  render(<LanguageProvider><MemoryRouter><ClosureTaskInbox onDenied={onDenied} /></MemoryRouter></LanguageProvider>);
  await waitFor(() => expect(onDenied).toHaveBeenCalledTimes(1));
  expect(onDenied.mock.calls[0]![0]).toBeInstanceOf(ApiError);
  expect(onDenied.mock.calls[0]![0].status).toBe(403);
});
