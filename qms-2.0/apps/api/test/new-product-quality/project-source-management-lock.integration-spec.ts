import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { OrganizationResponsibilityService } from '../../src/modules/organization/organization-responsibility.service.js';
import { NewProductEightDSourceService } from '../../src/modules/new-product-quality/new-product-eight-d-source.service.js';
import { completeDocument, domainFixture, type DomainFixture } from '../common/internal-eight-d-domains.fixture.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) {
  throw new Error('Source management locks require disposable loopback PostgreSQL, never preview 55440.');
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function settled<T>(promise: Promise<T>) {
  return promise.then(value => ({ value }), (error: unknown) => ({ error }));
}

function sqlState(error: unknown) {
  const failure = error as { meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } };
  return failure.meta?.code ?? failure.meta?.driverAdapterError?.cause?.originalCode;
}

type Query = { sql: string; values: unknown[] };

describe('new-product source management prelocks on real PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let f: DomainFixture;
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  }, 120_000);
  beforeEach(async () => { f = await domainFixture(app, 'new-product-quality'); }, 120_000);
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => app?.close());

  // Only observe/schedule real queries; preserve the caller's isolation, timeout and errors.
  function observe(before: (query: Query) => Promise<void> = async () => {}) {
    const transaction = prisma.$transaction.bind(prisma);
    const queries = new Map<Prisma.TransactionClient, Query[]>(), databaseCodes: string[] = [];
    jest.spyOn(prisma, '$transaction').mockImplementation((async (work: any, options: any) => {
      if (typeof work !== 'function') return transaction(work);
      return transaction(async tx => {
        const trace: Query[] = [];
        const proxy = new Proxy(tx, {
          get(target, property) {
            if (property === '$queryRaw') return async (...args: unknown[]) => {
              const first = args[0] as Prisma.Sql | TemplateStringsArray;
              const query = 'strings' in first ? { sql: first.strings.join('?'), values: first.values }
                : { sql: Array.from(first).join('?'), values: args.slice(1) };
              await before(query);
              try {
                const result = await Reflect.apply(target.$queryRaw, target, args);
                trace.push(query);
                return result;
              } catch (error) {
                const code = sqlState(error);
                if (code) databaseCodes.push(code);
                throw error;
              }
            };
            const value = Reflect.get(target, property);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        queries.set(proxy, trace);
        return work(proxy);
      }, options);
    }) as typeof prisma.$transaction);
    return { queries, databaseCodes };
  }

  async function submit(problemId: string) {
    let current = await f.read(problemId);
    await f.runtime.core.save(f.owner.actor, problemId,
      { expectedVersion: current.version, document: completeDocument('new-product-quality') }, randomUUID(), randomUUID());
    current = await f.read(problemId);
    await f.runtime.core.analysisComplete(f.owner.actor, problemId,
      { expectedVersion: current.version, submissionDueAt: new Date('2026-11-10T00:00:00Z') }, randomUUID(), randomUUID());
    current = await f.read(problemId);
    await f.runtime.core.submit(f.owner.actor, problemId, { expectedVersion: current.version }, randomUUID(), randomUUID());
    return (await f.rounds.readProjection(prisma, f.org.id, problemId))!;
  }

  describe.each(['PROCESSING', 'IN_REVIEW'] as const)('%s', status => {
    let problemId: string, collaborator: Awaited<ReturnType<DomainFixture['person']>>;
    let round: Awaited<ReturnType<typeof submit>> | null, current: Awaited<ReturnType<DomainFixture['read']>>;
    beforeEach(async () => {
      problemId = await f.issue([f.chainSource]);
      collaborator = await f.person(f.section.id);
      await f.runtime.core.collaborators(f.owner.actor, problemId,
        { expectedVersion: 1, userIds: [collaborator.user.id] }, randomUUID(), randomUUID());
      round = status === 'IN_REVIEW' ? await submit(problemId) : null;
      current = await f.read(problemId);
    }, 120_000);

    it('sources.add prelocks all management/participants before project, then manager issue waits without deadlock', async () => {
      const participants = [f.owner.user.id, f.professional.user.id, collaborator.user.id];
      const users = [...participants, f.manager.user.id, f.minister.user.id].sort();
      const entered = deferred(), release = deferred(), observation = observe();
      const sources = app.get(NewProductEightDSourceService), prepare = sources.prepareSourceLinks.bind(sources);
      let preProject: Query[] = [], aPid = 0, sourceTx: Prisma.TransactionClient | undefined;
      const calls = jest.spyOn(sources, 'prepareSourceLinks').mockImplementation(async (tx, references, actor) => {
        if (actor.id !== f.professional.user.id) return prepare(tx, references, actor);
        sourceTx = tx;
        preProject = [...observation.queries.get(tx)!];
        const written = await prepare(tx, references, actor);
        aPid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
        entered.resolve();
        await release.promise;
        return written;
      });
      const a = settled(f.runtime.core.sources(f.professional.actor, problemId,
        { expectedVersion: current.version, add: [{ defectId: f.extra.sourceId, expectedVersion: f.extra.expectedVersion }],
          removeDefectIds: [], confirmCancelApproval: status === 'IN_REVIEW' }, randomUUID(), randomUUID()));
      let b: Promise<{ value: unknown } | { error: unknown }> | undefined;
      let wait: { pid: number; query: string; blockers: number[] } | undefined;
      const probes: { name: string; code: string | undefined }[] = [];
      try {
        await Promise.race([entered.promise, a.then(() => { throw new Error('Source command ended before the post-project barrier'); })]);
        for (const [name, query] of [
          ...users.map(id => [id, Prisma.sql`SELECT id FROM users WHERE id = ${id}::uuid FOR NO KEY UPDATE NOWAIT`] as const),
          ['section', Prisma.sql`SELECT id FROM departments WHERE id = ${f.section.id}::uuid FOR UPDATE NOWAIT`],
          ['manager-position', Prisma.sql`SELECT id FROM positions WHERE id = ${f.manager.position.id}::uuid FOR UPDATE NOWAIT`],
          ['minister-position', Prisma.sql`SELECT id FROM positions WHERE id = ${f.minister.position.id}::uuid FOR UPDATE NOWAIT`],
          ['manager-appointment', Prisma.sql`SELECT id FROM user_positions WHERE id = ${f.manager.assignment.id}::uuid FOR UPDATE NOWAIT`],
          ['minister-appointment', Prisma.sql`SELECT id FROM user_positions WHERE id = ${f.minister.assignment.id}::uuid FOR UPDATE NOWAIT`],
        ] as const) {
          const probe = await settled(prisma.$transaction(tx => tx.$queryRaw(query)));
          probes.push({ name, code: 'error' in probe ? sqlState(probe.error) : undefined });
        }
        b = settled(f.service.issue(f.manager.actor, f.input([f.matrixSources[0]!]), randomUUID(), randomUUID()));
        const until = Date.now() + 1500;
        while (!wait && Date.now() < until) {
          const rows = await prisma.$queryRaw<{ pid: number; query: string; blockers: number[] }[]>`SELECT pid, query, pg_blocking_pids(pid) AS blockers
            FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND ${aPid}::int = ANY(pg_blocking_pids(pid))`;
          wait = rows.find(row => row.query.includes('FROM users') || row.query.includes('new_product_projects'));
          if (!wait) await delay(10);
        }
      } finally {
        release.resolve();
        await Promise.all([a, b]);
      }
      const resultA = await a, resultB = await b!;
      console.info('source management lock evidence', JSON.stringify({ status, aPid, wait, probes,
        databaseCodes: observation.databaseCodes, sourceSucceeded: 'value' in resultA, issueSucceeded: 'value' in resultB }));
      expect(wait?.blockers).toContain(aPid);
      expect(resultA).toMatchObject({ value: { status: 'PROCESSING', sources: expect.arrayContaining([expect.objectContaining({ defectId: f.extra.sourceId })]) } });
      expect(resultB).toMatchObject({ value: { replayed: false } });
      expect(observation.databaseCodes).not.toContain('40P01');
      expect(observation.databaseCodes).not.toContain('40001');
      expect(calls).toHaveBeenCalledTimes(2);
      expect(probes).toEqual(probes.map(({ name }) => ({ name, code: '55P03' })));
      const firstUsers = preProject.findIndex(q => q.sql.includes('FROM users') && q.sql.includes('FOR SHARE'));
      const firstStructure = preProject.findIndex(q => q.sql.includes('FROM organizations') && q.sql.includes('FOR SHARE'));
      expect(firstUsers).toBeGreaterThanOrEqual(0);
      expect(firstUsers).toBeLessThan(firstStructure);
      expect(preProject[firstUsers]!.values.filter(value => users.includes(String(value))).sort()).toEqual(users);
      const fullTrace = observation.queries.get(sourceTx!)!;
      const projectLock = fullTrace.findIndex(q => q.sql.includes('FROM new_product_projects project') && q.sql.includes('FOR UPDATE'));
      const managementLock = fullTrace.findIndex(q => q.sql.includes('FROM user_positions') && q.sql.includes('FOR SHARE'));
      expect(managementLock).toBeGreaterThan(firstUsers);
      expect(managementLock).toBeLessThan(projectLock);
      if (round) expect(await f.rounds.readProjection(prisma, f.org.id, problemId)).toMatchObject({ id: round.id, status: 'CANCELLED' });
    });
  });

  it('rejects a changed resolver candidate set with CONCURRENCY_CONFLICT instead of using the first responsibilities', async () => {
    const responsibilities = app.get(OrganizationResponsibilityService), replacement = await f.person(f.section.id);
    await prisma.session.update({ where: { id: replacement.actor.sessionId }, data: { reauthenticatedAt: new Date() } });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'organization:structure:manage' } });
    await prisma.rolePermission.create({ data: { roleId: f.role.id, permissionId: permission.id } });
    const entered = deferred(), release = deferred();
    let paused = false;
    const observation = observe(async query => {
      if (!paused && query.sql.includes('FROM organizations') && query.sql.includes('FOR SHARE')) {
        paused = true; entered.resolve(); await release.promise;
      }
    });
    const participants = [f.owner.user.id, f.professional.user.id];
    const reader = settled(prisma.$transaction(tx => Reflect.apply(responsibilities.resolveManagementResponsibilities,
      responsibilities, [tx, f.org.id, f.section.id, new Date(), participants])));
    try {
      await Promise.race([entered.promise, reader.then(() => { throw new Error('Resolver ended before structure barrier'); })]);
      await responsibilities.updateManagementBinding(replacement.actor, f.org.id, f.managerBinding,
        { expectedVersion: 1, positionId: replacement.position.id }, randomUUID(), randomUUID());
    } finally { release.resolve(); }
    expect(await reader).toMatchObject({ error: { status: 409, response: { code: 'CONCURRENCY_CONFLICT' } } });
    expect(observation.databaseCodes).not.toContain('40P01');
    const fresh = await responsibilities.managementResponsibilities(f.org.id, f.section.id);
    expect(fresh.responsibilities).toEqual(expect.arrayContaining([expect.objectContaining({ userId: replacement.user.id, bindingVersion: 2 })]));
  });

  it('keeps closed append-only sources available with a missing manager without reopening or cancelling closure', async () => {
    const problemId = await f.issue([f.chainSource]);
    let round = await submit(problemId);
    round = await f.rounds.decide(f.professional.actor, round.id,
      { expectedRoundVersion: round.version, duties: ['PROFESSIONAL'], decision: 'APPROVE', comment: 'Verified' }, randomUUID(), randomUUID());
    await f.rounds.decide(f.manager.actor, round.id,
      { expectedRoundVersion: round.version, duties: ['SECTION_MANAGER'], decision: 'APPROVE', comment: 'Verified' }, randomUUID(), randomUUID());
    const current = await f.read(problemId);
    await prisma.userPosition.update({ where: { id: f.manager.assignment.id }, data: { endedAt: new Date() } });
    const result = await f.runtime.core.sources(f.professional.actor, problemId,
      { expectedVersion: current.version, add: [{ defectId: f.extra.sourceId, expectedVersion: f.extra.expectedVersion }], removeDefectIds: [] }, randomUUID(), randomUUID());
    expect(result).toMatchObject({ status: 'CLOSED', closedRevisionId: current.closedRevisionId, contentVersion: current.contentVersion });
    expect(result.sources).toHaveLength(2);
    expect(await f.rounds.readProjection(prisma, f.org.id, problemId)).toMatchObject({ id: round.id, status: 'APPROVED' });
  });

  it('does not add a missing-manager business gate to fresh issue or processing source addition', async () => {
    await prisma.userPosition.update({ where: { id: f.manager.assignment.id }, data: { endedAt: new Date() } });
    const problemId = await f.issue([f.chainSource]);
    await expect(f.runtime.core.sources(f.professional.actor, problemId,
      { expectedVersion: 1, add: [{ defectId: f.extra.sourceId, expectedVersion: f.extra.expectedVersion }], removeDefectIds: [] }, randomUUID(), randomUUID()))
      .resolves.toMatchObject({ status: 'PROCESSING', sources: expect.arrayContaining([expect.objectContaining({ defectId: f.extra.sourceId })]) });
  });

  it.each([
    ['future appointment', 'PROCESSING'],
    ['future scope and position', 'IN_REVIEW'],
  ] as const)('fences %s after preproject before a new user lock (%s), rolls back A and lets effective management issue B succeed', async (kind, status) => {
    const problemId = await f.issue([f.chainSource]);
    if (status === 'IN_REVIEW') await submit(problemId);
    const current = await f.read(problemId);
    const newcomer = kind === 'future appointment' ? f.manager : f.minister;
    const effectiveAt = new Date(Date.now() + 1500);
    if (kind === 'future appointment') {
      await prisma.userPosition.update({ where: { id: newcomer.assignment.id }, data: { startedAt: effectiveAt } });
    } else {
      await prisma.$executeRaw`UPDATE department_minister_scopes SET valid_from = ${effectiveAt} WHERE id = ${f.scopeId}::uuid`;
    }
    const snapshot = async () => ({
      problem: await prisma.problemIndex.findUniqueOrThrow({ where: { id: problemId } }),
      instance: await prisma.workflowInstance.findUniqueOrThrow({ where: { id: current.instanceId } }),
      report: await prisma.$queryRaw`SELECT * FROM new_product_eight_d_reports WHERE problem_id = ${problemId}::uuid`,
      sources: await prisma.domainSourceIssueLink.findMany({ where: { problemIndexId: problemId }, orderBy: { id: 'asc' } }),
      sourceHistory: await prisma.domainSourceIssueLinkHistory.findMany({ where: { problemIndexId: problemId }, orderBy: { id: 'asc' } }),
      outbox: await prisma.outboxEvent.findMany({ where: { aggregateId: problemId }, orderBy: { id: 'asc' } }),
      round: await f.rounds.readProjection(prisma, f.org.id, problemId),
    });
    const before = await snapshot();
    const [projectBefore] = await prisma.$queryRaw<{ version: number }[]>`SELECT version FROM new_product_projects WHERE id = ${f.project.id}::uuid`;
    const entered = deferred(), release = deferred(), observation = observe();
    const sources = app.get(NewProductEightDSourceService), prepare = sources.prepareSourceLinks.bind(sources);
    let aPid = 0, sourceTx: Prisma.TransactionClient | undefined;
    jest.spyOn(sources, 'prepareSourceLinks').mockImplementation(async (...[tx, references, actor]: Parameters<typeof prepare>) => {
      if (actor.id !== f.professional.user.id) return prepare(tx, references, actor);
      sourceTx = tx;
      const written = await prepare(tx, references, actor);
      aPid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
      entered.resolve();
      await release.promise;
      return written;
    });
    const aTraceId = randomUUID(), aKey = randomUUID();
    const a = settled(f.runtime.core.sources(f.professional.actor, problemId,
      { expectedVersion: current.version, add: [{ defectId: f.extra.sourceId, expectedVersion: f.extra.expectedVersion }],
        removeDefectIds: [], confirmCancelApproval: status === 'IN_REVIEW' }, aTraceId, aKey));
    let b: Promise<{ value: unknown } | { error: unknown }> | undefined;
    let wait: { pid: number; query: string; blockers: number[] } | undefined;
    let userLockCode: string | undefined;
    try {
      await Promise.race([entered.promise, a.then(() => { throw new Error('Source ended before the post-project time barrier'); })]);
      expect(Date.now()).toBeLessThan(effectiveAt.getTime());
      expect(observation.queries.get(sourceTx!)!.filter(q => q.sql.includes('FROM users') && q.sql.includes('FOR SHARE'))
        .some(q => q.values.includes(newcomer.user.id))).toBe(false);
      await delay(Math.max(0, effectiveAt.getTime() - Date.now() + 10));
      // Real wall time activates the persisted appointment/scope; no fake clock or eligibility substitution.
      const fresh = await app.get(OrganizationResponsibilityService).managementResponsibilities(f.org.id, f.section.id);
      expect(fresh.responsibilities).toEqual(expect.arrayContaining([expect.objectContaining({ userId: newcomer.user.id })]));
      b = settled(f.service.issue(newcomer.actor, f.input([f.matrixSources[0]!]), randomUUID(), randomUUID()));
      const until = Date.now() + 1500;
      while (!wait && Date.now() < until) {
        const rows = await prisma.$queryRaw<{ pid: number; query: string; blockers: number[] }[]>`SELECT pid, query, pg_blocking_pids(pid) AS blockers
          FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND ${aPid}::int = ANY(pg_blocking_pids(pid))`;
        wait = rows.find(row => row.query.includes('new_product_projects'));
        if (!wait) await delay(10);
      }
      const probe = await settled(prisma.$transaction(tx => tx.$queryRaw`SELECT id FROM users WHERE id = ${newcomer.user.id}::uuid FOR SHARE NOWAIT`));
      userLockCode = 'error' in probe ? sqlState(probe.error) : undefined;
    } finally {
      release.resolve();
      await Promise.all([a, b]);
    }
    const resultA = await a, resultB = await b!;
    console.info('source time fence evidence', JSON.stringify({ kind, status, effectiveAt, aPid, wait, userLockCode,
      databaseCodes: observation.databaseCodes, sourceConflict: 'error' in resultA, issueSucceeded: 'value' in resultB }));
    expect(wait?.blockers).toContain(aPid);
    expect(userLockCode).toBe('55P03');
    expect(resultA).toMatchObject({ error: { status: 409, response: { code: 'CONCURRENCY_CONFLICT' } } });
    expect(resultB).toMatchObject({ value: { replayed: false } });
    expect(observation.databaseCodes).not.toContain('40P01');
    expect(observation.databaseCodes).not.toContain('40001');
    expect(observation.queries.get(sourceTx!)!.filter(q => q.sql.includes('FROM users') && q.sql.includes('FOR SHARE'))
      .some(q => q.values.includes(newcomer.user.id))).toBe(false);
    expect(await snapshot()).toEqual(before);
    expect(await prisma.auditEvent.count({ where: { traceId: aTraceId } })).toBe(0);
    expect(await prisma.$queryRaw`SELECT key FROM new_product_eight_d_receipts WHERE key = ${aKey}`).toEqual([]);
    const [projectAfter] = await prisma.$queryRaw<{ version: number }[]>`SELECT version FROM new_product_projects WHERE id = ${f.project.id}::uuid`;
    expect(projectAfter!.version).toBe(projectBefore!.version + 1);
  }, 40_000);
});
