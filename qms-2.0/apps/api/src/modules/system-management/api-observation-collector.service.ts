import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import { API_OBSERVATION_METHODS } from './api-observation.dto.js';

export type ApiObservation = { scopeKey?: string; method: string; route?: string; statusCode: number; duration: number; at?: Date };
type Bucket = { minute: Date; scopeKey: string; method: string; route: string; statusClass: number; count: number; durationTotal: number; durationMax: number; le50: number; le200: number; le1000: number; le5000: number; gt5000: number };
const COUNTER_MAX = 2_000_000_000;
const increment = (value: number, delta = 1) => Math.min(COUNTER_MAX, value + delta);
const routePattern = /^\/api\/v1(?:\/[A-Za-z0-9_:.*-]+)*$/;
export const API_OBSERVATION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class ApiObservationCollectorService implements OnModuleDestroy {
  readonly producerId = randomUUID();
  readonly startedAt = new Date();
  private pending = new Map<string, Bucket>();
  private pumping?: Promise<void>;
  private inFlight?: { sequence: number; entries: Array<[string, Bucket]> };
  private sequence = 0;
  private shutdownDeadline?: number;
  private timer?: ReturnType<typeof setInterval>;
  private dropped = 0;
  private failures = 0;
  private lastFailureAt: Date | null = null;
  private lastFlushedAt: Date | null = null;
  private active = false;
  constructor(private readonly prisma: PrismaService) {}

  start(): void {
    if (this.timer || this.shutdownDeadline !== undefined) return;
    this.active = true;
    this.timer = setInterval(() => { void this.flush(); }, 1000);
    this.timer.unref();
  }
  liveStatus() {
    return { active: this.active, producerId: this.producerId, pendingBuckets: this.pending.size + (this.inFlight?.entries.length ?? 0), dropped: this.dropped, failures: this.failures, lastFailureAt: this.lastFailureAt, lastFlushedAt: this.lastFlushedAt };
  }
  record(input: ApiObservation): void {
    if (this.shutdownDeadline !== undefined) { this.dropped = increment(this.dropped); this.lastFlushedAt = null; return; }
    const at = input.at ?? new Date();
    if (!Number.isFinite(at.getTime()) || !Number.isFinite(input.statusCode) || input.statusCode < 100 || input.statusCode >= 600 || !Number.isFinite(input.duration)) return;
    const minute = new Date(Math.floor(at.getTime() / 60000) * 60000);
    const scopeKey = input.scopeKey && isUUID(input.scopeKey) ? input.scopeKey.toLowerCase() : 'UNSCOPED';
    const method = (API_OBSERVATION_METHODS as readonly string[]).includes(input.method) ? input.method : 'OTHER';
    const route = input.route && input.route.length <= 200 && routePattern.test(input.route) ? input.route : 'UNKNOWN';
    const statusClass = Math.floor(input.statusCode / 100);
    const duration = Math.min(3_600_000, Math.max(0, input.duration));
    const key = JSON.stringify([minute.getTime(), scopeKey, method, route, statusClass]);
    let bucket = this.pending.get(key);
    if (!bucket) {
      if (this.pending.size >= 1000) { this.dropped = increment(this.dropped); return; }
      bucket = { minute, scopeKey, method, route, statusClass, count: 0, durationTotal: 0, durationMax: 0, le50: 0, le200: 0, le1000: 0, le5000: 0, gt5000: 0 };
      this.pending.set(key, bucket);
    }
    if (bucket.count >= COUNTER_MAX) { this.dropped = increment(this.dropped); return; }
    bucket.count++;
    bucket.durationTotal += duration;
    bucket.durationMax = Math.max(bucket.durationMax, duration);
    if (duration <= 50) bucket.le50++;
    else if (duration <= 200) bucket.le200++;
    else if (duration <= 1000) bucket.le1000++;
    else if (duration <= 5000) bucket.le5000++;
    else bucket.gt5000++;
  }
  flush(): Promise<void> {
    if (this.pumping) return this.pumping;
    this.pumping = this.writeBatch().finally(() => { this.pumping = undefined; });
    return this.pumping;
  }
  private async writeBatch(): Promise<void> {
    if (!this.inFlight) {
      const entries = [...this.pending.entries()].slice(0, 100);
      for (const [key] of entries) this.pending.delete(key);
      this.inFlight = { sequence: ++this.sequence, entries };
    }
    const batch = this.inFlight;
    const remaining = this.shutdownDeadline === undefined ? undefined : Math.max(1, this.shutdownDeadline - Date.now());
    const completedAt = new Date();
    try {
      const receipt = await this.prisma.$transaction(async tx => {
        await tx.apiObservationCollector.upsert({ where: { producerId: this.producerId }, create: { producerId: this.producerId, startedAt: this.startedAt }, update: {} });
        const [locked] = await tx.$queryRaw<Array<{ committedBatch: number; dropped: number; failures: number; lastFailureAt: Date | null }>>`
          SELECT committed_batch AS "committedBatch", dropped, failures, last_failure_at AS "lastFailureAt"
          FROM api_observation_collectors WHERE producer_id = ${this.producerId}::uuid FOR UPDATE`;
        if (!locked) throw new Error('OBSERVATION_RECEIPT_MISSING');
        let skipped = 0;
        for (const [, row] of locked.committedBatch >= batch.sequence ? [] : batch.entries) {
          const written = await tx.$executeRaw`
          INSERT INTO api_observation_buckets
            (id, minute, scope_key, method, route, status_class, count, duration_total, duration_max, le50, le200, le1000, le5000, gt5000)
          VALUES (${randomUUID()}::uuid, ${row.minute}, ${row.scopeKey}, ${row.method}, ${row.route}, ${row.statusClass}, ${row.count}, ${row.durationTotal}, ${row.durationMax}, ${row.le50}, ${row.le200}, ${row.le1000}, ${row.le5000}, ${row.gt5000})
          ON CONFLICT (minute, scope_key, method, route, status_class) DO UPDATE SET
            count = api_observation_buckets.count + EXCLUDED.count,
            duration_total = api_observation_buckets.duration_total + EXCLUDED.duration_total,
            duration_max = GREATEST(api_observation_buckets.duration_max, EXCLUDED.duration_max),
            le50 = api_observation_buckets.le50 + EXCLUDED.le50, le200 = api_observation_buckets.le200 + EXCLUDED.le200,
            le1000 = api_observation_buckets.le1000 + EXCLUDED.le1000, le5000 = api_observation_buckets.le5000 + EXCLUDED.le5000,
            gt5000 = api_observation_buckets.gt5000 + EXCLUDED.gt5000
          WHERE api_observation_buckets.count <= ${COUNTER_MAX} - EXCLUDED.count`;
          if (!written) skipped = increment(skipped, row.count);
        }
        const dropped = increment(Math.max(this.dropped, locked.dropped), skipped);
        const failures = Math.max(this.failures, locked.failures);
        const lastFailureAt = this.lastFailureAt ?? locked.lastFailureAt;
        await tx.apiObservationCollector.update({ where: { producerId: this.producerId }, data: { committedBatch: Math.max(batch.sequence, locked.committedBatch), lastFlushedAt: this.shutdownDeadline === undefined ? completedAt : null, lastFailureAt, dropped, failures } });
        const cutoff = new Date(completedAt.getTime() - API_OBSERVATION_RETENTION_MS);
        await tx.$executeRaw`DELETE FROM api_observation_buckets WHERE id IN (SELECT id FROM api_observation_buckets WHERE minute < ${cutoff} ORDER BY minute, id LIMIT 1000)`;
        await tx.$executeRaw`DELETE FROM api_observation_collectors WHERE producer_id IN (SELECT producer_id FROM api_observation_collectors WHERE updated_at < ${cutoff} ORDER BY updated_at, producer_id LIMIT 1000)`;
        return { dropped, failures, lastFailureAt };
      }, remaining === undefined ? undefined : { maxWait: Math.min(500, remaining), timeout: Math.max(1, Math.min(4000, remaining - 500)) });
      this.dropped = Math.max(this.dropped, receipt.dropped);
      this.failures = Math.max(this.failures, receipt.failures);
      this.lastFailureAt = this.lastFailureAt ?? receipt.lastFailureAt;
      this.lastFlushedAt = this.shutdownDeadline === undefined ? completedAt : null;
      this.inFlight = undefined;
    } catch {
      this.failures = increment(this.failures);
      this.lastFailureAt = new Date();
      // The immutable batch and sequence survive an unknown COMMIT acknowledgement.
    }
  }
  async onModuleDestroy(): Promise<void> {
    this.shutdownDeadline ??= Date.now() + 10000;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (!this.active && !this.pending.size && !this.inFlight) return;
    const alreadyWriting = !!this.pumping;
    let rounds = 0;
    const boundedFlush = async () => {
      const remaining = Math.max(0, this.shutdownDeadline! - Date.now());
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([this.flush(), new Promise<void>(resolve => { timeout = setTimeout(resolve, remaining); })]); }
      finally { if (timeout) clearTimeout(timeout); }
    };
    do { await boundedFlush(); rounds++; }
    while ((this.pending.size || this.inFlight) && Date.now() < this.shutdownDeadline && rounds < 12);
    if (alreadyWriting && !this.pending.size && !this.inFlight && Date.now() < this.shutdownDeadline) await boundedFlush();
    if (this.pending.size || this.inFlight) {
      for (const row of this.pending.values()) this.dropped = increment(this.dropped, row.count);
      this.pending.clear();
      this.failures = increment(this.failures);
      this.lastFailureAt = new Date();
      const remaining = this.shutdownDeadline - Date.now();
      if (remaining > 0) {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            this.prisma.$transaction(async tx => {
              await tx.apiObservationCollector.upsert({ where: { producerId: this.producerId }, create: { producerId: this.producerId, startedAt: this.startedAt, dropped: this.dropped, failures: this.failures, lastFailureAt: this.lastFailureAt }, update: {} });
              await tx.$executeRaw`UPDATE api_observation_collectors SET last_flushed_at = NULL, last_failure_at = ${this.lastFailureAt}, dropped = GREATEST(dropped, ${this.dropped}), failures = GREATEST(failures, ${this.failures}), updated_at = NOW() WHERE producer_id = ${this.producerId}::uuid`;
            }, { maxWait: Math.min(500, remaining), timeout: Math.max(1, Math.min(4000, remaining - 500)) }),
            new Promise<void>(resolve => { timeout = setTimeout(resolve, remaining); }),
          ]);
        } catch { /* The database may remain unavailable; the bounded shutdown cannot promise a durable gap receipt. */ }
        finally { if (timeout) clearTimeout(timeout); }
      }
      console.warn('API_OBSERVATION_SHUTDOWN_INCOMPLETE');
    }
    this.lastFlushedAt = null;
    this.active = false;
  }
}
