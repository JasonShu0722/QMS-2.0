import { Inject, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 1_000;
export const OUTBOX_LEASE_MS = 5 * 60_000;
export const OUTBOX_CLOCK = 'QMS_OUTBOX_CLOCK';
export const OUTBOX_HANDLER = 'QMS_OUTBOX_HANDLER';
export type OutboxHandler = (event: OutboxEvent) => Promise<void>;

interface OutboxEvent {
  id: string;
  attempts: number;
  payload: unknown;
  eventType: string;
  processingAt: Date;
}

interface OutboxClient {
  $transaction<T>(work: (tx: OutboxClient) => Promise<T>): Promise<T>;
  $queryRaw<T>(query: unknown): Promise<T>;
  outboxEvent: {
    findUnique(args: Record<string, unknown>): Promise<unknown>;
    updateMany(args: Record<string, unknown>): Promise<{ count: number }>;
  };
}

export interface OutboxProcessResult {
  processed: number;
  failed: number;
  retried: number;
}

export async function runConfiguredWorker(
  worker: OutboxWorkerService,
  handler: OutboxHandler | null,
): Promise<void> {
  // Phase 1 has no business handlers. Do not claim pending events until configured.
  if (typeof handler !== 'function') return;
  await worker.processDue(25, handler);
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
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('OUTBOX_LIMIT_INVALID');
    }
    const client = this.prisma;
    const now = this.now();
    const events = await client.$transaction((tx) => this.claimDue(tx, limit, now));
    const result: OutboxProcessResult = { processed: 0, failed: 0, retried: 0 };

    for (const event of events) {
      try {
        await handler(event);
      } catch (error) {
        const nextAttempts = event.attempts + 1;
        const failed = nextAttempts >= MAX_ATTEMPTS;
        const completion = await client.outboxEvent.updateMany({
          where: { id: event.id, status: 'PROCESSING', processingAt: event.processingAt },
          data: {
            processingAt: null,
            attempts: { increment: 1 },
            status: failed ? 'FAILED' : 'PENDING',
            availableAt: failed ? this.now() : this.nextAttemptAt(nextAttempts),
            lastError: errorMessage(error),
          },
        });
        if (completion.count === 1) {
          if (failed) result.failed += 1;
          else result.retried += 1;
        }
        continue;
      }
      // Completion failures are infrastructure errors, not handler failures.
      // Keep the lease so another worker can recover after it expires.
      try {
        const completion = await client.outboxEvent.updateMany({
          where: { id: event.id, status: 'PROCESSING', processingAt: event.processingAt },
          data: { status: 'PROCESSED', processedAt: this.now(), processingAt: null, lastError: null },
        });
        if (completion.count === 1) result.processed += 1;
      } catch (error) {
        throw new Error('OUTBOX_COMPLETION_UPDATE_FAILED', { cause: error });
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
        processingAt: null,
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

  private claimDue(client: OutboxClient, limit: number, now: Date): Promise<OutboxEvent[]> {
    return client.$queryRaw<OutboxEvent[]>(Prisma.sql`
      UPDATE "outbox_events"
      SET "status" = 'PROCESSING'::"OutboxStatus", "processing_at" = ${now}
      WHERE "id" IN (
        SELECT "id"
        FROM "outbox_events"
        WHERE ("status" = 'PENDING'::"OutboxStatus" AND "available_at" <= ${now})
          OR ("status" = 'PROCESSING'::"OutboxStatus"
            AND "processing_at" <= ${new Date(now.getTime() - OUTBOX_LEASE_MS)})
        ORDER BY "created_at" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING
        "id",
        "attempts",
        "processing_at" AS "processingAt",
        "payload",
        "event_type" AS "eventType"
    `);
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 1_000);
  return 'Unknown outbox handler error';
}
