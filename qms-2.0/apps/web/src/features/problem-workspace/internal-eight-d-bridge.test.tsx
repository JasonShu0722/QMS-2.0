import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { ProblemWorkspacePage } from './ProblemWorkspacePage';

vi.mock('../process-eight-d/ProcessEightDWorkspace', () => ({ ProcessEightDWorkspace: ({ domain }: { domain?: string }) => <div>controlled:{domain}</div> }));
beforeEach(() => vi.unstubAllGlobals());
it.each([['customer-quality', 'customer-eight-d', 'customer'], ['new-product-quality', 'new-product-eight-d', 'new-product']])('bridges %s by its fixed UI key and suppresses generic task actions', async (domainCode, domainUiKey, domain) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    problem: { id: 'p', organizationId: 'org', reportNumber: '8D-1', domainCode, summary: { title: '问题' } },
    domain: { summary: { title: '问题', domainUiKey }, sections: [] }, selectedInstance: { id: 'i', current: true },
    instances: [], upgrades: [], nodes: [], evidence: [], actions: [{ actionKey: 'platform.upgrade', enabled: true }], capabilities: {}, task: { canClaim: true, canRelease: true },
  }), { headers: { 'content-type': 'application/json' } })));
  render(<MemoryRouter><LanguageProvider><UnsavedChangesProvider><ProblemWorkspacePage problemId="p" /></UnsavedChangesProvider></LanguageProvider></MemoryRouter>);
  expect(await screen.findByText(`controlled:${domain}`)).toBeVisible();
  expect(screen.queryByRole('button', { name: '领取任务' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '释放任务' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '升级预览' })).not.toBeInTheDocument();
});
