import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { WorkbenchGraphStatus, type StatusSaveResult } from './WorkbenchGraphStatus';

const node = { status: 'development', statusVersion: 3 } as const;
const text = (zh: string) => zh;

it('requires evidence for live status and submits it with the draft version', async () => {
  const user = userEvent.setup();
  const save = vi.fn(async (): Promise<StatusSaveResult> => 'saved');
  render(<WorkbenchGraphStatus node={node} saving={false} onSave={save} text={text} />);
  await user.click(screen.getByRole('button', { name: '调整状态' }));
  await user.selectOptions(screen.getByRole('combobox', { name: '调整为' }), 'live');
  expect(screen.getByRole('button', { name: '保存状态' })).toBeDisabled();
  await user.type(screen.getByRole('textbox', { name: '上线验收依据' }), 'Issue #157 验收');
  await user.click(screen.getByRole('button', { name: '保存状态' }));
  expect(save).toHaveBeenCalledExactlyOnceWith({ status: 'live', expectedVersion: 3, evidence: 'Issue #157 验收' });
  expect(await screen.findByRole('button', { name: '调整状态' })).toBeEnabled();
});

it('discards a stale draft and prompts the user to review before retrying', async () => {
  const user = userEvent.setup();
  const save = vi.fn(async (): Promise<StatusSaveResult> => 'stale');
  render(<WorkbenchGraphStatus node={node} saving={false} onSave={save} text={text} />);
  await user.click(screen.getByRole('button', { name: '调整状态' }));
  await user.selectOptions(screen.getByRole('combobox', { name: '调整为' }), 'idea');
  await user.click(screen.getByRole('button', { name: '保存状态' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('状态已被更新');
  expect(save).toHaveBeenCalledExactlyOnceWith({ status: 'idea', expectedVersion: 3 });
  expect(screen.queryByRole('button', { name: '保存状态' })).not.toBeInTheDocument();
});
