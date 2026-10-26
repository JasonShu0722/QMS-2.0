import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Test } from '@nestjs/testing';
import { HttpException, type INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { AdminMutationService, type AdminActor, type AdminTransaction } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { OrganizationResponsibilityService } from '../../src/modules/organization/organization-responsibility.service.js';

const connection = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
if (!connection || process.env.QMS_DISPOSABLE_TEST_DB !== 'true'
  || !['postgres:', 'postgresql:'].includes(connection.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname)
  || connection.port === '55440' || connection.search || connection.hash) {
  throw new Error('Responsibility concurrency requires disposable loopback PostgreSQL, never preview 55440.');
}
jest.setTimeout(40_000);

function barrier() {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  return { ready, release };
}

function settled<T>(promise: Promise<T>) {
  return promise.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}

function sqlState(error: unknown) {
  const failure = error as { meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } };
  return failure.meta?.code ?? failure.meta?.driverAdapterError?.cause?.originalCode;
}

describe('responsibility resolver real PostgreSQL lock ordering', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let audit: AuditLogService;
  let service: OrganizationResponsibilityService;
  let org: string;
  let department: string;
  let section: string;
  let position: string;
  let bindingId: string;
  let scopeId: string;
  let actor: AdminActor;
  let replacementActor: AdminActor;
  const from = new Date('2026-01-01T00:00:00Z');

  // Instrument only scheduling: every query and mutation still executes on its real transaction.
  function scheduledClient(hook: (tx: AdminTransaction) => Promise<AdminTransaction>) {
    return new Proxy(prisma, {
      get(target, property) {
        if (property === '$transaction') return (work: (tx: AdminTransaction) => Promise<unknown>, options?: object) =>
          target.$transaction(async (tx) => {
            await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '12s'");
            return work(await hook(tx));
          }, { ...options, timeout: 20_000 });
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  function queryHook(tx: AdminTransaction, before: (sql: string) => Promise<void>, after: (sql: string) => Promise<void> = async () => {}) {
    return new Proxy(tx, {
      get(target, property) {
        if (property === '$queryRaw') return async (...args: unknown[]) => {
          const first = args[0] as Prisma.Sql | TemplateStringsArray;
          const sql = 'strings' in first ? first.strings.join('?') : Array.from(first).join('?');
          await before(sql);
          const result = await Reflect.apply(target.$queryRaw, target, args);
          await after(sql);
          return result;
        };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  const withClient = (client: PrismaService) => new OrganizationResponsibilityService(client, new AdminMutationService(client, audit), audit);
  const read = (reader: OrganizationResponsibilityService, client: PrismaService, mode: 'preview' | 'transaction') =>
    mode === 'preview' ? reader.managementResponsibilities(org, section)
      : client.$transaction((tx) => reader.resolveManagementResponsibilities(tx, org, section));

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    audit = app.get(AuditLogService);
    service = app.get(OrganizationResponsibilityService);
  });
  afterAll(async () => { await app?.close(); });

  beforeEach(async () => {
    org = (await prisma.organization.create({ data: { code: randomUUID(), name: 'Concurrency fixture', type: 'INTERNAL' } })).id;
    department = (await prisma.department.create({ data: { organizationId: org, code: randomUUID(), name: 'Department' } })).id;
    section = (await prisma.department.create({ data: { organizationId: org, parentId: department, code: randomUUID(), name: 'Section' } })).id;
    position = (await prisma.position.create({ data: { organizationId: org, departmentId: section, code: randomUUID(), name: 'Manager' } })).id;
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'organization:structure:manage' } });
    const role = await prisma.role.create({ data: { organizationId: org, code: randomUUID(), name: 'Governor', permissions: { create: { permissionId: permission.id } } } });
    const governor = async (): Promise<AdminActor> => {
      const user = await prisma.user.create({ data: { organizationId: org, accountType: 'INTERNAL', username: randomUUID(), passwordHash: 'unused' } });
      await prisma.userRole.create({ data: { userId: user.id, organizationId: org, roleId: role.id } });
      const token = await app.get(SessionService).create(user.id, prisma, { mfaVerified: true, reauthenticated: true });
      return { id: user.id, organizationId: org, accountType: 'INTERNAL', sessionId: (await app.get(SessionService).resolve(token))!.id };
    };
    actor = await governor();
    replacementActor = await governor();
    await prisma.userPosition.create({ data: { organizationId: org, userId: actor.id, positionId: position, startedAt: from } });
    bindingId = (await service.createManagementBinding(actor, org, { departmentId: section, positionId: position, responsibility: 'SECTION_MANAGER' }, randomUUID(), randomUUID())).id;
    const minister = await prisma.position.create({ data: { organizationId: org, departmentId: department, code: randomUUID(), name: 'Minister' } });
    const appointment = await prisma.userPosition.create({ data: { organizationId: org, userId: actor.id, positionId: minister.id, startedAt: from } });
    await service.createManagementBinding(actor, org, { departmentId: department, positionId: minister.id, responsibility: 'MINISTER' }, randomUUID(), randomUUID());
    scopeId = (await service.createMinisterScope(actor, org, { departmentId: department, sectionDepartmentId: section, ministerAssignmentId: appointment.id, validFrom: from.toISOString() }, randomUUID(), randomUUID())).id;
  });

  it.each(['preview', 'transaction'] as const)('%s avoids the actor-user / section lock cycle and re-reads committed configuration', async (mode) => {
    const locked = barrier();
    const proceed = barrier();
    const atUser = barrier();
    const takeUser = barrier();
    let writerPid = 0;
    let readerPid = 0;
    const states: string[] = [];
    const writerClient = scheduledClient(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL deadlock_timeout = '5s'");
      writerPid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
      let first = true;
      return queryHook(tx, async () => {}, async (sql) => {
        if (first && sql.includes('FROM users') && /FOR (?:NO KEY )?UPDATE/.test(sql)) {
          first = false;
          locked.release();
          await proceed.ready;
        }
      });
    });
    const readerClient = scheduledClient(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL deadlock_timeout = '50ms'");
      readerPid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
      const scheduled = queryHook(tx, async (sql) => {
        if (sql.includes('FROM users') && sql.includes('FOR SHARE')) {
          atUser.release();
          await takeUser.ready;
        }
      });
      return new Proxy(scheduled, { get(target, property) {
        if (property === '$queryRaw') return async (...args: unknown[]) => {
          try { return await Reflect.apply(target.$queryRaw, target, args); }
          catch (error) { if (sqlState(error)) states.push(sqlState(error)!); throw error; }
        };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    });
    const key = randomUUID();
    let writerDone = false;
    const writer = settled(withClient(writerClient).updateManagementBinding(actor, org, bindingId, { expectedVersion: 1, status: 'DISABLED' }, randomUUID(), key)).then((result) => { writerDone = true; return result; });
    let reader: ReturnType<typeof settled<Awaited<ReturnType<typeof read>>>> | undefined;
    try {
      await Promise.race([locked.ready, writer.then(() => { throw new Error('Writer failed before taking actor lock'); })]);
      reader = settled(read(withClient(readerClient), readerClient, mode));
      await Promise.race([atUser.ready, reader.then(() => { throw new Error('Reader ended before user lock'); })]);
      expect(readerPid).not.toBe(writerPid);
      proceed.release();
      let blockers: number[] = [];
      const until = Date.now() + 8000;
      while (!writerDone && Date.now() < until) {
        blockers = (await prisma.$queryRaw<{ blockers: number[] }[]>`SELECT pg_blocking_pids(${writerPid}::int) AS blockers`)[0]!.blockers;
        if (blockers.includes(readerPid)) break;
        await delay(10);
      }
      expect(writerDone || blockers.includes(readerPid)).toBe(true);
      takeUser.release();
      const result = await reader;
      const written = await writer;
      console.info('responsibility lock evidence', { mode, writerPid, readerPid, writerBlockers: blockers, sqlStates: states,
        writerStatus: written.ok ? 200 : written.error instanceof HttpException ? written.error.getStatus() : 500,
        readerStatus: result.ok ? 200 : result.error instanceof HttpException ? result.error.getStatus() : 500 });
      expect(written).toMatchObject({ ok: true, value: { status: 'DISABLED', version: 2 } });
      expect(result).toMatchObject({ ok: true, value: { issues: [{ responsibility: 'SECTION_MANAGER', code: 'BINDING_MISSING' }] } });
      if (!result.ok) throw result.error;
      expect(result.value.responsibilities).toEqual([expect.objectContaining({ responsibility: 'MINISTER', userId: actor.id, departmentId: department, scopeId })]);
      expect(states).toEqual([]);
      expect(await prisma.adminMutation.count({ where: { organizationId: org, key } })).toBe(1);
      expect(await prisma.auditEvent.count({ where: { organizationId: org, action: 'MANAGEMENT_BINDING_UPDATED' } })).toBe(1);
      expect(await prisma.$queryRaw`SELECT status, version FROM department_management_bindings WHERE id = ${bindingId}::uuid`).toEqual([{ status: 'DISABLED', version: 2 }]);
    } finally {
      proceed.release();
      takeUser.release();
      await Promise.all([writer, reader]);
    }
  });

  it('rejects a newly discovered user after the initial user lock set instead of acquiring a late lock', async () => {
    const replacement = await prisma.position.create({ data: { organizationId: org, departmentId: section, code: randomUUID(), name: 'Replacement manager' } });
    await prisma.userPosition.create({ data: { organizationId: org, userId: replacementActor.id, positionId: replacement.id, startedAt: from } });
    const beforeStructure = barrier();
    const proceed = barrier();
    const client = scheduledClient(async (tx) => {
      let first = true;
      return queryHook(tx, async (sql) => {
        if (first && sql.includes('FROM organizations') && sql.includes('FOR SHARE')) {
          first = false;
          beforeStructure.release();
          await proceed.ready;
        }
      });
    });
    const reader = settled(withClient(client).managementResponsibilities(org, section));
    try {
      await Promise.race([beforeStructure.ready, reader.then(() => { throw new Error('Reader ended before structure lock'); })]);
      await service.updateManagementBinding(replacementActor, org, bindingId, { expectedVersion: 1, positionId: replacement.id }, randomUUID(), randomUUID());
      proceed.release();
      expect(await reader).toMatchObject({ ok: false, error: { status: 409, response: { code: 'CONCURRENCY_CONFLICT' } } });
      const fresh = await service.managementResponsibilities(org, section);
      expect(fresh.issues).toEqual([]);
      expect(fresh.responsibilities).toEqual(expect.arrayContaining([
        expect.objectContaining({ responsibility: 'SECTION_MANAGER', userId: replacementActor.id, positionId: replacement.id, departmentId: section, bindingVersion: 2 }),
        expect.objectContaining({ responsibility: 'MINISTER', userId: actor.id, departmentId: department, scopeId }),
      ]));
      expect(await prisma.auditEvent.count({ where: { organizationId: org, action: 'MANAGEMENT_BINDING_UPDATED' } })).toBe(1);
    } finally {
      proceed.release();
      await reader;
    }
  });

  it.each(['preview', 'transaction'] as const)('%s maps an actual PostgreSQL snapshot serialization failure to controlled 409', async (mode) => {
    const snapshot = barrier();
    const proceed = barrier();
    const states: string[] = [];
    const client = scheduledClient(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await tx.user.findUniqueOrThrow({ where: { id: actor.id } });
      snapshot.release();
      await proceed.ready;
      return new Proxy(tx, { get(target, property) {
        if (property === '$queryRaw') return async (...args: unknown[]) => {
          try { return await Reflect.apply(target.$queryRaw, target, args); }
          catch (error) { if (sqlState(error)) states.push(sqlState(error)!); throw error; }
        };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    });
    const reader = settled(read(withClient(client), client, mode));
    try {
      await Promise.race([snapshot.ready, reader.then(() => { throw new Error('Reader failed before snapshot'); })]);
      await prisma.user.update({ where: { id: actor.id }, data: { fullName: 'Committed after snapshot' } });
      proceed.release();
      const result = await reader;
      console.info('responsibility serialization evidence', { mode, sqlStates: states });
      expect(states).toEqual(['40001']);
      expect(result).toMatchObject({ ok: false, error: { status: 409, response: { code: 'CONCURRENCY_CONFLICT' } } });
      expect((await service.managementResponsibilities(org, section)).responsibilities).toHaveLength(2);
      expect(await prisma.auditEvent.count({ where: { organizationId: org, action: 'MANAGEMENT_BINDING_UPDATED' } })).toBe(0);
    } finally {
      proceed.release();
      await reader;
    }
  });

  it('keeps user, structure, position and appointment SHARE locks until the caller transaction completes', async () => {
    const resolved = barrier();
    const commit = barrier();
    let readerPid = 0;
    const reader = settled(prisma.$transaction(async (tx) => {
      readerPid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
      const result = await service.resolveManagementResponsibilities(tx, org, section);
      resolved.release();
      await commit.ready;
      return result;
    }, { timeout: 20_000 }));
    try {
      await Promise.race([resolved.ready, reader.then(() => { throw new Error('Resolver failed before retaining locks'); })]);
      for (const query of [
        Prisma.sql`SELECT id FROM users WHERE id = ${actor.id}::uuid FOR UPDATE NOWAIT`,
        Prisma.sql`SELECT id FROM organizations WHERE id = ${org}::uuid FOR UPDATE NOWAIT`,
        Prisma.sql`SELECT id FROM departments WHERE id = ${section}::uuid FOR UPDATE NOWAIT`,
        Prisma.sql`SELECT id FROM positions WHERE id = ${position}::uuid FOR UPDATE NOWAIT`,
        Prisma.sql`SELECT id FROM user_positions WHERE user_id = ${actor.id}::uuid FOR UPDATE NOWAIT`,
      ]) {
        const attempt = await settled(prisma.$transaction((tx) => tx.$queryRaw(query)));
        expect(attempt.ok).toBe(false);
        if (!attempt.ok) expect(sqlState(attempt.error)).toBe('55P03');
      }
      expect(readerPid).toBeGreaterThan(0);
      commit.release();
      expect(await reader).toMatchObject({ ok: true, value: { issues: [] } });
    } finally {
      commit.release();
      await reader;
    }
    await expect(service.updateManagementBinding(actor, org, bindingId, { expectedVersion: 1, status: 'DISABLED' }, randomUUID(), randomUUID())).resolves.toMatchObject({ version: 2 });
  });
});
