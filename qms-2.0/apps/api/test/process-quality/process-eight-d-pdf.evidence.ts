import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { renderProcessEightDPdf } from '../../src/modules/process-quality/process-eight-d-pdf.js';
import { imageId, sampleReport } from './process-eight-d-pdf.fixture.js';

// Independent renderer evidence only: no database, object store, session or scanner acceptance claim.
const output = resolve(process.argv[2] ?? '');
assert(process.argv[2] && output.replace(/\\/g, '/').startsWith('D:/WorkSpace/QMS-2.0-local/n3-evidence/'), 'Use the authorized non-Git evidence directory');
const { createCanvas } = createRequire(import.meta.resolve('pdfjs-dist/package.json'))('@napi-rs/canvas');
const source = createCanvas(640, 320);
const context = source.getContext('2d');
context.fillStyle = '#f0f6f8'; context.fillRect(0, 0, 640, 320);
context.fillStyle = '#137c54'; context.fillRect(30, 40, 260, 230);
context.fillStyle = '#cc4238'; context.fillRect(350, 40, 260, 230);
context.fillStyle = 'white'; context.font = '42px sans-serif'; context.fillText('OK', 110, 170); context.fillText('NG', 430, 170);
const png: Buffer = source.toBuffer('image/png');
const jpeg: Buffer = source.toBuffer('image/jpeg');
const jpegId = '10000000-0000-4000-8000-000000000003';
const report = sampleReport();
report.snapshot.document.analysisFileIds = [jpegId];
report.snapshot.document.correctiveActions[0]!.verificationFileIds = [jpegId];
report.snapshot.document.description += '\n渲染验证样本，图片为人工构造测试图，不是真实业务或扫描验收证据。';
report.attachments[0] = { ...report.attachments[0]!, sizeBytes: png.length, sha256: createHash('sha256').update(png).digest('hex') };
report.attachments.push({ ...report.attachments[0]!, id: jpegId, originalName: '分析与验证测试图.jpg', contentType: 'image/jpeg', sizeBytes: jpeg.length,
  sha256: createHash('sha256').update(jpeg).digest('hex'), uses: ['D4 分析', 'D6 验证 action-1'] });
const bytes = await renderProcessEightDPdf(report, new Map([[imageId, png], [jpegId, jpeg]]));
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'eight-d-long-table.pdf'), bytes);
await writeFile(resolve(output, 'source-render-sample.png'), png);
await writeFile(resolve(output, 'source-render-sample.jpg'), jpeg);
const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
const pdf = await loading.promise;
const evidence: { page: number; imageOperators: number; textCharacters: number; png: string; coloredPixels: number }[] = [];
let text = '';
try {
  assert(pdf.numPages > 3);
  for (let index = 1; index <= pdf.numPages; index++) {
    const page = await pdf.getPage(index);
    const pageText = (await page.getTextContent()).items.map(item => 'str' in item ? item.str : '').join('');
    assert(pageText.includes(`第 ${index} / ${pdf.numPages} 页`));
    text += pageText + '\n';
    const operators = await page.getOperatorList();
    const imageOperators = operators.fnArray.filter(op => op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject).length;
    const viewport = page.getViewport({ scale: 1 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvas, viewport }).promise;
    const filename = `page-${String(index).padStart(2, '0')}.png`;
    await writeFile(resolve(output, filename), canvas.toBuffer('image/png'));
    await writeFile(resolve(output, filename.replace('.png', '.jpg')), canvas.toBuffer('image/jpeg'));
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let coloredPixels = 0;
    for (let pixel = 0; pixel < pixels.length; pixel += 4) {
      const red = pixels[pixel]!; const green = pixels[pixel + 1]!; const blue = pixels[pixel + 2]!;
      if (red > 140 && green < 120 && blue < 120 || green > 80 && green > red * 1.5 && green > blue * 1.2) coloredPixels++;
    }
    if (imageOperators) assert(coloredPixels > 1000, `Page ${index} must render real colored image pixels`);
    evidence.push({ page: index, imageOperators, textCharacters: pageText.length, png: filename, coloredPixels });
  }
  assert(text.includes('围堵长表第80行'));
  assert(text.includes('旧轮已失效'));
  assert(text.includes('同人跳过（非签批）'));
  assert(evidence.reduce((sum, page) => sum + page.imageOperators, 0) >= 3);
  await writeFile(resolve(output, 'extracted-text.txt'), text);
  await writeFile(resolve(output, 'render-evidence.json'), JSON.stringify({ evidenceKind: 'PURE_RENDER_NOT_SERVICE_INTEGRATION',
    humanVisualAcceptance: 'NOT_RUN', pdfSha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, pages: evidence }, null, 2));
  console.log(JSON.stringify({ output, pages: pdf.numPages, imageOperators: evidence.reduce((sum, page) => sum + page.imageOperators, 0),
    bytes: bytes.length, humanVisualAcceptance: 'NOT_RUN' }));
} finally { await loading.destroy(); }
