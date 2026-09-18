import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 1_000;
export const OUTBOX_CLOCK = 'QMS_OUTBOX_CLOCK';

interface OutboxEvent {
  id: string;
  attempts: number;
  payload: unknown;
  eventType: string;
}

interface OutboxClient {
  outboxEvent: {
    findMany(args: Record<string, unknown>): Promise<OutboxEvent[]>;
    findUnique(args: Record<string, unknown>): Promise<unknown>;
    update(args: Record<string, unknown>): Promise<unknown>;
    updateMany(args: Record<string, unknown>): Promise<{ count: number }>;
  };
}

export interface OutboxProcessResult {
  processed: number;
  failed: number;
  retried: number;
}

@Injectable()
export class OutboxWorkerService {
  constructor(
    @Inject(PrismaService) private readonly prisma: OutboxClient,
    @Optional()
    @Inject(OUTBOX_CLOCK)
    private readonly now: () => Date = () => new Date(),
  ) {}

  async processDue(
    limit: number,
    handler: (event: OutboxEvent) => Promise<void>,
  ): Promise<OutboxProcessResult> {
    const client = this.prisma;
    const now = this.now();
    const events = await client.outboxEvent.findMany({
      take: limit,
      orderBy: { createdAt: 'asc' },
      where: {
        status: 'PENDING',
        availableAt: { lte: now },
      },
    });
    const result: OutboxProcessResult = { processed: 0, failed: 0, retried: 0 };

    for (const event of events) {
      try {
        await handler(event);
        await client.outboxEvent.update({
          where: { id: event.id },
          data: { status: 'PROCESSED', processedAt: this.now(), lastError: null },
        });
        result.processed += 1;
      } catch (error) {
        const nextAttempts = event.attempts + 1;
        const failed = nextAttempts >= MAX_ATTEMPTS;
        await client.outboxEvent.update({
          where: { id: event.id },
          data: {
            attempts: { increment: 1 },
            status: failed ? 'FAILED' : 'PENDING',
            availableAt: failed ? eventAvailableNow(this.now()) : this.nextAttemptAt(nextAttempts),
            lastError: errorMessage(error),
          },
        });
        if (failed) result.failed += 1;
        else result.retried += 1;
      }
    }

    return result;
  }

  async retryFailed(eventId: string): Promise<unknown> {
    const retry = await this.prisma.outboxEvent.updateMany({
      where: { id: eventId, status: 'FAILED' },
      data: {
        status: 'PENDING',
        attempts: 0,
        lastError: null,
        availableAt: this.now(),
        processedAt: null,
      },
    });
    if (retry.count !== 1) throw new Error('OUTBOX_RETRY_REQUIRES_FAILED');

    return this.prisma.outboxEvent.findUnique({
      where: { id: eventId },
    });
  }

  private nextAttemptAt(attempts: number): Date {
    const delay = BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1);
    return new Date(this.now().getTime() + delay);
  }
}

function eventAvailableNow(now: Date): Date {
  return now;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 1_000);
  return 'Unknown outbox handler error';
}
