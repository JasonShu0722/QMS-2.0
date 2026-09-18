import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

export interface EnqueueOutboxEventInput {
  eventKey: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Prisma.InputJsonObject;
}

interface OutboxWriter {
  outboxEvent: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
}

@Injectable()
export class OutboxService {
  constructor(@Inject(PrismaService) private readonly prisma: OutboxWriter) {}

  async enqueue(input: EnqueueOutboxEventInput, transaction?: OutboxWriter): Promise<unknown> {
    const writer = transaction ?? this.prisma;
    return writer.outboxEvent.create({
      data: {
        eventKey: input.eventKey,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        eventType: input.eventType,
        payload: input.payload,
        status: 'PENDING',
      },
    });
  }
}
