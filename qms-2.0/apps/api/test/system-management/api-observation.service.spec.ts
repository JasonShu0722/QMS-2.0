import { EventEmitter } from 'node:events';
import { jest } from '@jest/globals';
import type { PrismaService } from '../../src/database/prisma.service.js';
import { OBSERVATION_ORGANIZATION } from '../../src/common/observability/http-observation-scope.js';
import { ApiObservationCollectorService } from '../../src/modules/system-management/api-observation-collector.service.js';
import { apiObservationMiddleware } from '../../src/modules/system-management/api-observation.middleware.js';

function fixture() {
  const writes: unknown[][] = [];
  const receipt = { committedBatch: 0, dropped: 0, failures: 0, lastFailureAt: null as Date | null };
  const tx = {
    $executeRaw: jest.fn(async (sql: unknown, ...values: unknown[]) => { writes.push(values); return 1; }),
    $queryRaw: jest.fn(async () => [{ ...receipt }]),
    apiObservationCollector: { upsert: jest.fn(async () => ({})), update: jest.fn(async ({ data }: { data: Partial<typeof receipt> }) => { Object.assign(receipt, data); return {}; }) },
  };
  let fail = false;
  const prisma = { $transaction: jest.fn(async (work: (client: typeof tx) => Promise<void>) => { if (fail) throw new Error('private-db-error'); return work(tx); }) };
  return { collector: new ApiObservationCollectorService(prisma as unknown as PrismaService), tx, prisma, writes, fail: (value: boolean) => { fail = value; } };
}
const scope = '11111111-1111-4111-8111-111111111111';
const at = new Date('2026-10-30T01:02:35Z');

describe('API observation bounded aggregation and HTTP completion', () => {
  it('aggregates static dimensions and exclusive latency buckets without recording raw content', async () => {
    const f = fixture();
    for (const duration of [10, 100, 300, 2000, 8000]) f.collector.record({ scopeKey: scope, method: 'GET', route: '/api/v1/tasks/:id', statusCode: 200, duration, at });
    await f.collector.flush();
    expect(f.writes[0]!.slice(1)).toEqual([new Date('2026-10-30T01:02:00Z'), scope, 'GET', '/api/v1/tasks/:id', 2, 5, 10410, 8000, 1, 1, 1, 1, 1, 2_000_000_000]);
    expect(f.collector.liveStatus().pendingBuckets).toBe(0);
  });
  it('normalizes malformed dimensions into bounded unknown values and caps latency', async () => {
    const f = fixture();
    f.collector.record({ scopeKey: 'private-tenant-query', method: 'PRIVATE_METHOD', route: '/api/v1/users/private?token=SECRET', statusCode: 503, duration: 9e12, at });
    await f.collector.flush();
    expect(f.writes[0]!.slice(2, 6)).toEqual(['UNSCOPED', 'OTHER', 'UNKNOWN', 5]);
    expect(JSON.stringify(f.writes)).not.toMatch(/private|SECRET/);
    expect(f.writes[0]![8]).toBe(3600000);
  });
  it('bounds pending buckets to 1000 and exposes drops instead of creating per-request promises', () => {
    const f = fixture();
    for (let i = 0; i < 1003; i++) f.collector.record({ method: 'GET', route: `/api/v1/registered-${i}`, statusCode: 200, duration: 1, at });
    expect(f.collector.liveStatus()).toMatchObject({ pendingBuckets: 1000, dropped: 3 });
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });
  it('keeps failed increments for retry and persists the same producer gap metadata after recovery', async () => {
    const f = fixture(); f.fail(true);
    f.collector.record({ scopeKey: scope, method: 'GET', route: '/api/v1/tasks', statusCode: 200, duration: 3, at });
    await expect(f.collector.flush()).resolves.toBeUndefined();
    expect(f.collector.liveStatus()).toMatchObject({ pendingBuckets: 1, failures: 1, lastFlushedAt: null });
    f.fail(false);
    f.collector.record({ scopeKey: scope, method: 'GET', route: '/api/v1/tasks', statusCode: 200, duration: 7, at });
    await f.collector.flush();
    await f.collector.flush();
    expect(f.writes.filter(values => typeof values[6] === 'number').reduce((total, values) => total + Number(values[6]), 0)).toBe(2);
    expect(f.tx.apiObservationCollector.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ failures: 1, lastFailureAt: expect.any(Date) }) }));
    expect(f.collector.liveStatus()).toMatchObject({ pendingBuckets: 0, failures: 1, lastFlushedAt: expect.any(Date) });
  });
  it('retains an immutable failed batch separately from new events instead of overflowing its counts', async () => {
    const f = fixture();
    f.collector.record({ scopeKey: scope, method: 'GET', route: '/api/v1/tasks', statusCode: 200, duration: 1, at });
    const pending = (f.collector as unknown as { pending: Map<string, { count: number; le50: number }> }).pending;
    pending.values().next().value!.count = 2_000_000_000;
    pending.values().next().value!.le50 = 2_000_000_000;
    f.prisma.$transaction.mockImplementationOnce(async () => {
      f.collector.record({ scopeKey: scope, method: 'GET', route: '/api/v1/tasks', statusCode: 200, duration: 1, at });
      throw new Error('private-db-error');
    });
    await f.collector.flush();
    expect(pending.values().next().value!.count).toBeLessThanOrEqual(2_000_000_000);
    const inFlight = (f.collector as unknown as { inFlight: { entries: Array<[string, { count: number }]> } }).inFlight;
    expect(inFlight.entries[0]![1].count).toBe(2_000_000_000);
    expect(pending.values().next().value!.count).toBe(1);
    expect(f.collector.liveStatus()).toMatchObject({ pendingBuckets: 2, failures: 1 });
  });
  it('shares one in-flight write pump and flushes at most 100 buckets per transaction', async () => {
    const f = fixture();
    for (let i = 0; i < 101; i++) f.collector.record({ method: 'POST', route: `/api/v1/registered-${i}`, statusCode: 201, duration: 1, at });
    const first = f.collector.flush(); const second = f.collector.flush();
    expect(first).toBe(second); await first;
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(f.writes).toHaveLength(102);
    expect(f.collector.liveStatus().pendingBuckets).toBe(1);
  });
  it('drains more than one batch on normal shutdown instead of silently leaving fresh pending data', async () => {
    const f = fixture();
    for (let i = 0; i < 101; i++) f.collector.record({ method: 'GET', route: "/api/v1/shutdown-" + i, statusCode: 200, duration: 1, at });
    await f.collector.onModuleDestroy();
    expect(f.collector.liveStatus().pendingBuckets).toBe(0);
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(2);
  });
  it('bounds shutdown failures and persists an explicit gap instead of silently discarding pending events', async () => {
    const f = fixture(); const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (let index = 0; index < 101; index++) f.collector.record({ method: 'GET', route: '/api/v1/failed-close-' + index, statusCode: 200, duration: 1, at });
    let attempts = 0;
    f.prisma.$transaction.mockImplementation(async work => { attempts++; if (attempts <= 12) throw new Error('DB unavailable'); return work(f.tx); });
    try {
      await f.collector.onModuleDestroy();
      expect(attempts).toBe(13);
      expect(f.collector.liveStatus()).toMatchObject({ active: false, dropped: 1, lastFlushedAt: null });
      expect(f.tx.apiObservationCollector.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ dropped: 1, lastFailureAt: expect.any(Date) }) }));
      expect(warn).toHaveBeenCalledWith('API_OBSERVATION_SHUTDOWN_INCOMPLETE');
    } finally { warn.mockRestore(); }
  });
  it('does not start timers or write receipts merely by constructing the Worker application context', () => {
    const f = fixture(); expect(f.collector.liveStatus().active).toBe(false); expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });
  it('settles finish and close only once and takes organization only from the trusted symbol', () => {
    const f = fixture(); const record = jest.spyOn(f.collector, 'record');
    const req = { path: '/api/v1/tasks/SECRET', method: 'GET', route: { path: '/api/v1/tasks/:id' }, query: { organizationId: 'FORGED' }, authorizedOrganizationId: 'FORGED', [OBSERVATION_ORGANIZATION]: scope };
    const res = Object.assign(new EventEmitter(), { statusCode: 200, writableFinished: true });
    apiObservationMiddleware(f.collector)(req as never, res as never, jest.fn());
    res.emit('finish'); res.emit('close');
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ scopeKey: scope, route: '/api/v1/tasks/:id', statusCode: 200 }));
    expect(JSON.stringify(record.mock.calls)).not.toMatch(/SECRET|FORGED/);
  });
  it('drops a response finishing after shutdown and cannot revive the same collector instance', async () => {
    const f = fixture();
    const req = { path: '/api/v1/tasks/LATE', method: 'GET', route: { path: '/api/v1/tasks/:id' }, [OBSERVATION_ORGANIZATION]: scope };
    const res = Object.assign(new EventEmitter(), { statusCode: 200, writableFinished: true });
    f.collector.start();
    apiObservationMiddleware(f.collector)(req as never, res as never, jest.fn());
    await f.collector.onModuleDestroy();
    res.emit('finish'); res.emit('close');
    f.collector.start();
    try {
      expect(f.collector.liveStatus()).toMatchObject({ active: false, pendingBuckets: 0, dropped: 1, lastFlushedAt: null });
    } finally { await f.collector.onModuleDestroy(); }
  });
  it('marks incomplete close as 499 and never assigns unauthenticated query scope', () => {
    const f = fixture(); const record = jest.spyOn(f.collector, 'record');
    const req = { path: '/api/v1/unknown/SECRET', method: 'GET', query: { organizationId: scope }, authorizedOrganizationId: scope };
    const res = Object.assign(new EventEmitter(), { statusCode: 200, writableFinished: false });
    apiObservationMiddleware(f.collector)(req as never, res as never, jest.fn()); res.emit('close'); res.emit('finish');
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 499, scopeKey: undefined, route: undefined }));
  });
  it.each(['/api/v1/admin/console/api-observations', '/api/v1/admin/console/api-observations/details', '/api/v1/admin/console/data-exchanges', '/api/v1/admin/console/services', '/login'])('excludes monitor recursion and non-API path %s', path => {
    const f = fixture(); const record = jest.spyOn(f.collector, 'record'); const res = new EventEmitter(); const next = jest.fn();
    apiObservationMiddleware(f.collector)({ path } as never, res as never, next); res.emit('finish');
    expect(next).toHaveBeenCalledTimes(1); expect(record).not.toHaveBeenCalled();
  });
});
