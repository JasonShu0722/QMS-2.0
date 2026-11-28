import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ComponentProps } from 'react';
import { expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { EightDRowAttachments } from './EightDRowAttachments';
import type { EightDEvidence } from './EightDEvidence';

vi.mock('./EightDEvidence', () => ({
  EightDEvidence: ({ fileIds, readOnly, onChange, onLocalPendingChange, onDeletedFiles }: ComponentProps<typeof EightDEvidence>) => <>
    <input aria-label="Selected file" defaultValue="" />
    <output>{fileIds.join(', ')}</output>
    {onDeletedFiles && <button onClick={() => onDeletedFiles(['deleted-file'])}>Refresh metadata</button>}
    {!readOnly && <>
      <button onClick={() => onLocalPendingChange?.(true)}>Start upload</button>
      <button onClick={() => { onChange(['row-file']); onLocalPendingChange?.(false); }}>Finish upload</button>
      <button onClick={() => onChange([])}>Remove file</button>
    </>}
  </>,
}));

const props = { label: '临时措施附件', problemId: 'problem', fileIds: [], readOnly: false, read: vi.fn(), onChange: vi.fn() };

it('uses the same icon in both states and announces status without visible button text', async () => {
  const user = userEvent.setup();
  const view = render(<LanguageProvider><EightDRowAttachments {...props} /></LanguageProvider>);
  const trigger = screen.getByRole('button', { name: '临时措施附件 · 无附件' });
  const icon = trigger.querySelector('svg');
  const emptyColor = trigger.style.color;
  expect(icon).toBeInTheDocument();
  expect(trigger).toHaveTextContent(/^$/);
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByLabelText('Selected file')).not.toBeInTheDocument();
  await user.tab();
  expect(trigger).toHaveFocus();
  expect(await screen.findByRole('tooltip')).toHaveTextContent('临时措施附件 · 无附件');

  view.rerender(<LanguageProvider><EightDRowAttachments {...props} fileIds={['row-file']} /></LanguageProvider>);
  expect(screen.getByRole('button', { name: '临时措施附件 · 有附件' })).toBe(trigger);
  expect(trigger.querySelector('svg')).toBe(icon);
  expect(trigger.style.color).not.toBe(emptyColor);
  expect(trigger).toHaveTextContent(/^$/);
  await user.keyboard('{Enter}');
  const dialog = await screen.findByRole('dialog', { name: '临时措施附件 (1)' });
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(dialog).toContainElement(document.getElementById(trigger.getAttribute('aria-controls')!));
  expect(view.container).not.toContainElement(dialog);
  await waitFor(() => expect(within(dialog).getByText('row-file')).toBeVisible());
});

it('keeps evidence mounted when closed and preserves pending and change callbacks', async () => {
  const user = userEvent.setup();
  const pending = vi.fn();
  const changed = vi.fn();
  function Draft() {
    const [fileIds, setFileIds] = useState<string[]>([]);
    return <EightDRowAttachments {...props} fileIds={fileIds} onLocalPendingChange={pending}
      onChange={ids => { changed(ids); setFileIds(ids); }} />;
  }
  render(<LanguageProvider><Draft /></LanguageProvider>);
  const trigger = screen.getByRole('button', { name: '临时措施附件 · 无附件' });
  await user.click(trigger);
  const dialog = await screen.findByRole('dialog', { name: '临时措施附件 (0)' });
  const selected = within(dialog).getByRole('textbox', { name: 'Selected file' });
  await user.type(selected, 'local draft');
  await user.click(within(dialog).getByRole('button', { name: 'Start upload' }));
  expect(pending.mock.calls).toEqual([[true]]);

  await user.keyboard('{Escape}');
  await waitFor(() => expect(dialog).not.toBeVisible());
  expect(trigger).toHaveFocus();
  expect(pending.mock.calls).toEqual([[true]]);
  await user.click(trigger);
  expect(within(dialog).getByRole('textbox', { name: 'Selected file' })).toBe(selected);
  expect(selected).toHaveValue('local draft');
  await user.click(within(dialog).getByRole('button', { name: 'Finish upload' }));
  expect(trigger).toHaveAccessibleName('临时措施附件 · 有附件');
  expect(dialog).toHaveAccessibleName('临时措施附件 (1)');
  await user.click(within(dialog).getByRole('button', { name: 'Remove file' }));
  expect(trigger).toHaveAccessibleName('临时措施附件 · 无附件');
  expect(dialog).toHaveAccessibleName('临时措施附件 (0)');
  expect(pending.mock.calls).toEqual([[true], [false]]);
  expect(changed.mock.calls).toEqual([[['row-file']], [[]]]);
});

it('opens read-only evidence with its existing file references', async () => {
  const user = userEvent.setup();
  render(<LanguageProvider><EightDRowAttachments {...props} readOnly fileIds={['readonly-file']} /></LanguageProvider>);
  await user.click(screen.getByRole('button', { name: '临时措施附件 · 有附件' }));
  const dialog = await screen.findByRole('dialog', { name: '临时措施附件 (1)' });
  await waitFor(() => expect(within(dialog).getByText('readonly-file')).toBeVisible());
  expect(within(dialog).queryByRole('button', { name: 'Remove file' })).not.toBeInTheDocument();
});

it('excludes deleted metadata from the dialog count and paperclip status', async () => {
  const user = userEvent.setup();
  render(<LanguageProvider><EightDRowAttachments {...props} readOnly fileIds={['deleted-file']} /></LanguageProvider>);
  const trigger = screen.getByRole('button', { name: '临时措施附件 · 有附件' });
  await user.click(trigger);
  const dialog = await screen.findByRole('dialog', { name: '临时措施附件 (1)' });
  await user.click(within(dialog).getByRole('button', { name: 'Refresh metadata' }));
  expect(dialog).toHaveAccessibleName('临时措施附件 (0)');
  expect(trigger).toHaveAccessibleName('临时措施附件 · 无附件');
});
