import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import ts from 'typescript';
import { renderProcessEightDPdf } from '../../src/modules/process-quality/process-eight-d-pdf.js';
import { imageId, png, sampleReport } from './process-eight-d-pdf.fixture.js';

let compiledDirectory: string;
beforeAll(() => {
  compiledDirectory = mkdtempSync(join(tmpdir(), 'qms-n3-pdf-'));
  writeFileSync(join(compiledDirectory, 'package.json'), '{"type":"module"}');
  // Resolve package targets individually: pnpm's relative links break beneath a Windows junction.
  mkdirSync(join(compiledDirectory, 'node_modules', '@expo-google-fonts'), { recursive: true });
  for (const dependency of ['pdfkit', '@expo-google-fonts/noto-sans-sc']) {
    symlinkSync(realpathSync(new URL(`../../node_modules/${dependency}`, import.meta.url)), join(compiledDirectory, 'node_modules', dependency), 'junction');
  }
  // Compile only the two owned renderer files, never the shared application or C sources.
  for (const name of ['process-eight-d-pdf', 'process-eight-d-pdf.worker']) {
    const source = readFileSync(new URL(`../../src/modules/process-quality/${name}.ts`, import.meta.url), 'utf8');
    const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } });
    writeFileSync(join(compiledDirectory, `${name}.js`), outputText);
  }
});
afterAll(() => {
  if (!compiledDirectory) return;
  const target = realpathSync(compiledDirectory);
  if (dirname(target) !== realpathSync(tmpdir()) || !basename(target).startsWith('qms-n3-pdf-')) throw new Error('Unexpected PDF test cleanup target');
  rmSync(target, { recursive: true, force: true });
});

function pngChunk(type: string, data: Buffer): Buffer {
  const bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length); bytes.write(type, 4); data.copy(bytes, 8);
  bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4);
  return bytes;
}

function rgbaPng(compressed: Buffer, repeatedHeader = false): Buffer {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([png.subarray(0, 8), pngChunk('IHDR', ihdr), ...(repeatedHeader ? [pngChunk('IHDR', ihdr)] : []),
    pngChunk('IDAT', compressed), pngChunk('IEND', Buffer.alloc(0))]);
}

it('renders Chinese, all sources, real image operators, multipage long rows and versioned page headers', async () => {
  const report = sampleReport();
  const bytes = await renderProcessEightDPdf(report, new Map([[imageId, png]]));
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const pdf = await loading.promise;
  try {
    expect(pdf.numPages).toBeGreaterThan(3);
    let text = ''; let imageCount = 0;
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index);
      const content = await page.getTextContent();
      // A width-triggered second wrap used to add an orphan line and overflow D7 row borders.
      expect(content.items.some(item => 'str' in item && item.str === '和')).toBe(false);
      const pageText = content.items.map(item => 'str' in item ? item.str : '').join('');
      expect(pageText).toContain('8D-2026-001');
      expect(pageText).toContain(`第 ${index} / ${pdf.numPages} 页`);
      text += pageText;
      const operators = await page.getOperatorList();
      imageCount += operators.fnArray.filter(op => op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject).length;
    }
    for (const phrase of ['压装开裂', '第一来源', '第二来源', 'OP10', '壳体', 'TRACE-02', '围堵长表第80行', '先还原生产过程',
      '压装间隙不合适', '改善前有裂纹', '改善后无裂纹', '首批B-001', '三批实测', 'D7', 'DFMEA', '关闭总结', 'OK对照.png',
      '草稿（未批准）', '旧轮已失效', '同人跳过（非签批）', 'old-reviewer', '序号']) expect(text).toContain(phrase);
    expect(imageCount).toBe(1);
    expect(text).not.toContain('https://');
  } finally { await loading.destroy(); }
}, 30000);

it('rejects a missing required image instead of producing a success with a blank section', async () => {
  await expect(renderProcessEightDPdf(sampleReport(), new Map())).rejects.toThrow('PROCESS_EIGHT_D_REPORT_IMAGE_MISSING');
});

it.each(['process-quality', 'customer-quality', 'new-product-quality'])('keeps %s closed-supplement approvals factual without adding supplier base fields', async domain => {
  const report = sampleReport(); report.status = 'CLOSED_SUPPLEMENT'; report.snapshot.document.temporaryMeasures = [];
  Object.assign(report.snapshot.problem, { title: 'SUPPLIER_ONLY_TITLE', materialCode: 'SUPPLIER_ONLY_PART', materialCategory: 'SUPPLIER_ONLY_CATEGORY',
    defectDescription: 'SUPPLIER_ONLY_DEFECT', defectQuantity: 987 });
  report.snapshot.approvalRounds = [
    { roundNumber: 1, status: 'APPROVED', contentVersion: report.contentVersion - 1, duties: [
      { duty: 'PROFESSIONAL', status: 'APPROVED', decidedBy: 'real-professional', decidedAt: '2026-10-25T08:00:00Z' },
      { duty: 'MANAGEMENT', status: 'SKIPPED_SAME_PERSON', userId: 'real-professional', decidedBy: null, decidedAt: null }] },
    ...['RETURNED', 'CANCELLED'].map((status, i) => ({ roundNumber: i + 2, status, contentVersion: report.contentVersion,
      duties: [{ duty: 'PROFESSIONAL', status: 'APPROVED', decidedBy: 'returned-reviewer', decidedAt: '2026-10-25T07:00:00Z' }] })),
    { roundNumber: 4, status: 'PENDING', contentVersion: report.contentVersion - 1, duties: [{ duty: 'PROFESSIONAL', status: 'PENDING' }] },
  ];
  const loading = getDocument({ data: new Uint8Array(await renderProcessEightDPdf(report, new Map([[imageId, png]]), domain)), useSystemFonts: false });
  try {
    const pdf = await loading.promise; let text = '';
    for (let i = 1; i <= pdf.numPages; i++) text += (await (await pdf.getPage(i)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join('');
    expect(text).toContain('审批轮 1 / APPROVED / 原版本实际批准，未覆盖本次补充');
    expect(text).toContain('实际签批 real-professional / 2026-10-25T08:00:00Z（原版本实际批准，未覆盖本次补充）');
    expect(text).toContain('同人跳过（非签批）'); expect(text).not.toContain('实际签批 real-professional / 未记录');
    expect(text).toContain('审批轮 2 / RETURNED / 旧轮已失效'); expect(text).toContain('审批轮 3 / CANCELLED / 旧轮已失效');
    expect(text.match(/旧轮已失效，不作为本版批准/g)).toHaveLength(2);
    expect(text).toContain('审批轮 4 / PENDING / 非本版审批，不作为本版批准');
    expect(text).not.toContain('SUPPLIER_ONLY_'); expect(text).not.toContain('物料类别：'); expect(text).not.toContain('补充更新时间');
  } finally { await loading.destroy(); }
});

it.each([['customer-quality', '客户'], ['new-product-quality', '新品']])('renders %s report titles without process-domain headings', async (domainCode, label) => {
  const report = sampleReport(); report.snapshot.problem.domainCode = domainCode;
  report.snapshot.document.temporaryMeasures = [];
  const loading = getDocument({ data: new Uint8Array(await renderProcessEightDPdf(report, new Map([[imageId, png]]))), useSystemFonts: false });
  const pdf = await loading.promise;
  try {
    let text = '';
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index);
      text += (await page.getTextContent()).items.map(item => 'str' in item ? item.str : '').join('');
    }
    expect(text).toContain(`${label}内部 8D 报告`);
    expect(text).toContain(`D2 问题描述与${label}来源`);
    expect(text).not.toContain('过程内部');
    expect(text).not.toContain('版本与过程基础');
    expect(text).not.toContain('问题描述与过程来源');
  } finally { await loading.destroy(); }
});

it('uses the confirmed major-risk business label instead of the API severity code', async () => {
  const report = sampleReport();
  report.snapshot.problem.severity = 'CRITICAL';
  report.snapshot.document.temporaryMeasures = [];
  const loading = getDocument({ data: new Uint8Array(await renderProcessEightDPdf(report, new Map([[imageId, png]]))), useSystemFonts: false });
  const pdf = await loading.promise;
  try {
    const page = await pdf.getPage(1);
    const text = (await page.getTextContent()).items.map(item => 'str' in item ? item.str : '').join('');
    expect(text).toContain('重大风险');
    expect(text).not.toContain('CRITICAL');
  } finally { await loading.destroy(); }
});

it('lists nonimage attachments by purpose without merging original PDF pages', async () => {
  const report = sampleReport();
  report.snapshot.document.okFileIds = [];
  report.attachments = [{ ...report.attachments[0]!, contentType: 'application/pdf', originalName: '原始检验报告.pdf', rendering: 'LISTED',
    note: '非 PNG/JPEG 附件不合并；请使用正常授权下载' }];
  const bytes = await renderProcessEightDPdf(report, new Map());
  const loading = getDocument({ data: new Uint8Array(bytes) });
  const pdf = await loading.promise;
  let text = '';
  try {
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index);
      text += (await page.getTextContent()).items.map(item => 'str' in item ? item.str : '').join('');
    }
    expect(text).toContain('原始检验报告.pdf');
    expect(text).toContain('正常授权下载');
  } finally { await loading.destroy(); }
}, 30000);

it('bounds aggregate decoded pixels before PNG decoding, not just compressed object bytes', async () => {
  const report = sampleReport();
  const header = Buffer.from(png.subarray(0, 33));
  header.writeUInt32BE(4000, 16); header.writeUInt32BE(4000, 20);
  report.snapshot.document.okFileIds = [];
  report.attachments = Array.from({ length: 3 }, (_, index) => ({ ...report.attachments[0]!, id: `image-${index}` }));
  const images = new Map(report.attachments.map(file => [file.id, header]));
  await expect(renderProcessEightDPdf(report, images)).rejects.toThrow('PROCESS_EIGHT_D_REPORT_IMAGE_LIMIT');
});

it('charges each repeated image embedding before decoding even when attachment uses are stale', async () => {
  const report = sampleReport();
  const header = Buffer.from(png.subarray(0, 33));
  header.writeUInt32BE(4000, 16); header.writeUInt32BE(4000, 20);
  report.snapshot.document.temporaryMeasures.forEach(row => { row.fileIds = [imageId]; });
  // Header-only bytes must be rejected by budget, not passed to the decoder.
  await expect(renderProcessEightDPdf(report, new Map([[imageId, header]]))).rejects.toThrow('PROCESS_EIGHT_D_REPORT_IMAGE_LIMIT');
});

it.each([
  ['native TS', 'inflate'], ['native TS', 'filter'], ['compiled JS', 'inflate'], ['compiled JS', 'filter'],
])('isolates asynchronous PNG failure in %s (%s) from the parent process', (runtime, kind) => {
  const bad = rgbaPng(kind === 'inflate' ? Buffer.from([0, 1, 2, 3]) : deflateSync(Buffer.from([5, 255, 0, 0, 128])));
  const report = sampleReport(); report.snapshot.document.temporaryMeasures = [];
  const rendererUrl = runtime === 'native TS'
    ? new URL('../../src/modules/process-quality/process-eight-d-pdf.ts', import.meta.url).href
    : pathToFileURL(join(compiledDirectory, 'process-eight-d-pdf.js')).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { readFileSync } from 'node:fs';
    import assert from 'node:assert/strict';
    import { renderProcessEightDPdf } from ${JSON.stringify(rendererUrl)};
    const { report, id, bad, good } = JSON.parse(readFileSync(0, 'utf8'));
    await assert.rejects(renderProcessEightDPdf(report, new Map([[id, Buffer.from(bad, 'base64')]])),
      { message: 'PROCESS_EIGHT_D_REPORT_RENDER_FAILED' });
    console.log('RENDER_REJECTED');
    const bytes = await renderProcessEightDPdf(report, new Map([[id, Buffer.from(good, 'base64')]]));
    if (bytes.subarray(0, 5).toString() !== '%PDF-') process.exit(3);
    console.log('PARENT_ALIVE');
  `], { input: JSON.stringify({ report, id: imageId, bad: bad.toString('base64'), good: png.toString('base64') }), encoding: 'utf8', timeout: 4000 });
  expect(child.stderr).toBe('');
  expect({ status: child.status, signal: child.signal, error: child.error?.message }).toEqual({ status: 0, signal: null, error: undefined });
  expect(child.stdout).toContain('RENDER_REJECTED');
  expect(child.stdout).toContain('PARENT_ALIVE');
});

it.each(['extra scanlines', 'truncated scanlines', 'repeated header'])('bounds PNG external inflate allocations and rejects %s before PDFKit decoding', async kind => {
  const raw = kind === 'extra scanlines' ? Buffer.alloc(10000) : kind === 'truncated scanlines' ? Buffer.alloc(1) : Buffer.from([0, 255, 0, 0, 128]);
  const bad = rgbaPng(deflateSync(raw), kind === 'repeated header');
  await expect(renderProcessEightDPdf(sampleReport(), new Map([[imageId, bad]]))).rejects.toThrow('PROCESS_EIGHT_D_REPORT_RENDER_FAILED');
});

it('rejects excessive page counts instead of exhausting buffered-page memory or silently truncating', async () => {
  const report = sampleReport(); report.snapshot.document.description = '\n'.repeat(18000);
  await expect(renderProcessEightDPdf(report, new Map([[imageId, png]]))).rejects.toThrow('PROCESS_EIGHT_D_REPORT_PDF_LIMIT');
}, 30000);
