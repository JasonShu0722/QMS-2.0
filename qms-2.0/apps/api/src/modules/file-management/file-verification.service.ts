import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import type { FileObject } from '../../generated/prisma/client.js';
import { OBJECT_STORAGE, type ObjectStorage } from './object-storage.service.js';
import { FileScannerService } from './file-scanner.service.js';

export interface FileVerification {
  clean: boolean;
  sha256: string;
  sizeBytes: bigint;
  contentType: string | null;
  engine: string | null;
  reason: string | null;
}

@Injectable()
export class FileVerificationService {
  constructor(@Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage, private readonly scanner: FileScannerService) {}

  async verify(file: FileObject): Promise<FileVerification> {
    if (!file.objectVersionId) throw new Error('FILE_OBJECT_VERSION_REQUIRED');
    const chunks: Uint8Array[] = [];
    const hash = createHash('sha256');
    let sizeBytes = 0;
    for await (const chunk of this.storage.readVersion(file.objectKey, file.objectVersionId, 25 * 1024 * 1024)) {
      sizeBytes += chunk.byteLength;
      if (sizeBytes > 25 * 1024 * 1024) throw new Error('FILE_SCAN_SIZE_INVALID');
      hash.update(chunk);
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    const sha256 = hash.digest('hex');
    const measured = { sha256, sizeBytes: BigInt(sizeBytes), contentType: null, engine: null };
    if (BigInt(sizeBytes) !== file.sizeBytes || sha256 !== file.sha256) return { ...measured, clean: false, reason: 'FILE_CONTENT_MISMATCH' };
    const scan = await this.scanner.scan(bytes);
    if (!scan.clean) return { ...measured, engine: scan.engine, clean: false, reason: scan.reason };
    const contentType = await this.detectType(bytes);
    if (!contentType || contentType !== file.contentType) return { ...measured, contentType, engine: scan.engine, clean: false, reason: 'FILE_CONTENT_TYPE_MISMATCH' };
    return { ...measured, contentType, engine: scan.engine, clean: true, reason: null };
  }

  private detectType(bytes: Buffer): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(`
        const { parentPort, workerData } = require('node:worker_threads');
        (async () => {
          const { fileTypeFromBuffer } = await import(workerData.moduleUrl);
          const detected = await fileTypeFromBuffer(workerData.bytes);
          let mime = detected?.mime ?? null;
          if (!mime) {
            try {
              const text = new TextDecoder('utf-8', { fatal: true }).decode(workerData.bytes);
              if (text.length && !/[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]/.test(text)) mime = 'text/plain';
            } catch {}
          }
          parentPort.postMessage(mime);
        })().catch(() => parentPort.postMessage(null));
      `, { eval: true, workerData: { bytes, moduleUrl: import.meta.resolve('file-type') }, resourceLimits: { maxOldGenerationSizeMb: 96 } });
      const timer = setTimeout(() => { void worker.terminate(); reject(new Error('FILE_TYPE_DETECTION_TIMEOUT')); }, 5000);
      worker.once('message', (mime: unknown) => { clearTimeout(timer); void worker.terminate(); resolve(typeof mime === 'string' ? mime : null); });
      worker.once('error', () => { clearTimeout(timer); reject(new Error('FILE_TYPE_DETECTION_FAILED')); });
      worker.once('exit', (code) => { clearTimeout(timer); if (code !== 0) reject(new Error('FILE_TYPE_DETECTION_FAILED')); });
    });
  }
}
