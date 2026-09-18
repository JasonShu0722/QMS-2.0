import { jest } from '@jest/globals';
import { OutboxService } from '../../src/modules/task-notification/outbox.service.js';
import { OUTBOX_LEASE_MS, OutboxWorkerService, runConfiguredWorker } from '../../src/modules/task-notification/outbox-worker.service.js';

describe('transactional outbox foundation', () => {
  it('does not claim pending events without an explicitly configured handler', async () => {
    const prisma = { $transaction: jest.fn(), $queryRaw: jest.fn() };
    await runConfiguredWorker(new OutboxWorkerService(prisma as never), null);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('runs the explicitly configured handler', async () => {
    const worker = { processDue: jest.fn().mockResolvedValue({ processed: 0 }) };
    const handler = jest.fn(async () => {});
    await runConfiguredWorker(worker as never, handler);
    expect(worker.processDue).toHaveBeenCalledWith(25, handler);
  });

  it.each([0, -1, 1.5, NaN, Infinity, 101])('rejects invalid batch limit %s before claiming', async (limit) => {
    const prisma = { $transaction: jest.fn() };
    await expect(new OutboxWorkerService(prisma as never).processDue(limit, async () => {}))
      .rejects.toThrow('OUTBOX_LIMIT_INVALID');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('enqueues events through the caller transaction', async () => {
    const tx = {
      outboxEvent: {
        create: jest.fn().mockResolvedValue({ id: 'event-id' }),
      },
    };
    const service = new OutboxService({} as never);

    await service.enqueue(
      {
        eventKey: 'foundation.event.1',
        aggregateType: 'Foundation',
        aggregateId: 'foundation-1',
        eventType: 'FOUNDATION_EVENT',
        payload: { publicId: 'foundation-1' },
      },
      tx as never,
    );

    expect(tx.outboxEvent.create).toHaveBeenCalledWith({
      data: {
        eventKey: 'foundation.event.1',
        aggregateType: 'Foundation',
        aggregateId: 'foundation-1',
        eventType: 'FOUNDATION_EVENT',
        payload: { publicId: 'foundation-1' },
        status: 'PENDING',
      },
    });
  });

  it('claims a limited number of pending events and applies bounded exponential retry', async () => {
    const now = new Date('2026-09-18T00:00:00.000Z');
    const claimed = [{ id: 'event-1', attempts: 4, payload: {}, eventType: 'FOUNDATION_EVENT', processingAt: now }];
    const prisma = {
      $transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => work(prisma)),
      $queryRaw: jest.fn().mockResolvedValue(claimed),
      outboxEvent: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const worker = new OutboxWorkerService(prisma as never, () => now);

    const result = await worker.processDue(10, async () => {
      throw new Error('transport unavailable');
    });

    expect(result).toEqual({ processed: 0, failed: 1, retried: 0 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.outboxEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'event-1', status: 'PROCESSING', processingAt: now },
      data: expect.objectContaining({
        attempts: { increment: 1 },
        status: 'FAILED',
        lastError: 'transport unavailable',
        processingAt: null,
      }),
    });
  });

  it('does not run handlers twice when workers claim due events concurrently', async () => {
    const now = new Date('2026-09-18T00:00:00.000Z');
    const pending = [
      { id: 'event-1', attempts: 0, payload: {}, eventType: 'FOUNDATION_EVENT' },
      { id: 'event-2', attempts: 0, payload: {}, eventType: 'FOUNDATION_EVENT' },
    ];
    const handled: string[] = [];
    const prisma = {
      $transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => work(prisma)),
      $queryRaw: jest.fn(async () => pending.splice(0, 2)),
      outboxEvent: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const worker = new OutboxWorkerService(prisma as never, () => now);

    const results = await Promise.all([
      worker.processDue(2, async (event) => {
        handled.push(event.id);
      }),
      worker.processDue(2, async (event) => {
        handled.push(event.id);
      }),
    ]);

    expect(results).toEqual([
      { processed: 2, failed: 0, retried: 0 },
      { processed: 0, failed: 0, retried: 0 },
    ]);
    expect(handled.sort()).toEqual(['event-1', 'event-2']);
    expect(new Set(handled).size).toBe(handled.length);
  });

  it('manually retries failed events by returning them to pending state', async () => {
    const prisma = {
      outboxEvent: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ id: 'event-1', status: 'PENDING' }),
      },
    };
    const worker = new OutboxWorkerService(prisma as never);

    await expect(worker.retryFailed('event-1')).resolves.toMatchObject({ status: 'PENDING' });
    expect(prisma.outboxEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'event-1', status: 'FAILED' },
      data: {
        status: 'PENDING',
        attempts: 0,
        lastError: null,
        availableAt: expect.any(Date),
        processedAt: null,
        processingAt: null,
      },
    });
  });

  it('does not reopen processed or already pending events for manual retry', async () => {
    const prisma = {
      outboxEvent: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn(),
      },
    };
    const worker = new OutboxWorkerService(prisma as never);

    await expect(worker.retryFailed('event-1')).rejects.toThrow('OUTBOX_RETRY_REQUIRES_FAILED');
    expect(prisma.outboxEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'event-1', status: 'FAILED' },
      }),
    );
    expect(prisma.outboxEvent.findUnique).not.toHaveBeenCalled();
  });

  it('recovers a stuck processing event after its lease expires without consuming a handler attempt', async () => {
    let now = new Date('2026-09-18T00:00:00.000Z');
    const event = { id: 'stuck', attempts: 2, payload: {}, eventType: 'TEST',
      status: 'PROCESSING', processingAt: now };
    const prisma = {
      $transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => work(prisma)),
      $queryRaw: jest.fn(async (query: { sql: string; values: unknown[] }) => {
        expect(query.sql).toContain('FOR UPDATE SKIP LOCKED');
        expect(query.sql).toContain('"status" = \'PENDING\'');
        expect(query.sql).toContain('OR ("status" = \'PROCESSING\'');
        expect(query.sql).toContain('"processing_at" <=');
        const cutoff = query.values[2] as Date;
        if (event.processingAt > cutoff) return [];
        event.processingAt = query.values[0] as Date;
        return [{ ...event }];
      }),
      outboxEvent: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const handler = jest.fn(async () => {});
    const worker = new OutboxWorkerService(prisma as never, () => now);
    expect(await worker.processDue(1, handler)).toEqual({ processed: 0, failed: 0, retried: 0 });
    now = new Date(now.getTime() + OUTBOX_LEASE_MS);
    expect(await worker.processDue(1, handler)).toEqual({ processed: 1, failed: 0, retried: 0 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(prisma.outboxEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'stuck', status: 'PROCESSING', processingAt: now },
      data: { status: 'PROCESSED', processedAt: now, processingAt: null, lastError: null },
    });
  });

  it('reports completion storage failures without retrying or incrementing handler attempts', async () => {
    const processingAt = new Date();
    const storageError = new Error('database unavailable');
    const prisma = {
      $transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => work(prisma)),
      $queryRaw: jest.fn().mockResolvedValue([
        { id: 'event-1', attempts: 0, payload: {}, eventType: 'TEST', processingAt },
      ]),
      outboxEvent: { updateMany: jest.fn().mockRejectedValue(storageError) },
    };
    await expect(new OutboxWorkerService(prisma as never).processDue(1, async () => {}))
      .rejects.toMatchObject({ message: 'OUTBOX_COMPLETION_UPDATE_FAILED', cause: storageError });
    expect(prisma.outboxEvent.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.outboxEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ attempts: expect.anything() }),
    }));
  });
});
