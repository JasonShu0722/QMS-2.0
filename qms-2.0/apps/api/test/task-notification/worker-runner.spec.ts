import { jest } from '@jest/globals';
import { parseWorkerOptions, runWorkerLoop } from '../../src/worker-runner.js';
import type { OutboxWorkerService, OutboxHandler } from '../../src/modules/task-notification/outbox-worker.service.js';

describe('continuous worker runner', () => {
  it('parses bounded settings and explicit once mode', () => {
    expect(parseWorkerOptions([], {})).toEqual({ once: false, pollIntervalMs: 1000, batchSize: 25 });
    expect(parseWorkerOptions(['--once'], { QMS_WORKER_POLL_INTERVAL_MS: '100', QMS_WORKER_BATCH_SIZE: '1' })).toEqual({ once: true, pollIntervalMs: 100, batchSize: 1 });
  });

  it.each([
    { QMS_WORKER_POLL_INTERVAL_MS: '0' }, { QMS_WORKER_POLL_INTERVAL_MS: '99' }, { QMS_WORKER_POLL_INTERVAL_MS: '60001' },
    { QMS_WORKER_BATCH_SIZE: '1.5' }, { QMS_WORKER_BATCH_SIZE: '101' }, { QMS_WORKER_BATCH_SIZE: '' },
    { QMS_WORKER_BATCH_SIZE: 'NaN' }, { QMS_WORKER_BATCH_SIZE: '1e1' },
  ])('rejects invalid options %j', (environment) => {
    expect(() => parseWorkerOptions([], environment)).toThrow('WORKER_CONFIGURATION_INVALID');
  });

  it('rejects unknown arguments and missing handlers', async () => {
    expect(() => parseWorkerOptions(['--unknown'], {})).toThrow('WORKER_CONFIGURATION_INVALID');
    await expect(runWorkerLoop({} as OutboxWorkerService, null, parseWorkerOptions([], {}), new AbortController().signal)).rejects.toThrow('WORKER_HANDLER_REQUIRED');
  });

  it('keeps consuming batches until an abort', async () => {
    const stop = new AbortController();
    const worker = { processAtomicDue: jest.fn(async () => {
      if (worker.processAtomicDue.mock.calls.length === 2) stop.abort();
      return { processed: 0, retried: 0, failed: 0 };
    }) };
    const handler = { eventTypes: ['TEST'], handle: async () => {} };
    await runWorkerLoop(worker as unknown as OutboxWorkerService, handler, { once: false, pollIntervalMs: 100, batchSize: 10 }, stop.signal);
    expect(worker.processAtomicDue).toHaveBeenCalledTimes(2);
    expect(worker.processAtomicDue).toHaveBeenCalledWith(10, handler);
  });

  it('executes one batch for once mode', async () => {
    const worker = { processDue: jest.fn(async () => ({ processed: 0, retried: 0, failed: 0 })) };
    await runWorkerLoop(worker as unknown as OutboxWorkerService, async () => {}, parseWorkerOptions(['--once'], {}), new AbortController().signal);
    expect(worker.processDue).toHaveBeenCalledTimes(1);
  });

  it('interrupts an idle wait promptly', async () => {
    const stop = new AbortController();
    const worker = { processDue: jest.fn(async () => {
      setTimeout(() => stop.abort(), 10);
      return { processed: 0, retried: 0, failed: 0 };
    }) };
    const start = Date.now();
    await runWorkerLoop(worker as unknown as OutboxWorkerService, async () => {}, { once: false, pollIntervalMs: 60_000, batchSize: 25 }, stop.signal);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('waits for the active batch to finish before resolving and never claims another', async () => {
    const stop = new AbortController();
    let release!: () => void;
    const active = new Promise<void>((resolve) => { release = resolve; });
    const worker = { processDue: jest.fn(async () => { await active; return { processed: 0, retried: 0, failed: 0 }; }) };
    let resolved = false;
    const running = runWorkerLoop(worker as unknown as OutboxWorkerService, async () => {}, parseWorkerOptions([], {}), stop.signal).then(() => { resolved = true; });
    stop.abort();
    await Promise.resolve();
    expect(resolved).toBe(false);
    release();
    await running;
    expect(worker.processDue).toHaveBeenCalledTimes(1);
  });

  it('propagates infrastructure failure instead of retrying forever', async () => {
    const worker = { processDue: jest.fn(async () => { throw new Error('database unavailable'); }) };
    await expect(runWorkerLoop(worker as unknown as OutboxWorkerService, async () => {}, parseWorkerOptions([], {}), new AbortController().signal)).rejects.toThrow('database unavailable');
    expect(worker.processDue).toHaveBeenCalledTimes(1);
  });

  it('does not claim any work after shutdown was already requested', async () => {
    const stop = new AbortController();
    stop.abort();
    const worker = { processDue: jest.fn() };
    await runWorkerLoop(worker as unknown as OutboxWorkerService, (async () => {}) as OutboxHandler, parseWorkerOptions([], {}), stop.signal);
    expect(worker.processDue).not.toHaveBeenCalled();
  });
});
