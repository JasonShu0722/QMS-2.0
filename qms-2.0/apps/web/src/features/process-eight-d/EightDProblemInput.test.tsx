import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { EightDProblemInput } from './EightDProblemInput';

it('summarizes matching and differing facts without treating the first source as representative', () => {
  render(<LanguageProvider><EightDProblemInput severity="HIGH" sources={[
    { sourceId: 'source-one', sourceDomain: 'process-quality', sourceType: 'process-defect', sourceVersion: 1, sourceSnapshot: { operationCode: 'OP10', lineCode: 'L1', defectQuantity: 2, description: '尺寸超差' } },
    { sourceId: 'source-two', sourceDomain: 'process-quality', sourceType: 'process-defect', sourceVersion: 2, sourceSnapshot: { operationCode: 'OP10', lineCode: 'L2', defectQuantity: 3, description: '尺寸超差' } },
  ]} /></LanguageProvider>);

  const summary = within(screen.getByRole('list', { name: '来源摘要' }));
  expect(summary.getByText('5')).toBeVisible();
  expect(summary.getByText('OP10')).toBeVisible();
  expect(summary.getByText('来源有差异（2 种值）')).toBeVisible();
  expect(summary.getByText('尺寸超差')).toBeVisible();
  expect(summary.queryByText('L1')).not.toBeInTheDocument();
  expect(screen.getByText('查看来源明细').closest('details')).not.toHaveAttribute('open');
});
