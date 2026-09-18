import { jest } from '@jest/globals';
import { OutboxService } from '../../src/modules/task-notification/outbox.service.js';
import { OutboxWorkerService } from '../../src/modules/task-notification/outbox-worker.service.js';

describe('transactional outbox foundation', () => {
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
    const prisma = {
      outboxEvent: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'event-1', attempts: 4, payload: {}, eventType: 'FOUNDATION_EVENT' },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const worker = new OutboxWorkerService(prisma as never, () => now);

    const result = await worker.processDue(10, async () => {
      throw new Error('transport unavailable');
    });

    expect(result).toEqual({ processed: 0, failed: 1, retried: 0 });
    expect(prisma.outboxEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 10,
        where: expect.objectContaining({
          status: 'PENDING',
          availableAt: { lte: now },
        }),
      }),
    );
    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: expect.objectContaining({
        attempts: { increment: 1 },
        status: 'FAILED',
        lastError: 'transport unavailable',
      }),
    });
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
});
