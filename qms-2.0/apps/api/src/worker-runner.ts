import type { OutboxHandler, OutboxWorkerService } from './modules/task-notification/outbox-worker.service.js';
import { setTimeout as delay } from 'node:timers/promises';

export interface WorkerOptions { once: boolean; pollIntervalMs: number; batchSize: number }
export interface WorkerCycleResult { processed: number; failed: number; retried: number }
export type WorkerCycleObserver = (result: WorkerCycleResult) => void | Promise<void>;

export function parseWorkerOptions(args: string[], environment: Record<string, string | undefined>): WorkerOptions {
  if (args.some((argument) => argument !== '--once') || args.length > 1) throw new Error('WORKER_CONFIGURATION_INVALID');
  return {
    once: args.includes('--once'),
    pollIntervalMs: setting(environment.QMS_WORKER_POLL_INTERVAL_MS, 1000, 100, 60_000),
    batchSize: setting(environment.QMS_WORKER_BATCH_SIZE, 25, 1, 100),
  };
}

export async function runWorkerLoop(worker: OutboxWorkerService, handler: OutboxHandler | null, options: WorkerOptions, signal: AbortSignal, maintenance?: () => Promise<void>, observeCycle?: WorkerCycleObserver): Promise<void> {
  if (!handler) throw new Error('WORKER_HANDLER_REQUIRED');
  while (!signal.aborted) {
    await maintenance?.();
    const result = typeof handler === 'function'
      ? await worker.processDue(options.batchSize, handler)
      : await worker.processAtomicDue(options.batchSize, handler);
    await observeCycle?.(result);
    if (options.once || signal.aborted) return;
    try { await delay(options.pollIntervalMs, undefined, { signal }); }
    catch (error) { if (!signal.aborted) throw error; }
  }
}

function setting(raw: string | undefined, fallback: number, minimum: number, maximum: number): number {
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < minimum || Number(raw) > maximum) throw new Error('WORKER_CONFIGURATION_INVALID');
  return Number(raw);
}
