import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { EightDProblemInput } from './EightDProblemInput';

it('aggregates human-readable source names without displaying operation or line codes', () => {
  render(<LanguageProvider><EightDProblemInput severity="HIGH" sources={[
    { sourceId: 'source-one', sourceDomain: 'process-quality', sourceType: 'process-defect', sourceVersion: 1, sourceSnapshot: { operationCode: 'OP10', operationName: '冲压', lineCode: 'L1', lineName: '一号产线', defectQuantity: 2, description: '尺寸超差' } },
    { sourceId: 'source-two', sourceDomain: 'process-quality', sourceType: 'process-defect', sourceVersion: 2, sourceSnapshot: { operationCode: 'OP10', operationName: '冲压', lineCode: 'L2', lineName: '二号产线', defectQuantity: 3, description: '尺寸超差' } },
  ]} /></LanguageProvider>);

  const summary = within(screen.getByRole('list', { name: '来源摘要' }));
  expect(summary.getByText('5')).toBeVisible();
  expect(summary.getByText('冲压')).toBeVisible();
  expect(summary.getByText('一号产线、二号产线')).toBeVisible();
  expect(summary.getByText('尺寸超差')).toBeVisible();
  expect(screen.queryByText(/\b(?:OP10|L1|L2)\b/)).not.toBeInTheDocument();
  expect(screen.getByText(/查看来源明细/).closest('details')).not.toHaveAttribute('open');
});
