import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../i18n/Language';
import { InternalLayout } from './InternalLayout';
import { activeInternalDomain, internalDomains } from '../features/navigation/navigation';

vi.mock('../features/problem-center/ProblemCenterPage', () => ({ ProblemCenterPage: ({ eightDDomain }: { eightDDomain?: string }) => <div>followup:{eightDDomain}</div> }));
vi.mock('../features/customer-quality/CustomerQualityPage', () => ({ CustomerQualityPage: () => <div>customer-ledger</div> }));
vi.mock('../features/new-product-quality/NewProductQualityPage', () => ({ NewProductQualityPage: () => <div>new-product-ledger</div> }));
beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [], permissions: [] }), { headers: { 'content-type': 'application/json' } }))));
it.each(['customer-quality', 'new-product-quality'])('routes %s follow-up exclusively without mounting its editable ledger', async domain => {
  render(<MemoryRouter initialEntries={[`/app/${domain}/problems`]}><LanguageProvider><InternalLayout /></LanguageProvider></MemoryRouter>);
  expect(await screen.findByText(`followup:${domain}`)).toBeVisible();
  expect(screen.queryByText('customer-ledger')).not.toBeInTheDocument();
  expect(screen.queryByText('new-product-ledger')).not.toBeInTheDocument();
  expect(activeInternalDomain(`/app/${domain}/problems`)?.path).toBe(`/app/${domain}/problems`);
  expect(internalDomains.flatMap(item => item.children).filter(item => item.path === `/app/${domain}/problems`)).toHaveLength(1);
});
