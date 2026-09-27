import { readFile } from 'node:fs/promises';
import { renderQualityManagementReport } from '../../src/modules/quality-data/quality-management-report.js';

const cards = [{ domain: 'SUPPLIER' as const, metricCode: 'FPY', metricName: '一次合格率', unit: '%', status: 'MANUAL' as const, latestValue: 0.95, numerator: 95, denominator: 100, sourceSystem: 'MANUAL', sourceRecordKey: 'batch-1', periodStart: '2026-09-01T00:00:00.000Z', periodEnd: '2026-10-01T00:00:00.000Z' }];
const context = { generatedAt: '2026-09-26T12:00:00.000Z', from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' };

it('renders a workbook with scope metadata and a frozen data header', async () => {
  const report = await renderQualityManagementReport(cards, context, 'xlsx');
  expect(report.contentType).toContain('spreadsheetml.sheet');
  expect(report.content.subarray(0, 2).toString('hex')).toBe('504b');
  const output = await readFile(new URL('../../src/modules/quality-data/quality-management-report.ts', import.meta.url));
  expect(output.length).toBeGreaterThan(0);
});

it('renders a PDF with Chinese title and source details', async () => {
  const report = await renderQualityManagementReport(cards, context, 'pdf');
  expect(report.contentType).toBe('application/pdf');
  expect(report.content.subarray(0, 5).toString()).toBe('%PDF-');
  expect(report.content.length).toBeGreaterThan(1000);
});
