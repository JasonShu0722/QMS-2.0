import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { ServiceOperationReceiptService } from '../../src/modules/task-notification/service-operation-receipt.service.js';

describe('bounded latest service execution receipts', () => {
  const started = new Date('2026-10-30T04:00:00.000Z');
  function fixture() {
    const execute = jest.fn<(...args: unknown[]) => Promise<number>>(async () => 1);
    const transaction = jest.fn(async (work: (tx: { $executeRaw: typeof execute }) => Promise<unknown>, _options?: unknown) => work({ $executeRaw: execute }));
    return { execute, transaction, receipts: new ServiceOperationReceiptService({ $executeRaw: execute, $transaction: transaction } as never) };
  }
  it('writes a fixed Worker producer identity without recording raw failures', async () => {
    const f = fixture(); const producer = randomUUID();
    await f.receipts.recordWorker(producer, 'SUCCEEDED', started, { processed: 3, failed: 1, retried: 2 });
    const values = f.execute.mock.calls.at(-1)!;
    expect(values).toEqual(expect.arrayContaining([`worker:${producer}`, 'UNSCOPED', 'WORKER', producer, 'SUCCEEDED', 3, 1, 2]));
  });
  it('keeps PDF execution distinct from a persistent queue and uses a fixed org/domain row', async () => {
    const f = fixture(); const organizationId = randomUUID(); const execution = randomUUID();
    await f.receipts.recordPdf(organizationId, 'customer-quality', execution, 'FAILED', started);
    expect(f.execute.mock.calls.at(-1)).toEqual(expect.arrayContaining([`pdf:${organizationId}:customer-quality`, organizationId, 'PDF', 'customer-quality', execution, 'FAILED', 'PDF_RENDER_FAILED']));
  });
  it('never changes the original operation result if observation storage is unavailable', async () => {
    const f = fixture(); f.execute.mockRejectedValueOnce(new Error('PRIVATE_DATABASE_PASSWORD'));
    await expect(f.receipts.recordWorker(randomUUID(), 'STARTED', started)).resolves.toBe(false);
  });
  it('rejects unbounded internal input before database writes', async () => {
    const f = fixture();
    await expect(f.receipts.recordWorker('private-host', 'STARTED', started)).rejects.toThrow();
    await expect(f.receipts.recordPdf(randomUUID(), 'PRIVATE_REPORT_BODY', randomUUID(), 'SUCCEEDED', started)).rejects.toThrow();
    await expect(f.receipts.recordWorker(randomUUID(), 'SUCCEEDED', started, { processed: 1e12, failed: 0, retried: 0 })).rejects.toThrow();
    expect(f.execute).not.toHaveBeenCalled();
  });
  it('bounds observation lock and connection waits instead of delaying the business indefinitely', async () => {
    const f = fixture();
    await f.receipts.recordWorker(randomUUID(), 'STARTED', started);
    expect(f.transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 250, timeout: 1000 });
    expect(String(f.execute.mock.calls[0]?.[0])).toContain('statement_timeout');
  });
});
