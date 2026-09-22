import { Injectable } from '@nestjs/common';
import { createConnection } from 'node:net';

export type FileScanVerdict = { clean: boolean; engine: string; reason: 'FILE_MALWARE_DETECTED' | 'FILE_SCAN_POLICY_REJECTED' | null };

@Injectable()
export class FileScannerService {
  configuration() {
    const host = process.env.QMS_FILE_SCANNER_HOST;
    const port = Number(process.env.QMS_FILE_SCANNER_PORT);
    const timeoutMs = Number(process.env.QMS_FILE_SCANNER_TIMEOUT_MS ?? '30000');
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) throw new Error('FILE_SCANNER_CONFIGURATION_REQUIRED');
    return { host, port, timeoutMs };
  }

  async scan(bytes: Uint8Array): Promise<FileScanVerdict> {
    if (bytes.byteLength < 1 || bytes.byteLength > 25 * 1024 * 1024) throw new Error('FILE_SCAN_SIZE_INVALID');
    const configuration = this.configuration();
    const deadline = Date.now() + configuration.timeoutMs;
    const engine = await this.command('VERSION', undefined, deadline);
    if (!/^ClamAV [\w.]+\/\d+\/.{1,200}$/.test(engine)) throw new Error('FILE_SCANNER_PROTOCOL_INVALID');
    const response = await this.command('INSTREAM', bytes, deadline);
    if (response === 'stream: OK') return { clean: true, engine, reason: null };
    if (/^stream: .+ FOUND$/.test(response)) return { clean: false, engine, reason: /Heuristics\.(Limits|Encrypted)/.test(response) ? 'FILE_SCAN_POLICY_REJECTED' : 'FILE_MALWARE_DETECTED' };
    throw new Error('FILE_SCANNER_SCAN_FAILED');
  }

  private command(command: 'VERSION' | 'INSTREAM', bytes: Uint8Array | undefined, deadline: number): Promise<string> {
    const { host, port } = this.configuration();
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host, port });
      let response = Buffer.alloc(0);
      let completed = false;
      let sentFinalFrame = false;
      const finish = (error?: Error, value?: string) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        socket.destroy();
        if (error) reject(error); else resolve(value!);
      };
      const timer = setTimeout(() => finish(new Error('FILE_SCANNER_TIMEOUT')), Math.max(1, deadline - Date.now()));
      const write = (chunk: Uint8Array) => new Promise<void>((done, fail) => socket.write(chunk, (error) => error ? fail(error) : done()));
      socket.once('error', () => finish(new Error('FILE_SCANNER_UNAVAILABLE')));
      socket.once('end', () => { if (!completed) finish(new Error('FILE_SCANNER_RESPONSE_INCOMPLETE')); });
      socket.on('data', (chunk: Buffer) => {
        response = Buffer.concat([response, chunk]);
        if (response.length > 4096) return finish(new Error('FILE_SCANNER_RESPONSE_LIMIT'));
        const terminator = response.indexOf(0);
        if (terminator < 0) return;
        if (terminator !== response.length - 1 || !sentFinalFrame) return finish(new Error('FILE_SCANNER_PROTOCOL_INVALID'));
        finish(undefined, response.subarray(0, terminator).toString('utf8'));
      });
      socket.once('connect', () => {
        void (async () => {
          if (command === 'VERSION') sentFinalFrame = true;
          await write(Buffer.from(`z${command}\0`));
          if (bytes) {
            for (let offset = 0; offset < bytes.byteLength; offset += 65536) {
              const chunk = bytes.subarray(offset, Math.min(offset + 65536, bytes.byteLength));
              const length = Buffer.alloc(4);
              length.writeUInt32BE(chunk.byteLength);
              await write(length);
              await write(chunk);
            }
            sentFinalFrame = true;
            await write(Buffer.alloc(4));
          }
        })().catch(() => finish(new Error('FILE_SCANNER_TRANSMISSION_FAILED')));
      });
    });
  }
}
