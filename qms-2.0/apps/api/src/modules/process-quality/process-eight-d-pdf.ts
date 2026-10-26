import { Worker } from 'node:worker_threads';
import type { ProcessEightDControlledReportDto } from './process-eight-d-report.dto.js';

export const REPORT_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const REPORT_TOTAL_IMAGE_BYTES = 32 * 1024 * 1024;
export const REPORT_TOTAL_IMAGE_PIXELS = 32_000_000;

// Inspect dimensions before PDFKit decompresses pixels; never accept a file path or URL.
export function reportImageSize(bytes: Buffer, contentType: string): { width: number; height: number } {
  let width = 0; let height = 0;
  if (bytes.length > REPORT_IMAGE_MAX_BYTES) throw new Error('PROCESS_EIGHT_D_REPORT_IMAGE_LIMIT');
  if (contentType === 'image/png' && bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    && bytes.readUInt32BE(8) === 13 && bytes.toString('ascii', 12, 16) === 'IHDR') {
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
  } else if (contentType === 'image/jpeg' && bytes.length >= 4 && bytes.readUInt16BE(0) === 0xffd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || marker === 0xd8 || marker !== undefined && marker >= 0xd0 && marker <= 0xd7) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (marker !== undefined && [0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) {
        height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); break;
      }
      offset += length;
    }
  }
  if (!width || !height) throw new Error('PROCESS_EIGHT_D_REPORT_IMAGE_INVALID');
  if (width > 8192 || height > 8192 || width * height > 16_000_000) throw new Error('PROCESS_EIGHT_D_REPORT_IMAGE_LIMIT');
  return { width, height };
}

export async function renderProcessEightDPdf(report: ProcessEightDControlledReportDto, images: ReadonlyMap<string, Buffer>): Promise<Buffer> {
  const document = report.snapshot.document;
  const references = [...document.okFileIds, ...document.ngFileIds, ...document.analysisFileIds,
    ...document.temporaryMeasures.flatMap(row => row.fileIds),
    ...document.correctiveActions.flatMap(row => [...row.fileIds, ...row.verificationFileIds]),
    ...document.horizontalDeployment.flatMap(row => row.fileIds)];
  const counts = new Map<string, number>();
  for (const id of references) counts.set(id, (counts.get(id) ?? 0) + 1);
  let total = 0; let pixels = 0;
  const dimensions = new Map<string, { width: number; height: number }>();
  const embedded = new Map<string, Buffer>();
  for (const attachment of report.attachments.filter(file => file.rendering === 'EMBEDDED')) {
    const bytes = images.get(attachment.id);
    if (!bytes) throw new Error('PROCESS_EIGHT_D_REPORT_IMAGE_MISSING');
    const size = reportImageSize(bytes, attachment.contentType);
    dimensions.set(attachment.id, size); embedded.set(attachment.id, bytes);
    pixels += size.width * size.height * Math.max(1, counts.get(attachment.id) ?? 0);
    total += bytes.length;
  }
  if (total > REPORT_TOTAL_IMAGE_BYTES || pixels > REPORT_TOTAL_IMAGE_PIXELS) throw new Error('PROCESS_EIGHT_D_REPORT_IMAGE_LIMIT');
  // PDFKit's asynchronous PNG callbacks can throw outside its stream; isolate the whole renderer.
  const workerUrl = new URL(import.meta.url.endsWith('.ts') ? './process-eight-d-pdf.worker.ts' : './process-eight-d-pdf.worker.js', import.meta.url);
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl, { workerData: { report, images: embedded, dimensions }, execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 } });
    let settled = false;
    const finish = (error?: Error, content?: Buffer) => {
      if (settled) return;
      settled = true; clearTimeout(timer); void worker.terminate();
      if (error) reject(error); else resolve(content!);
    };
    const timer = setTimeout(() => finish(new Error('PROCESS_EIGHT_D_REPORT_RENDER_FAILED')), 15000);
    worker.once('message', (content: unknown) => {
      if (!(content instanceof Uint8Array) || content.byteLength > 64 * 1024 * 1024) finish(new Error('PROCESS_EIGHT_D_REPORT_PDF_LIMIT'));
      else finish(undefined, Buffer.from(content));
    });
    worker.once('error', error => finish(new Error(error.message === 'PROCESS_EIGHT_D_REPORT_PDF_LIMIT'
      ? error.message : 'PROCESS_EIGHT_D_REPORT_RENDER_FAILED')));
    worker.once('exit', () => finish(new Error('PROCESS_EIGHT_D_REPORT_RENDER_FAILED')));
  });
}
