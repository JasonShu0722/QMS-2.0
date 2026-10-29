import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../src/database/prisma.service.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { AdministrativeIdentityReadModel, AdministrativeIdentityReadModule } from '../../src/modules/identity/administrative-identity-read-model.js';

const connection = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
if (!connection || process.env.QMS_DISPOSABLE_TEST_DB !== 'true'
  || !['postgres:', 'postgresql:'].includes(connection.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname)
  || connection.port === '55440' || connection.search || connection.hash) {
  throw new Error('Administrative identity read-model requires disposable loopback PostgreSQL, never preview 55440.');
}

function signal<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function sqlState(error: unknown) {
  const failure = error as { meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } };
  return failure.meta?.code ?? failure.meta?.driverAdapterError?.cause?.originalCode;
}

describe('administrative identity owner read-model on real PostgreSQL', () => {
  const db = new PrismaService();
  const model = new AdministrativeIdentityReadModel();
  const committedOrganizationIds: string[] = [];
  beforeAll(() => db.$connect());
  afterAll(async () => {
    try {
      // Only the non-deleted lock fixtures commit; tombstone fixtures always roll back.
      await db.$transaction(async tx => {
        await tx.user.deleteMany({ where: { organizationId: { in: committedOrganizationIds } } });
        await tx.organization.deleteMany({ where: { id: { in: committedOrganizationIds } } });
      });
    } finally { await db.$disconnect(); }
  });

  async function rollback<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const stop = new Error('Roll back only this test fixture');
    let result!: T;
    try {
      await db.$transaction(async tx => { result = await run(tx); throw stop; });
    } catch (error) { if (error !== stop) throw error; }
    return result;
  }

  async function organization(tx: Prisma.TransactionClient) {
    return tx.organization.create({ data: { code: randomUUID(), name: 'Administrative identity port fixture', type: 'INTERNAL' } });
  }

  async function user(tx: Prisma.TransactionClient, organizationId: string, data: Partial<Prisma.UserUncheckedCreateInput> = {}) {
    return tx.user.create({ data: { organizationId, username: randomUUID(), passwordHash: 'unused-fixture-hash',
      email: `${randomUUID()}@example.invalid`, accountType: 'INTERNAL', ...data } });
  }

  async function committedFixture() {
    return db.$transaction(async tx => {
      const org = await organization(tx);
      committedOrganizationIds.push(org.id);
      return { org, person: await user(tx, org.id) };
    });
  }

  it('exports a standalone injectable leaf without IdentityModule or a Prisma provider', async () => {
    const module = await Test.createTestingModule({ imports: [AdministrativeIdentityReadModule] }).compile();
    try { expect(module.get(AdministrativeIdentityReadModel)).toBeInstanceOf(AdministrativeIdentityReadModel); }
    finally { await module.close(); }
  });

  it('provides a transaction-composable minimal eligible relation before count and page, bounded to the current identity tenant', async () => {
    await rollback(async tx => {
      const org = await organization(tx); const other = await organization(tx);
      const active = await user(tx, org.id, { fullName: 'Visible identity' });
      await user(tx, org.id, { status: 'DISABLED' });
      await user(tx, org.id, { status: 'DISABLED', configurationRequired: true });
      await user(tx, org.id, { status: 'DISABLED', deletedAt: new Date() });
      await user(tx, org.id, { accountType: 'SUPPLIER' });
      await user(tx, other.id);
      const [result] = await tx.$queryRaw<{ total: number; items: Array<{ id: string; username: string; full_name: string | null }> }[]>(Prisma.sql`
        WITH identity_users AS (${model.workflowEligibleUsers(org.id)}) SELECT (SELECT count(*)::int FROM identity_users) AS total,
          (SELECT jsonb_agg(page) FROM (SELECT * FROM identity_users ORDER BY id LIMIT 1) page) AS items`);
      expect(result).toEqual({ total: 1, items: [{ id: active.id, username: active.username, full_name: 'Visible identity' }] });
      await tx.user.update({ where: { id: active.id }, data: { status: 'DISABLED' } });
      expect(await tx.$queryRaw(Prisma.sql`${model.workflowEligibleUsers(org.id)}`)).toEqual([]);
    });
  });

  it('keeps the bounded responsibility label read inside callerTx with no lifecycle secrets or cross-tenant identity', async () => {
    const ids = await rollback(async tx => {
      const org = await organization(tx); const other = await organization(tx);
      const person = await user(tx, org.id, { fullName: 'Old responsibility label', status: 'DISABLED', configurationRequired: true });
      expect(await model.responsibilityUser(tx, org.id, person.id)).toEqual({ username: person.username, fullName: 'Old responsibility label' });
      expect(await model.responsibilityUser(tx, other.id, person.id)).toBeNull();
      expect(await model.lockResponsibilityUsers(tx, other.id, [person.id])).toEqual([]);
      expect(await model.lockResponsibilityUsers(tx, org.id, [person.id, person.id])).toEqual([{ id: person.id }]);
      return { userId: person.id, organizationId: org.id };
    });
    expect(await db.user.findUnique({ where: { id: ids.userId } })).toBeNull();
  });

  it('returns only four lifecycle keys in id order, including disabled/pending users but excluding tombstones and other tenants', async () => {
    await rollback(async tx => {
      const org = await organization(tx); const other = await organization(tx);
      const ids = [randomUUID(), randomUUID(), randomUUID()].sort();
      const pending = await user(tx, org.id, { id: ids[2], status: 'DISABLED', configurationRequired: true, securityVersion: 7 });
      const active = await user(tx, org.id, { id: ids[0] });
      const disabled = await user(tx, org.id, { id: ids[1], status: 'DISABLED' });
      await user(tx, org.id, { deletedAt: new Date(), status: 'DISABLED' });
      await user(tx, other.id);
      const rows = await model.lifecycleUsers(tx, org.id);
      expect(rows).toEqual([active, disabled, pending].map(row => ({ id: row.id, securityVersion: row.securityVersion,
        status: row.status, configurationRequired: row.configurationRequired })));
      for (const row of rows) expect(Object.keys(row).sort()).toEqual(['configurationRequired', 'id', 'securityVersion', 'status']);
    });
  });

  it('intersects optional ids with the tenant and non-deleted boundary, independently of input order or duplicates', async () => {
    await rollback(async tx => {
      const org = await organization(tx); const other = await organization(tx);
      const first = await user(tx, org.id); const second = await user(tx, org.id);
      const omitted = await user(tx, org.id);
      const foreign = await user(tx, other.id);
      const deleted = await user(tx, org.id, { deletedAt: new Date(), status: 'DISABLED' });
      const wanted = [first.id, second.id].sort();
      const rows = await model.lifecycleUsers(tx, org.id, [...wanted].reverse().concat(first.id, foreign.id, deleted.id, randomUUID()));
      expect(rows.map(row => row.id)).toEqual(wanted);
      expect(rows.map(row => row.id)).not.toContain(omitted.id);
      expect(await model.lifecycleUsers(tx, org.id, [foreign.id])).toEqual([]);
    });
  });

  it('performs no query for either empty id list, even on an already aborted real transaction', async () => {
    await rollback(async tx => {
      await expect(tx.$queryRaw`SELECT 1 / 0`).rejects.toMatchObject({ code: 'P2010' });
      // PostgreSQL would reject any further query with 25P02, so success proves both paths do not query.
      expect(await model.lifecycleUsers(tx, randomUUID(), [])).toEqual([]);
      expect(await model.lockLifecycleUsers(tx, [])).toBeUndefined();
      expect(await model.lockResponsibilityUsers(tx, randomUUID(), [])).toEqual([]);
    });
  });

  it('reads caller-transaction inserts and updates and leaves none behind after caller rollback', async () => {
    const ids = await rollback(async tx => {
      const org = await organization(tx); const person = await user(tx, org.id);
      await model.lockLifecycleUsers(tx, [person.id]);
      await tx.user.update({ where: { id: person.id }, data: { status: 'DISABLED', configurationRequired: true, securityVersion: { increment: 1 } } });
      expect(await model.lifecycleUsers(tx, org.id, [person.id])).toEqual([
        { id: person.id, status: 'DISABLED', configurationRequired: true, securityVersion: person.securityVersion + 1 },
      ]);
      return { organizationId: org.id, userId: person.id };
    });
    expect(await db.user.findUnique({ where: { id: ids.userId } })).toBeNull();
    expect(await db.organization.findUnique({ where: { id: ids.organizationId } })).toBeNull();
  });

  it('holds real user row locks until the caller releases its transaction, with a bounded competing lock timeout', async () => {
    const f = await committedFixture();
    const ready = signal<void>(); const release = signal<void>();
    const holder = db.$transaction(async tx => {
      await model.lockLifecycleUsers(tx, [f.person.id]);
      ready.resolve();
      await release.promise;
    });
    try {
      await Promise.race([ready.promise, holder.then(() => { throw new Error('Lock holder exited before readiness'); })]);
      const error = await db.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '300ms'`;
        await tx.$executeRaw`UPDATE users SET security_version = security_version + 1 WHERE id = ${f.person.id}::uuid`;
      }).then(() => undefined, (failure: unknown) => failure);
      expect(sqlState(error)).toBe('55P03');
    } finally { release.resolve(); await holder; }
    await db.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '300ms'`;
      await model.lockLifecycleUsers(tx, [f.person.id]);
      expect(await model.lifecycleUsers(tx, f.org.id, [f.person.id])).toEqual([
        { id: f.person.id, securityVersion: f.person.securityVersion, status: 'ACTIVE', configurationRequired: false },
      ]);
    });
  });

  it('waits for a competing writer and reads its committed lifecycle values after the lock releases', async () => {
    const f = await committedFixture();
    const ready = signal<number>(); const release = signal<void>();
    const writer = db.$transaction(async tx => {
      await tx.user.update({ where: { id: f.person.id }, data: { status: 'DISABLED', configurationRequired: true, securityVersion: { increment: 1 } } });
      ready.resolve((await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid);
      await release.promise;
    });
    let reader: Promise<Awaited<ReturnType<AdministrativeIdentityReadModel['lifecycleUsers']>>> | undefined;
    try {
      const writerPid = await Promise.race([ready.promise, writer.then(() => { throw new Error('Writer exited before readiness'); })]);
      reader = db.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '1500ms'`;
        await model.lockLifecycleUsers(tx, [f.person.id]);
        return model.lifecycleUsers(tx, f.org.id, [f.person.id]);
      });
      // Attach immediately so a failed lock cannot become an unhandled rejection during observation.
      void reader.catch(() => undefined);
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const [row] = await db.$queryRaw<{ blocked: boolean }[]>`SELECT EXISTS
          (SELECT 1 FROM pg_stat_activity WHERE ${writerPid} = ANY(pg_blocking_pids(pid))) AS blocked`;
        if (row?.blocked) { blocked = true; break; }
        await delay(10);
      }
      expect(blocked).toBe(true);
    } finally { release.resolve(); await writer; }
    expect(await reader).toEqual([
      { id: f.person.id, securityVersion: f.person.securityVersion + 1, status: 'DISABLED', configurationRequired: true },
    ]);
  });
});
