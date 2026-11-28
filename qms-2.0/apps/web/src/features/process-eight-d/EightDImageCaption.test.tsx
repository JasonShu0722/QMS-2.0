import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { EightDEvidenceSection } from './EightDEvidence';
import { EightDImageCaption } from './EightDImageCaption';

it('shows only the category heading and edits the description in place inside the card', async () => {
  const user = userEvent.setup();
  function Category({ readOnly = false }: { readOnly?: boolean }) {
    const [value, setValue] = useState('');
    return <EightDEvidenceSection label="OK 图片" inlineImages imageTone="ok" problemId="report" fileIds={[]} readOnly={readOnly} read={vi.fn()} onChange={vi.fn()}>
      <EightDImageCaption label="OK 图片说明" value={value} readOnly={readOnly} onChange={setValue} />
    </EightDEvidenceSection>;
  }
  const view = render(<LanguageProvider><Category /></LanguageProvider>);
  const card = within(screen.getByRole('region', { name: 'OK 图片' }));
  expect(card.getAllByText('OK 图片')).toHaveLength(1);
  expect(card.queryByText('图片', { exact: true })).not.toBeInTheDocument();
  const placeholder = card.getByRole('button', { name: '添加图片描述' });
  expect(placeholder.closest('.attachment-panel')).toBeInTheDocument();
  await user.click(placeholder);
  const input = card.getByRole('textbox', { name: 'OK 图片说明' });
  expect(input).toHaveFocus();
  await user.type(input, '正常边缘');
  await user.tab();
  await user.click(card.getByRole('button', { name: '正常边缘' }));
  expect(card.getByRole('textbox', { name: 'OK 图片说明' })).toHaveValue('正常边缘');
  view.rerender(<LanguageProvider><Category readOnly /></LanguageProvider>);
  expect(card.getByText('正常边缘')).toBeVisible();
  expect(card.queryByRole('textbox')).not.toBeInTheDocument();
  expect(card.queryByRole('button', { name: '正常边缘' })).not.toBeInTheDocument();
});
