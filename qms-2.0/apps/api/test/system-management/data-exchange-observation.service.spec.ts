import { BadRequestException } from '@nestjs/common';
import { normalizeDataExchangeEvent } from '../../src/modules/system-management/data-exchange-observation.service.js';

describe('bounded exchange metadata', () => {
  const event = { eventKey: 'evt-1', idempotencyKey: 'write-1', direction: 'INBOUND', objectType: 'FIXTURE', level: 'BATCH', correlationId: 'correlation-1', batchId: 'batch-1', attemptNumber: 1, stage: 'transfer', outcome: 'SUCCEEDED', observedCount: 3 };
  it('hashes opaque keys and normalizes fixed metadata only', () => {
    const result = normalizeDataExchangeEvent(event);
    expect(result.eventKeyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.idempotencyKeyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toMatch(/evt-1|write-1/);
  });
  it.each([
    { ...event, body: 'SECRET' }, { ...event, batchId: 'https://private?token=SECRET' },
    { ...event, observedCount: -1 }, { ...event, attemptNumber: 0 },
    { ...event, stage: 'everything' }, { ...event, errorCode: 'private-stack' },
    { ...event, level: 'RECORD', recordId: undefined },
  ])('rejects unbounded or nonmetadata input %j', input => {
    expect(() => normalizeDataExchangeEvent(input)).toThrow(BadRequestException);
  });
});
