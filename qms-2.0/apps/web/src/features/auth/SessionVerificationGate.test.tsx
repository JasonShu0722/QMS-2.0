import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SessionVerificationGate } from './SessionVerificationGate';
import { LanguageProvider } from '../../i18n/Language';
import { MemoryRouter } from 'react-router-dom';
import { AuthenticatedRoute } from './AuthenticatedRoute';
import { readFileSync } from 'node:fs';
import { Button } from 'antd';

// jsdom only exercises the lifecycle contract, not native backdrop or inert behavior.
Object.defineProperties(HTMLDialogElement.prototype, { showModal: { configurable: true, writable: true, value() {} }, close: { configurable: true, writable: true, value() {} } });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });
it('owns a native modal lifecycle and refuses escape or close while verification is unresolved', () => {
  const show = vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
  const close = vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.removeAttribute('open'); });
  const unavailable = vi.fn();
  const view = render(<SessionVerificationGate open onUnavailable={unavailable}><p>Checking server authorization</p></SessionVerificationGate>);
  const dialog = screen.getByRole('dialog', { name: '会话安全验证' });
  expect(show).toHaveBeenCalledOnce();
  expect(fireEvent(dialog, new Event('cancel', { cancelable: true }))).toBe(false);
  expect(dialog).toHaveAttribute('open');
  view.rerender(<SessionVerificationGate open={false} onUnavailable={unavailable}><p>Checking server authorization</p></SessionVerificationGate>);
  expect(close).toHaveBeenCalledOnce(); expect(unavailable).not.toHaveBeenCalled();
});
it('fails closed when native modal isolation cannot be opened', () => {
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(() => { throw new Error('unavailable'); });
  const unavailable = vi.fn();
  render(<SessionVerificationGate open onUnavailable={unavailable}>Checking</SessionVerificationGate>);
  expect(unavailable).toHaveBeenCalledOnce();
});

it('localizes the native security gate label for the current English locale', () => {
  localStorage.setItem('qms:locale:v1', 'en-US');
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
  render(<LanguageProvider><SessionVerificationGate open onUnavailable={() => {}}>Checking</SessionVerificationGate></LanguageProvider>);
  expect(screen.getByRole('dialog', { name: 'Session security verification' })).toBeInTheDocument();
});

it('localizes an actual server session denial without rendering the protected page', async () => {
  localStorage.setItem('qms:locale:v1', 'en-US');
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403, headers: { 'content-type': 'application/json' } })));
  render(<LanguageProvider><MemoryRouter><AuthenticatedRoute accountType="INTERNAL"><p>protected page</p></AuthenticatedRoute></MemoryRouter></LanguageProvider>);
  expect(await screen.findByText('Sign-in access expired or denied')).toBeInTheDocument();
  expect(screen.queryByText('protected page')).not.toBeInTheDocument();
});

it('declares local coarse-pointer retry button targets of at least 44px in both dimensions', () => {
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
  render(<SessionVerificationGate open onUnavailable={() => {}}><Button>Retry</Button></SessionVerificationGate>);
  const style = document.createElement('style'); style.textContent = readFileSync('src/features/auth/session-verification.css', 'utf8'); document.head.append(style);
  try {
    const rules = Array.from(style.sheet!.cssRules).filter((rule): rule is CSSMediaRule => rule.type === CSSRule.MEDIA_RULE && (rule as CSSMediaRule).conditionText.includes('(pointer: coarse)')).flatMap(rule => Array.from(rule.cssRules)).filter((rule): rule is CSSStyleRule => rule.type === CSSRule.STYLE_RULE);
    const button = screen.getByRole('button', { name: 'Retry' });
    expect(rules.some(rule => button.matches(rule.selectorText) && Number.parseFloat(rule.style.getPropertyValue('min-height')) >= 44 && Number.parseFloat(rule.style.getPropertyValue('min-width')) >= 44)).toBe(true);
  } finally { style.remove(); }
});
