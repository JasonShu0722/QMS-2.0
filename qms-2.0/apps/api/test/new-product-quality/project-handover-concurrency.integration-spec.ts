import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { NewProductEightDSourceService } from '../../src/modules/new-product-quality/new-product-eight-d-source.service.js';
import { domainFixture, type DomainFixture, type Source } from '../common/internal-eight-d-domains.fixture.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) {
  throw new Error('Handover concurrency requires disposable loopback PostgreSQL, never preview 55440.');
}

describe('new-product project handover/link lock protocol on PostgreSQL', () => {
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

  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
  }

  // Pause only after a real transactional audit write; all business/locking code remains real.
  function pauseAudit(action: string) {
    const entered = deferred(), release = deferred();
    const audit = app.get(AuditLogService), original = audit.record.bind(audit);
    jest.spyOn(audit, 'record').mockImplementation(async (...args) => {
      const result = await original(...args);
      if (args[0].organizationId === f.org.id && args[0].action === action) {
        entered.resolve();
        await release.promise;
      }
      return result;
    });
    return { entered: entered.promise, release: release.resolve };
  }

  async function state(projectId = f.project.id) {
    const [row] = await prisma.$queryRaw<{ status: string; version: number }[]>`SELECT status, version FROM new_product_projects WHERE id = ${projectId}::uuid`;
    return row!;
  }

  async function otherProject() {
    const project = await f.quality.createProject(f.professional.actor,
      { code: randomUUID(), name: 'Other link target', productCode: randomUUID() }, randomUUID(), randomUUID());
    const record = await f.mappings.createProject(f.professional.actor, f.org.id,
      { code: project.code, name: project.name, stage: 'NEW_PRODUCT' }, randomUUID(), randomUUID());
    await f.mappings.createMapping(f.professional.actor, f.org.id,
      { componentCode: project.product_code, projectRecordId: record.id, productCategory: 'Concurrency' }, randomUUID(), randomUUID());
    return project;
  }

  async function select(project = f.project): Promise<Source> {
    const fact = await f.process.create(f.manager.actor,
      { description: 'Concurrent source', productCode: project.product_code }, randomUUID(), randomUUID());
    const selection = await f.quality.selectProcessDefect(f.manager.actor, project.id,
      { defectId: fact.id, expectedVersion: fact.version }, randomUUID(), randomUUID());
    return { sourceId: selection.id, expectedVersion: selection.source_version, factId: fact.id };
  }

  async function readyHandover(approveOpenRisk = false) {
    const actor = f.professional.actor;
    const stage = await f.quality.addStage(actor, f.project.id, { code: 'SOP', name: 'Gate' }, randomUUID(), randomUUID());
    const deliverable = await f.quality.addDeliverable(actor, stage.id,
      { code: 'SOP', name: 'Gate evidence', required: true }, randomUUID(), randomUUID());
    const evidence = await prisma.fileObject.create({ data: { organizationId: f.org.id, objectKey: randomUUID(), originalName: 'gate.txt', contentType: 'text/plain',
      sizeBytes: 1n, sha256: 'a'.repeat(64), verifiedSha256: 'a'.repeat(64), verifiedContentType: 'text/plain', verifiedSizeBytes: 1n,
      objectVersionId: randomUUID(), uploadCompletedAt: new Date(), scannedAt: new Date(), scannerEngine: 'fixture', scanStatus: 'CLEAN', status: 'AVAILABLE',
      resourceType: 'new-product-deliverable', resourceId: deliverable.id, resourceVersion: 1, uploadedById: actor.id } });
    await f.quality.submitDeliverable(actor, deliverable.id, { expectedVersion: 1, evidenceObjectId: evidence.id }, randomUUID(), randomUUID());
    await f.quality.reviewStage(actor, stage.id, { expectedVersion: 1, decision: 'PASS' }, randomUUID(), randomUUID());
    const batch = await f.quality.createTrialBatch(actor, f.project.id, { code: 'RUN' }, randomUUID(), randomUUID());
    await f.quality.recordMetric(actor, batch.id, { code: 'INPUT', target: 1, actual: 1, comparison: 'GTE', source: 'MANUAL' }, randomUUID(), randomUUID());
    await f.quality.createTrialSummary(actor, batch.id, { conclusion: 'Verified facts' }, randomUUID(), randomUUID());
    await f.quality.submitTrialSummary(actor, batch.id, { expectedVersion: 1 }, randomUUID(), randomUUID());
    await f.quality.decideTrialSummary(f.owner.actor, batch.id, { expectedVersion: 2, decision: 'APPROVE' }, randomUUID(), randomUUID());
    if (approveOpenRisk) await f.quality.approveMassProduction(actor, f.project.id,
      { decision: 'APPROVE', riskStatement: 'No unapproved risk', evidenceObjectId: evidence.id }, randomUUID(), randomUUID());
    return (expectedVersion: number) => f.quality.handoverProject(f.manager.actor, f.project.id,
      { expectedVersion, riskStatement: 'No unapproved risk' }, randomUUID(), randomUUID());
  }

  async function competing(first: () => Promise<unknown>, second: () => Promise<unknown>, action: string) {
    const transact = prisma.$transaction.bind(prisma);
    const databaseCodes: string[] = [];
    jest.spyOn(prisma, '$transaction').mockImplementation((async (work: any, options: any) => transact(async tx => {
      try { return await work(tx); }
      catch (error) {
        const failure = error as { meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } };
        const code = failure.meta?.code ?? failure.meta?.driverAdapterError?.cause?.originalCode;
        if (code) databaseCodes.push(code);
        throw error;
      }
    }, options)) as typeof prisma.$transaction);
    const gate = pauseAudit(action);
    const a = first().then(value => ({ value }), error => ({ error }));
    let b: typeof a | undefined;
    let secondSettled = false, blocked = false;
    const observed = new Set<string>();
    try {
      await Promise.race([gate.entered, delay(1500).then(() => { throw new Error('First operation did not reach its audit barrier'); })]);
      b = second().then(value => { secondSettled = true; return { value }; }, error => { secondSettled = true; return { error }; });
      for (let i = 0; i < 150 && !secondSettled && !blocked; i++) {
        const locks = await prisma.$queryRaw<{ query: string }[]>`SELECT query FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND cardinality(pg_blocking_pids(pid)) > 0`;
        locks.forEach(row => observed.add(row.query));
        blocked = locks.some(row => row.query.includes('new_product_projects') || row.query.includes('FROM users'));
        if (!blocked) await delay(10);
      }
    } finally { gate.release(); }
    const result = { first: await a, second: await b!, blocked, databaseCodes };
    console.info('Concurrency fence', JSON.stringify({ action, blocked, databaseCodes, locks: [...observed] }));
    return result;
  }

  const input = (sources: Source[]) => f.input(sources);
  const issue = (sources: Source[], key = randomUUID()) => f.service.issue(f.professional.actor, input(sources), randomUUID(), key);

  describe.each(['issue', 'sources.add'] as const)('%s versus handover', kind => {
    let write: () => Promise<unknown>;
    let handover: Awaited<ReturnType<typeof readyHandover>>;
    beforeEach(async () => {
      if (kind === 'issue') write = () => issue([f.chainSource]);
      else {
        const other = await otherProject(), problemId = await f.issue([await select(other)]);
        write = () => f.runtime.core.sources(f.professional.actor, problemId,
          { expectedVersion: 1, add: [{ defectId: f.chainSource.sourceId, expectedVersion: f.chainSource.expectedVersion }], removeDefectIds: [] }, randomUUID(), randomUUID());
      }
      handover = await readyHandover();
    }, 120_000);

    it('handover first fences the new link by another legal actor', async () => {
      const before = await state();
      const result = await competing(() => handover(before.version), write, 'NEW_PRODUCT_PROJECT_HANDED_OVER');
      expect(result.blocked).toBe(true);
      expect(result.first).toMatchObject({ value: { open_issue_count: 0, mass_production_approval_id: null } });
      expect(result.second).toMatchObject({ error: { status: 409, response: { code: 'NEW_PRODUCT_PROJECT_ARCHIVED' } } });
      expect(await state()).toEqual({ status: 'ARCHIVED', version: before.version + 1 });
      expect(await prisma.domainSourceIssueLink.count({ where: { sourceId: f.chainSource.sourceId, removedAt: null } })).toBe(0);
    });

    it('link first invalidates the handover snapshot and expectedVersion', async () => {
      const before = await state();
      const result = await competing(write, () => handover(before.version), kind === 'issue' ? 'NEW_PRODUCT_EIGHT_D_ISSUED' : 'NEW_PRODUCT_EIGHT_D_SOURCES');
      expect(result.blocked || result.databaseCodes.includes('40001')).toBe(true);
      expect(result.first).toHaveProperty('value');
      expect(result.second).toMatchObject({ error: { status: 409, response: { code: 'CONCURRENCY_CONFLICT' } } });
      expect(await state()).toEqual({ status: 'ACTIVE', version: before.version + 1 });
      expect(await prisma.$queryRaw`SELECT id FROM new_product_handovers WHERE project_id = ${f.project.id}::uuid`).toEqual([]);
      await expect(handover(before.version + 1)).rejects.toMatchObject({ status: 409, response: { code: 'NEW_PRODUCT_HANDOVER_TRIAL_SUMMARY_STALE' } });
    });
  });

  it('bumps each actual project once, not once per source, and never on issue replay', async () => {
    const other = await otherProject(), extra = await select(other), before = await state();
    const unrelated = await otherProject();
    const sources = [extra, f.chainSource, f.extra, await select(other)];
    const key = randomUUID(), first = await issue(sources, key);
    expect(await state()).toEqual({ status: 'ACTIVE', version: before.version + 1 });
    expect(await state(other.id)).toEqual({ status: 'ACTIVE', version: 2 });
    expect(await state(unrelated.id)).toEqual({ status: 'ACTIVE', version: 1 });
    expect(await issue(sources, key)).toMatchObject({ replayed: true, problem: { id: first.problem.id } });
    expect((await state()).version).toBe(before.version + 1);
    expect((await state(other.id)).version).toBe(2);
  });

  it('rolls back all project versions and links for a failed multi-project addition', async () => {
    const other = await otherProject(), extra = await select(other);
    const problemId = await f.issue([f.chainSource]);
    const before = await state(), otherBefore = await state(other.id);
    await expect(f.runtime.core.sources(f.professional.actor, problemId,
      { expectedVersion: 1, add: [extra, f.archived].map(s => ({ defectId: s.sourceId, expectedVersion: s.expectedVersion })), removeDefectIds: [] }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    expect(await state()).toEqual(before);
    expect(await state(other.id)).toEqual(otherBefore);
    expect(await prisma.domainSourceIssueLink.findMany({ where: { problemIndexId: problemId, removedAt: null }, select: { sourceId: true } })).toEqual([{ sourceId: f.chainSource.sourceId }]);
  });

  describe('successful replay and historical source continuity', () => {
    let issueKey: string, addKey: string, problemId: string, added: Awaited<ReturnType<typeof f.runtime.core.sources>>;
    let issueResponse: Awaited<ReturnType<typeof issue>>;
    beforeEach(async () => {
      await f.mappings.updateProject(f.professional.actor, f.org.id, f.projectRecord.id,
        { expectedVersion: f.projectRecord.version, stage: 'MASS_PRODUCTION' }, randomUUID(), randomUUID());
      issueKey = randomUUID(); addKey = randomUUID();
      issueResponse = await issue([f.chainSource], issueKey);
      problemId = String(issueResponse.problem.id);
      added = await f.runtime.core.sources(f.professional.actor, problemId,
        { expectedVersion: 1, add: [{ defectId: f.extra.sourceId, expectedVersion: f.extra.expectedVersion }], removeDefectIds: [] }, randomUUID(), addKey);
      const handover = await readyHandover(true);
      expect(await state()).toEqual({ status: 'ACTIVE', version: 3 });
      expect(await handover(3)).toMatchObject({ open_issue_count: 1, mass_production_approval_id: expect.any(String) });
    }, 120_000);

    it('replays issue and sources.add after handover without active rejection or version side effects', async () => {
      expect(await issue([f.chainSource], issueKey)).toMatchObject({ replayed: true, problem: { id: problemId } });
      expect(await f.runtime.core.sources(f.professional.actor, problemId,
        { expectedVersion: 1, add: [{ defectId: f.extra.sourceId, expectedVersion: f.extra.expectedVersion }], removeDefectIds: [] }, randomUUID(), addKey)).toEqual(added);
      expect(await state()).toEqual({ status: 'ARCHIVED', version: 4 });
      const reference = await f.reference(f.chainSource);
      expect(await prisma.$transaction(tx => app.get(NewProductEightDSourceService).lockAndResolve(tx, reference, f.professional.actor)))
        .toMatchObject({ sourceVersion: reference.sourceVersion, sourceSnapshot: reference.sourceSnapshot });
      const current = await f.service.read(f.owner.actor, problemId);
      expect(current.sources).toHaveLength(2);
      await f.runtime.core.risk(f.professional.actor, problemId, { expectedVersion: current.version, severity: 'MEDIUM', reason: 'In-flight change after handover' }, randomUUID(), randomUUID());
      expect(await state()).toEqual({ status: 'ARCHIVED', version: 4 });
    });

    it('rejects fresh issue and source addition after handover and rolls back links and versions', async () => {
      await expect(issue([f.matrixSources[0]!])).rejects.toMatchObject({ status: 409, response: { code: 'NEW_PRODUCT_PROJECT_ARCHIVED' } });
      await expect(f.runtime.core.sources(f.professional.actor, problemId,
        { expectedVersion: added.version, add: [{ defectId: f.matrixSources[0]!.sourceId, expectedVersion: 1 }], removeDefectIds: [] }, randomUUID(), randomUUID()))
        .rejects.toMatchObject({ status: 409, response: { code: 'NEW_PRODUCT_PROJECT_ARCHIVED' } });
      expect(await state()).toEqual({ status: 'ARCHIVED', version: 4 });
      expect(await prisma.domainSourceIssueLink.count({ where: { sourceId: f.matrixSources[0]!.sourceId, removedAt: null } })).toBe(0);
      expect((await f.service.read(f.owner.actor, problemId)).version).toBe(added.version);
    });
  });

  describe.each(['issue', 'sources.add'] as const)('%s batch ordering', kind => {
    let other: DomainFixture['project'], a: Source[], b: Source[];
    let first: () => Promise<unknown>, second: () => Promise<unknown>;
    beforeEach(async () => {
      other = await otherProject();
      a = [f.chainSource, await select(other)];
      b = [await select(other), f.extra];
      if (kind === 'issue') {
        first = () => issue(a);
        second = () => f.service.issue(f.manager.actor, input(b), randomUUID(), randomUUID());
      } else {
        const base = await otherProject();
        const p1 = await f.issue([await select(base)]), p2 = await f.issue([await select(base)]);
        first = () => f.runtime.core.sources(f.professional.actor, p1,
          { expectedVersion: 1, add: a.map(s => ({ defectId: s.sourceId, expectedVersion: s.expectedVersion })), removeDefectIds: [] }, randomUUID(), randomUUID());
        second = () => f.runtime.core.sources(f.manager.actor, p2,
          { expectedVersion: 1, add: b.map(s => ({ defectId: s.sourceId, expectedVersion: s.expectedVersion })), removeDefectIds: [] }, randomUUID(), randomUUID());
      }
    }, 120_000);

    it('takes sorted project write locks before any exact source rows for opposing multi-project batches', async () => {
      const [low, high] = [f.project.id, other.id].sort();
      let run1: Promise<unknown> | undefined, run2: Promise<unknown> | undefined;
      try {
        await prisma.$transaction(async blocker => {
          await blocker.$queryRaw`SELECT id FROM new_product_projects WHERE id = ${high}::uuid FOR UPDATE`;
          run1 = first();
          let projectWait = false;
          for (let i = 0; i < 100 && !projectWait; i++) {
            const rows = await prisma.$queryRaw<{ query: string }[]>`SELECT query FROM pg_stat_activity WHERE datname = current_database()
              AND wait_event_type = 'Lock' AND cardinality(pg_blocking_pids(pid)) > 0`;
            projectWait = rows.some(row => row.query.includes('new_product_projects'));
            if (!projectWait) await delay(10);
          }
          expect(projectWait).toBe(true);
          await expect(prisma.$transaction(tx => tx.$queryRaw`SELECT id FROM new_product_projects WHERE id = ${low}::uuid FOR UPDATE NOWAIT`)).rejects.toThrow(/could not obtain lock/i);
          // The blocked batch must not hold even its first selection or process row yet.
          await prisma.$transaction(async probe => {
            for (const source of [...a, ...b]) {
              expect(await probe.$queryRaw`SELECT id FROM new_product_defect_selections WHERE id = ${source.sourceId}::uuid FOR UPDATE NOWAIT`).toHaveLength(1);
              expect(await probe.$queryRaw`SELECT id FROM process_defects WHERE id = ${source.factId}::uuid FOR UPDATE NOWAIT`).toHaveLength(1);
            }
          });
          run2 = second();
        });
      } finally { await Promise.allSettled([run1, run2].filter(Boolean)); }
      await expect(run1).resolves.toBeDefined();
      await expect(run2).resolves.toBeDefined();
      expect(await state(low)).toEqual({ status: 'ACTIVE', version: 3 });
      expect(await state(high)).toEqual({ status: 'ACTIVE', version: 3 });
      for (const source of [...a, ...b]) expect(await prisma.domainSourceIssueLink.count({ where: { sourceId: source.sourceId, removedAt: null } })).toBe(1);
    });
  });

  describe('selection entry versus link entry', () => {
    const selectionAction = () => f.quality.selectProcessDefect(f.owner.actor, f.project.id,
      { defectId: f.chainSource.factId, expectedVersion: f.chainSource.expectedVersion }, randomUUID(), randomUUID());

    it('link first does not hold project while waiting on the selection actor/owner', async () => {
      const before = await state();
      const result = await competing(() => issue([f.chainSource]), selectionAction, 'NEW_PRODUCT_EIGHT_D_ISSUED');
      expect(result.first).toHaveProperty('value');
      expect(result.second).toMatchObject({ error: { status: 409, response: { code: 'CONCURRENCY_CONFLICT' } } });
      expect(result.blocked || result.databaseCodes.includes('40001')).toBe(true);
      expect(await state()).toEqual({ status: 'ACTIVE', version: before.version + 1 });
    });

    it('selection first holds project then process, and link waits before acquiring process or owner', async () => {
      const service = app.get(NewProductEightDSourceService), original = service.selectionSnapshot.bind(service);
      const entered = deferred(), release = deferred();
      jest.spyOn(service, 'selectionSnapshot').mockImplementation(async (...args) => {
        const snapshot = await original(...args);
        entered.resolve(); await release.promise;
        return snapshot;
      });
      const selecting = selectionAction().then(value => ({ value }), error => ({ error }));
      let issuing: ReturnType<typeof issue> | undefined;
      try {
        await entered.promise;
        issuing = issue([f.chainSource]);
        let blocked = false;
        for (let i = 0; i < 100 && !blocked; i++) {
          const rows = await prisma.$queryRaw<{ query: string }[]>`SELECT query FROM pg_stat_activity WHERE datname = current_database()
            AND wait_event_type = 'Lock' AND cardinality(pg_blocking_pids(pid)) > 0`;
          blocked = rows.some(row => row.query.includes('FROM users'));
          if (!blocked) await delay(10);
        }
        expect(blocked).toBe(true);
      } finally { release.resolve(); }
      // Same-fact selection is a real duplicate rejection, never a test reset or a second fact.
      expect(await selecting).toMatchObject({ error: { status: 409, response: { code: 'CONCURRENCY_CONFLICT' } } });
      await expect(issuing).resolves.toMatchObject({ replayed: false });
      expect(await state()).toEqual({ status: 'ACTIVE', version: 2 });
    });
  });

  it.each(['organization', 'account-type', 'session'] as const)('rejects forged source actor %s against the current DB user', async field => {
    const sources = app.get(NewProductEightDSourceService);
    const actor = { ...f.professional.actor };
    if (field === 'organization') actor.organizationId = randomUUID();
    if (field === 'account-type') actor.accountType = 'SUPPLIER';
    if (field === 'session') actor.sessionId = f.owner.actor.sessionId;
    const reference = await f.reference(f.chainSource);
    await expect(sources.sourceReference(actor, f.chainSource.sourceId)).rejects.toMatchObject({ status: field === 'account-type' ? 403 : 401 });
    await expect(prisma.$transaction(tx => sources.lockAndResolve(tx, reference, actor))).rejects.toMatchObject({ status: field === 'account-type' ? 403 : 401 });
  });
});
