import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { attachmentDownload } from '../attachments/attachments';
import { ProblemEvidence } from './problem-read';
import type { ProblemReport } from './problem-workspace-api';

vi.mock('../attachments/attachments', () => ({ attachmentDownload: vi.fn() }));
const evidence = [{ id: 'file-a', originalName: 'A.txt', sizeBytes: 12, status: 'AVAILABLE', downloadable: true }] as ProblemReport['evidence'];
beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

it.each([401, 403])('reports a current download ApiError %s to its owner', async status => {
  const onDenied = vi.fn();
  vi.mocked(attachmentDownload).mockRejectedValue(new ApiError({ code: 'FILE_RESOURCE_DENIED', message: 'unsafe' }, status));
  render(<LanguageProvider><ProblemEvidence evidence={evidence} onDenied={onDenied} /></LanguageProvider>);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '下载证据' })));
  expect(onDenied).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('unsafe')).not.toBeInTheDocument();
});

it.each([409, 500])('does not revoke its owner for download error %s', async status => {
  const onDenied = vi.fn();
  vi.mocked(attachmentDownload).mockRejectedValue(new ApiError({ code: 'FILE_DOWNLOAD_FAILED', message: 'unsafe' }, status));
  render(<LanguageProvider><ProblemEvidence evidence={evidence} onDenied={onDenied} /></LanguageProvider>);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '下载证据' })));
  expect(onDenied).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toBeVisible();
});

it.each(['evidence', 'owner', 'unmount'] as const)('ignores a late denial after %s changes', async change => {
  let reject!: (cause: unknown) => void;
  vi.mocked(attachmentDownload).mockImplementation(() => new Promise((_resolve, rejectDownload) => { reject = rejectDownload; }));
  const ownerA = vi.fn(); const ownerB = vi.fn();
  const view = render(<LanguageProvider><ProblemEvidence evidence={evidence} onDenied={ownerA} /></LanguageProvider>);
  fireEvent.click(screen.getByRole('button', { name: '下载证据' }));
  if (change === 'unmount') view.unmount();
  else view.rerender(<LanguageProvider><ProblemEvidence evidence={change === 'evidence' ? [{ ...evidence[0]!, id: 'file-b', originalName: 'B.txt' }] : evidence} onDenied={change === 'owner' ? ownerB : ownerA} /></LanguageProvider>);
  await act(async () => reject(new ApiError({ code: 'FILE_RESOURCE_DENIED', message: 'unsafe' }, 403)));
  expect(ownerA).not.toHaveBeenCalled(); expect(ownerB).not.toHaveBeenCalled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  if (change !== 'unmount') expect(screen.getByRole('button', { name: '下载证据' })).toBeEnabled();
});

it('does not open a late download or clear the new evidence pending request', async () => {
  let releaseA!: (url: string) => void;
  let releaseB!: (url: string) => void;
  vi.mocked(attachmentDownload).mockImplementationOnce(() => new Promise(resolve => { releaseA = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { releaseB = resolve; }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const view = render(<LanguageProvider><ProblemEvidence evidence={evidence} /></LanguageProvider>);
  fireEvent.click(screen.getByRole('button', { name: '下载证据' }));
  view.rerender(<LanguageProvider><ProblemEvidence evidence={[{ ...evidence[0]!, id: 'file-b', originalName: 'B.txt' }]} /></LanguageProvider>);
  expect(screen.getByRole('button', { name: '下载证据' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '下载证据' }));
  await act(async () => releaseA('https://files.example/a'));
  expect(click).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: /下载证据$/ })).toBeDisabled();
  await act(async () => releaseB('https://files.example/b'));
  expect(click).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '下载证据' })).toBeEnabled();
});
