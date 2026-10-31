import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { EightDDocumentEditor } from './EightDDocumentEditor';
import type { EightDDocument } from './eight-d';

const eightDDocument: EightDDocument = {
  description: '', okFileIds: [], ngFileIds: [], temporaryMeasures: [], containment: [], optionalAffectedContainment: [],
  analysisProcess: '', analysisFileIds: [], occurrenceCause: '', escapeCause: '', systemCause: '', correctiveActions: [],
  horizontalDeployment: [], standardization: [], closureSummary: '',
};

it.each([false, true])('scopes editor guidance without changing its section or actions (portal=%s)', portal => {
  const read = vi.fn();
  const onChange = vi.fn();
  const props = { problemId: 'problem', document: eightDDocument, disabled: true, read, onChange, portal };
  render(<LanguageProvider><EightDDocumentEditor {...props} /></LanguageProvider>);
  const section = screen.getByRole('heading', { name: /D5-D6/ }).closest('section')!;
  expect(section.querySelector('p') !== null).toBe(portal);
  expect(screen.getByRole('heading', { name: /D5-D6/ })).toBeVisible();
  expect(read).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
});
