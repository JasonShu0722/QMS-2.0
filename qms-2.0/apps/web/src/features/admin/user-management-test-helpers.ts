import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect } from 'vitest';

export async function openUserManagement(tab = '基本资料', entry?: HTMLElement) {
  let dialog = screen.queryByRole('dialog', { name: '管理用户' });
  if (!dialog) {
    const action = entry ?? (await screen.findAllByRole('button', { name: '管理用户', exact: true }))[0]!;
    expect(action).toHaveAccessibleName('管理用户');
    fireEvent.click(action);
    dialog = await screen.findByRole('dialog', { name: '管理用户' });
  }
  await waitFor(() => expect(dialog).toBeVisible());
  const controls = within(dialog);
  const target = controls.getByRole('tab', { name: tab });
  if (target.getAttribute('aria-selected') !== 'true') fireEvent.click(target);
  await waitFor(() => expect(target).toHaveAttribute('aria-selected', 'true'));
  return controls;
}
