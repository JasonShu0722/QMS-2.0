import ExcelJS from 'exceljs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { renderTrialSummaryReport } from '../../src/modules/new-product-quality/trial-summary-report.js';

const report = {
  project: { id: 'project-id', code: 'NP-001', name: '试产项目', productCode: 'PRODUCT-001' },
  batch: { id: 'batch-id', code: 'RUN-001', workOrderCode: 'WORK-001' },
  summary: {
    version: 3, conclusion: '批准量产，夹具风险继续跟踪', sourceSha256: 'a'.repeat(64),
    submittedAt: '2026-09-25T08:00:00.000Z', approvedAt: '2026-09-25T09:00:00.000Z',
    metricSnapshot: [{ id: 'metric-id', code: 'CPK', target: 1.33, actual: 1.4, comparison: 'GTE', signal: 'GREEN', source: 'MANUAL', recordedAt: '2026-09-25T07:00:00.000Z' }],
    issueSnapshot: [{ kind: 'PROJECT_LEGACY', id: 'legacy-id', description: '夹具风险', riskLevel: 'HIGH', status: 'OPEN', createdAt: '2026-09-25T06:00:00.000Z' }, { kind: 'FORMAL', id: 'formal-id', responseForm: 'EIGHT_D', complexity: 'COMPLEX', severity: 'HIGH', status: 'ESCALATED', createdAt: '2026-09-25T06:30:00.000Z' }],
  },
};

it('renders native XLSX cells for the approved snapshot and keeps untrusted text literal', async () => {
  const file = await renderTrialSummaryReport({ ...report, summary: { ...report.summary, conclusion: '=HYPERLINK("https://example.test")' } }, 'xlsx');
  expect(file.content.subarray(0, 2).toString()).toBe('PK');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file.content);
  expect(workbook.getWorksheet('试产总结')?.getCell('B2').value).toBe('NP-001');
  expect(workbook.getWorksheet('试产总结')?.getCell('B10').value).toBe('a'.repeat(64));
  expect(workbook.getWorksheet('试产总结')?.getCell('B11').value).toBe('=HYPERLINK("https://example.test")');
  expect(workbook.getWorksheet('试产总结')?.getCell('B11').type).toBe(ExcelJS.ValueType.String);
  expect(workbook.getWorksheet('指标')?.getCell('B2').value).toBe('CPK');
  expect(workbook.getWorksheet('问题')?.rowCount).toBe(3);
});

it('renders a real PDF containing Chinese text and more than an empty shell', async () => {
  const file = await renderTrialSummaryReport(report, 'pdf');
  expect(file.content.subarray(0, 5).toString()).toBe('%PDF-');
  expect(file.content.length).toBeGreaterThan(3000);
  expect(file.content.toString('latin1')).toContain('/Type /Page');
  expect(file.content.toString('latin1')).toContain('/FontFile2');
  const loading = getDocument({ data: new Uint8Array(file.content), useSystemFonts: false });
  const pdf = await loading.promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => 'str' in item ? item.str : '').join(''));
  }
  const text = pages.join('');
  expect(text).toContain('试产总结');
  expect(text).toContain('批准量产，夹具风险继续跟踪');
  expect(text).toContain('a'.repeat(64));
  expect(text).toContain('CPK');
  expect(text).toContain('夹具风险');
  expect(text).toContain('formal-id');
  await loading.destroy();
});
