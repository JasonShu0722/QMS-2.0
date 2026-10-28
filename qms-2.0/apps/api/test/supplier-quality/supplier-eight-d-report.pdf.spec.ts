import { createHash, randomUUID } from 'node:crypto';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { renderProcessEightDPdf } from '../../src/modules/process-quality/process-eight-d-pdf.js';
import { supplierEightDReportModel } from '../../src/modules/supplier-quality/supplier-eight-d-report.model.js';
import { reportRead } from './supplier-eight-d-report.fixture.js';
import { png } from '../process-quality/process-eight-d-pdf.fixture.js';

function report() {
  const read = reportRead();
  Object.assign((read.snapshot as any).problem, { title: '供应商基础标题', materialCode: 'PART-N5', materialCategory: '压铸件',
    defectDescription: '基础不良事实与D2正文分别保留', defectQuantity: 0 });
  const output = supplierEightDReportModel(read, {}, false), document = output.snapshot.document;
  document.description = '供应商中文整改正文，保留受控版本';
  document.temporaryMeasures = Array.from({ length: 80 }, (_, i) => ({ id: `m-${i}`, description: `供应商围堵长表第${i + 1}行：实际批次检验`,
    departmentOwner: '质量 张工', introducedAt: '2026-10-28', fileIds: [] }));
  document.okFileIds = [randomUUID()]; document.ngFileIds = [randomUUID()];
  output.attachments = [...document.okFileIds, ...document.ngFileIds].map((id, i) => ({ id, originalName: `${i ? 'NG' : 'OK'}检验.png`,
    contentType: 'image/png', sizeBytes: png.length, sha256: createHash('sha256').update(png).digest('hex'), objectVersionId: `fixed-${i}`, version: 2,
    uses: [`D2 ${i ? 'NG' : 'OK'}`], rendering: 'EMBEDDED', note: '授权固定版本图像' }));
  return output;
}

it('renders actual Chinese supplier long tables and both OK/NG images without an internal-only title', async () => {
  const input = report(), images = new Map(input.attachments.map(file => [file.id, png]));
  const bytes = await renderProcessEightDPdf(input, images, 'supplier-quality');
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  try {
    const pdf = await loading.promise; expect(pdf.numPages).toBeGreaterThan(3); let text = '', count = 0;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i), content = await page.getTextContent();
      const pageText = content.items.map(item => 'str' in item ? item.str : '').join('');
      expect(pageText).toContain(input.reportNumber); text += pageText;
      count += (await page.getOperatorList()).fnArray.filter(op => [OPS.paintImageXObject, OPS.paintInlineImageXObject].includes(op)).length;
    }
    expect(text).toContain('供应商中文整改正文'); expect(text).toContain('供应商围堵长表第80行');
    for (const phrase of ['标题：供应商基础标题', '物料编码：PART-N5', '物料类别：压铸件', '不良描述：基础不良事实与D2正文分别保留', '不良数量：0']) expect(text).toContain(phrase);
    expect(text).toContain('D2 OK'); expect(text).toContain('D2 NG'); expect(count).toBeGreaterThanOrEqual(2);
    const title = (await pdf.getMetadata()).info as { Title: string };
    expect(title.Title).toContain('供应商'); expect(title.Title).not.toContain('内部');
    expect(text).toContain('供应商 8D 报告'); expect(text).not.toContain('内部 8D 报告');
  } finally { await loading.destroy(); }
}, 30_000);

it('isolates malformed image decoding in the existing bounded worker and keeps the parent alive', async () => {
  const input = report(); input.snapshot.document.temporaryMeasures = [];
  const bad = Buffer.from(png); bad.fill(0, 41, 47);
  await expect(renderProcessEightDPdf(input, new Map(input.attachments.map(file => [file.id, bad])), 'supplier-quality')).rejects.toThrow('PROCESS_EIGHT_D_REPORT_RENDER_FAILED');
  const bytes = await renderProcessEightDPdf(input, new Map(input.attachments.map(file => [file.id, png])), 'supplier-quality');
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
});

it('preserves actual original approval and duty facts after a closed supplement without treating export time as its update time', async () => {
  const input = report(); input.status = 'CLOSED_SUPPLEMENT'; input.snapshot.document.temporaryMeasures = [];
  input.snapshot.problem.supplementUpdatedAt = '2026-10-28T09:12:34.567Z';
  input.snapshot.approvalRounds = [{ roundNumber: 1, status: 'APPROVED', contentVersion: input.contentVersion - 1,
    duties: [{ duty: 'PROFESSIONAL', status: 'APPROVED', userId: 'sqe', decidedBy: 'actual-sqe', decidedAt: '2026-10-28T08:00:00.000Z' },
      { duty: 'SECTION_MANAGER', status: 'APPROVED', userId: 'manager', decidedBy: 'actual-manager', decidedAt: '2026-10-28T08:01:00.000Z' }] }];
  const loading = getDocument({ data: new Uint8Array(await renderProcessEightDPdf(input, new Map(input.attachments.map(file => [file.id, png])), 'supplier-quality')), useSystemFonts: false });
  try {
    const pdf = await loading.promise; let text = '';
    for (let i = 1; i <= pdf.numPages; i++) text += (await (await pdf.getPage(i)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join('');
    expect(text).toContain('补充更新时间：2026-10-28T09:12:34.567Z');
    expect(text).toContain(`生成时间（非审批时间）：${input.generatedAt}`);
    expect(text.match(/原版本实际批准，未覆盖本次补充/g)).toHaveLength(3);
    expect(text).toContain('PROFESSIONAL / APPROVED'); expect(text).toContain('SECTION_MANAGER / APPROVED');
    expect(text).toContain('实际签批 actual-sqe / 2026-10-28T08:00:00.000Z');
    expect(text).toContain('实际签批 actual-manager / 2026-10-28T08:01:00.000Z');
    expect(text).not.toContain('旧轮已失效');
  } finally { await loading.destroy(); }
});

it('does not substitute generatedAt when no actual supplement is recorded', async () => {
  const input = report(); input.status = 'CLOSED_SUPPLEMENT'; input.snapshot.document.temporaryMeasures = [];
  input.snapshot.problem.supplementUpdatedAt = null;
  const loading = getDocument({ data: new Uint8Array(await renderProcessEightDPdf(input, new Map(input.attachments.map(file => [file.id, png])), 'supplier-quality')), useSystemFonts: false });
  try {
    const pdf = await loading.promise; let text = '';
    for (let i = 1; i <= pdf.numPages; i++) text += (await (await pdf.getPage(i)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join('');
    expect(text).toContain('补充更新时间：未记录');
    expect(text).not.toContain(`补充更新时间：${input.generatedAt}`);
  } finally { await loading.destroy(); }
});
