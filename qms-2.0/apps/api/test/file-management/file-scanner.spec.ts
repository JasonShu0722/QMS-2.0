import { createServer, type Socket } from 'node:net';
import { FileScannerService } from '../../src/modules/file-management/file-scanner.service.js';

describe('ClamAV bounded INSTREAM protocol', () => {
  const environment = { ...process.env };
  afterEach(() => { process.env = { ...environment }; });

  async function server(response: string | null, early = false) {
    const sockets = new Set<Socket>();
    let finalFrame = false;
    const listener = createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      let pending = Buffer.alloc(0);
      let command: string | null = null;
      socket.on('data', (chunk: Buffer) => {
        pending = Buffer.concat([pending, chunk]);
        if (!command) {
          const end = pending.indexOf(0);
          if (end < 0) return;
          command = pending.subarray(0, end).toString();
          pending = pending.subarray(end + 1);
          if (command === 'zVERSION') return void socket.end('ClamAV 1.5.4/28122/Test database\0');
          if (early && response !== null) return void socket.end(response);
        }
        while (pending.length >= 4) {
          const length = pending.readUInt32BE(0);
          if (pending.length < 4 + length) return;
          pending = pending.subarray(4 + length);
          if (length === 0) {
            finalFrame = true;
            if (response !== null) socket.end(response);
            return;
          }
        }
      });
    });
    await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
    process.env.QMS_FILE_SCANNER_HOST = '127.0.0.1';
    process.env.QMS_FILE_SCANNER_PORT = String((listener.address() as { port: number }).port);
    process.env.QMS_FILE_SCANNER_TIMEOUT_MS = '100';
    return { finalFrame: () => finalFrame, close: async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>((resolve) => listener.close(() => resolve())); } };
  }

  it('requires configured scanner coordinates and refuses oversized input', async () => {
    delete process.env.QMS_FILE_SCANNER_HOST;
    await expect(new FileScannerService().scan(Buffer.from('clean'))).rejects.toThrow('FILE_SCANNER_CONFIGURATION_REQUIRED');
    await expect(new FileScannerService().scan(new Uint8Array(25 * 1024 * 1024 + 1))).rejects.toThrow('FILE_SCAN_SIZE_INVALID');
  });

  it('accepts only a complete OK after a terminated INSTREAM and records engine identity', async () => {
    const fixture = await server('stream: OK\0');
    try {
      expect(await new FileScannerService().scan(Buffer.from('clean text'))).toMatchObject({ clean: true, engine: 'ClamAV 1.5.4/28122/Test database' });
      expect(fixture.finalFrame()).toBe(true);
    } finally { await fixture.close(); }
  });

  it.each(['stream: OK', 'stream: UNKNOWN\0', 'stream: size limit exceeded ERROR\0', `stream: ${'x'.repeat(4096)}\0`])('refuses incomplete, unknown, error, or oversized responses', async (response) => {
    const fixture = await server(response);
    try { await expect(new FileScannerService().scan(Buffer.from('clean text'))).rejects.toThrow(); }
    finally { await fixture.close(); }
  });

  it('fails closed at the total deadline when the engine does not finish', async () => {
    const fixture = await server(null);
    try { await expect(new FileScannerService().scan(Buffer.from('clean text'))).rejects.toThrow('FILE_SCANNER_TIMEOUT'); }
    finally { await fixture.close(); }
  });

  it('rejects OK sent before the complete INSTREAM has been transmitted', async () => {
    const fixture = await server('stream: OK\0', true);
    try { await expect(new FileScannerService().scan(new Uint8Array(8 * 1024 * 1024))).rejects.toThrow(); }
    finally { await fixture.close(); }
  });

  it('keeps encrypted and limit detections quarantined without exposing the signature', async () => {
    const fixture = await server('stream: Heuristics.Encrypted.Zip FOUND\0');
    try { expect(await new FileScannerService().scan(Buffer.from('opaque archive'))).toMatchObject({ clean: false, reason: 'FILE_SCAN_POLICY_REJECTED' }); }
    finally { await fixture.close(); }
  });
});
