import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import type { AdminActor, AdminTransaction } from '../../src/common/security/admin-mutation.service.js';
import type { SupplierCopySource } from '../../src/common/eight-d/supplier-copy.types.js';
import { isSecurityConcurrencyConflict } from '../../src/common/security/session-security.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { ProcessDefectLedgerService } from '../../src/modules/process-quality/process-defect-ledger.service.js';
import { NewProductEightDSourceService } from '../../src/modules/new-product-quality/new-product-eight-d-source.service.js';
import { SupplierEightDSourceModule } from '../../src/modules/supplier-eight-d-source/supplier-eight-d-source.module.js';
import { SupplierEightDSourceService } from '../../src/modules/supplier-eight-d-source/supplier-eight-d-source.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) throw new Error('Exclusive disposable source PostgreSQL required, never 55440');

describe('supplier copy physical source lock order and controlled preview conflicts', () => {
  let app: INestApplication; let db: PrismaService; let service: SupplierEightDSourceService; let project: NewProductEightDSourceService;
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule, SupplierEightDSourceModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init(); db = app.get(PrismaService); service = app.get(SupplierEightDSourceService); project = app.get(NewProductEightDSourceService);
  }, 120_000);
  afterAll(async () => { await app?.close(); });

  async function fixture() {
    const org = await db.organization.create({ data: { code: randomUUID(), name: 'Isolated concurrent copiers', type: 'INTERNAL' } });
    const codes = ['supplier-quality:issues:copy', 'supplier-quality:problems:write', 'process-quality:defects:read', 'new-product-quality:projects:read'];
    const permissions = await db.permission.findMany({ where: { code: { in: codes } } }); expect(permissions).toHaveLength(codes.length);
    const role = await db.role.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Actual copy permissions', permissions: { create: permissions.map(p => ({ permissionId: p.id })) } } });
    const actors = [] as Array<{ actor: AdminActor; cookie: string }>;
    for (let i = 0; i < 2; i++) {
      const user = await db.user.create({ data: { organizationId: org.id, username: randomUUID(), passwordHash: 'fixture-only', accountType: 'INTERNAL', userRoles: { create: { organizationId: org.id, roleId: role.id } } } });
      const token = await app.get(SessionService).create(user.id, db, { mfaVerified: true, reauthenticated: true });
      const session = await app.get(SessionService).resolve(token); expect(session).not.toBeNull();
      actors.push({ actor: { id: user.id, sessionId: session!.id, organizationId: org.id, accountType: 'INTERNAL' }, cookie: `qms_session=${token}` });
    }
    const profile = await db.supplierBusinessProfile.create({ data: { ownerOrganizationId: org.id, businessCode: randomUUID(), displayName: 'Target draft profile' } });
    const defects = []; const wrappers: SupplierCopySource[] = [];
    for (let i = 0; i < 2; i++) {
      const defect = await db.processDefect.create({ data: { organizationId: org.id, description: `Observed ${i}`, defectQuantity: i + 1, createdById: actors[0]!.actor.id, updatedById: actors[0]!.actor.id } });
      defects.push(defect);
      const projectId = randomUUID(), selectionId = randomUUID();
      await db.$executeRaw`INSERT INTO new_product_projects(id, organization_id, code, name, product_code, created_by_id)
        VALUES (${projectId}::uuid, ${org.id}::uuid, ${randomUUID()}, 'Lock order project', 'COMPONENT', ${actors[0]!.actor.id}::uuid)`;
      await db.$executeRaw`INSERT INTO new_product_defect_selections(id, organization_id, project_id, defect_id, source_version, source_snapshot, selected_by_id)
        VALUES (${selectionId}::uuid, ${org.id}::uuid, ${projectId}::uuid, ${defect.id}::uuid, ${defect.version},
          ${JSON.stringify({ description: defect.description, defectQuantity: defect.defectQuantity, materials: [] })}::jsonb, ${actors[0]!.actor.id}::uuid)`;
      wrappers.push({ kind: 'NEW_PRODUCT_SELECTION', sourceId: selectionId, sourceVersion: defect.version });
    }
    const direct = defects.map(d => ({ kind: 'PROCESS_LEDGER' as const, sourceId: d.id, sourceVersion: d.version }));
    const inputs = [
      { supplierProfileId: profile.id, sources: [wrappers[0]!, direct[1]!] },
      { supplierProfileId: profile.id, sources: [wrappers[1]!, direct[0]!] },
    ];
    const draft = { profileId: profile.id, title: 'Explicit reviewed copy', materialCode: 'CHOSEN', defectDescription: 'Reviewed by actual actor', defectQuantity: 2,
      severity: 'MEDIUM' as const, responseForm: 'EIGHT_D' as const, replyMode: 'SUPPLIER' as const };
    return { org, actors, defects, wrappers, direct, inputs, draft };
  }

  async function until(check: () => Promise<boolean>) {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      if (await check()) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Real PostgreSQL barrier was not reached');
  }

  // Transparent scheduling taps: every public port still executes its real SQL, ACL and projection.
  async function withMixedSourceBarrier<T>(work: () => Promise<T>) {
    const prepare = project.prepareSupplierCopyProjection, projection = project.supplierCopyProjection;
    const pids = new Map<string, number>(); const reached = new Set<string>(); let serialized = false;
    project.prepareSupplierCopyProjection = async function(tx, actor, sources) {
      const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      pids.set(actor.id, row!.pid);
      await until(async () => pids.size === 2);
      return prepare.call(this, tx, actor, sources);
    };
    project.supplierCopyProjection = async function(tx, actor, source) {
      const result = await projection.call(this, tx, actor, source);
      reached.add(actor.id);
      await until(async () => {
        if (reached.size === 2) return true;
        const other = [...pids.entries()].find(([id]) => id !== actor.id)![1];
        const [row] = await db.$queryRaw<Array<{ blocked: boolean }>>`SELECT ${pids.get(actor.id)!} = ANY(pg_blocking_pids(${other})) AS blocked`;
        if (row!.blocked) serialized = true;
        return row!.blocked;
      });
      return result;
    };
    try { return { value: await work(), serialized }; }
    finally { project.prepareSupplierCopyProjection = prepare; project.supplierCopyProjection = projection; }
  }

  it.each(['direct', 'wrapper'] as const)('proves the %s public projection holds a process lock conflicting with SHARE in real PG', async kind => {
    const f = await fixture(); const actor = f.actors[0]!.actor;
    await db.$transaction(async tx => {
      const source = kind === 'direct' ? f.direct[0]! : f.wrappers[0]!;
      const port = kind === 'direct' ? app.get(ProcessDefectLedgerService) : project;
      await port.supplierCopyProjection(tx, actor, source);
      await expect(db.$transaction(other => other.$queryRaw`SELECT id FROM process_defects WHERE id = ${f.defects[0]!.id}::uuid FOR SHARE NOWAIT`))
        .rejects.toMatchObject({ meta: expect.objectContaining({ driverAdapterError: expect.objectContaining({ cause: expect.objectContaining({ originalCode: '55P03' }) }) }) });
    });
  });

  it.each(['preview', 'draft'] as const)('serializes crossed wrapper/direct physical resources for two distinct actors during %s', async mode => {
    const f = await fixture(); const previews: Awaited<ReturnType<typeof service.preview>>[] = [];
    if (mode === 'draft') for (let i = 0; i < 2; i++) previews.push(await service.preview(f.actors[i]!.actor, f.inputs[i]!, randomUUID()));
    const result = await withMixedSourceBarrier(() => Promise.allSettled(f.actors.map(({ actor }, i) => mode === 'preview'
      ? service.preview(actor, f.inputs[i]!, randomUUID())
      : service.createDraft(actor, { token: previews[i]!.token, draft: f.draft }, randomUUID(), randomUUID()))));
    const failures = result.value.filter(outcome => outcome.status === 'rejected');
    console.info('crossed physical resources', mode, result.value.map(outcome => outcome.status === 'fulfilled' ? { status: 'success' }
      : { status: 'rejected', securityConcurrency: isSecurityConcurrencyConflict(outcome.reason), code: outcome.reason.code, meta: outcome.reason.meta, response: outcome.reason.response }));
    expect(failures).toEqual([]);
    expect(result.serialized).toBe(true);
    if (mode === 'preview') {
      for (const outcome of result.value) if (outcome.status === 'fulfilled') expect(outcome.value).toMatchObject({ facts: expect.arrayContaining(f.defects.map(d => ({ factKey: `PROCESS_LEDGER:${d.id}`, defectDescription: d.description, defectQuantity: d.defectQuantity, materials: [] }))) });
      const [count] = await db.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM supplier_copy_previews WHERE organization_id = ${f.org.id}::uuid`;
      expect(count!.count).toBe(2);
    } else {
      expect(await db.supplierQualityProblem.count({ where: { ownerOrganizationId: f.org.id, releasedToSupplierAt: null } })).toBe(2);
      const [count] = await db.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM supplier_copy_provenance WHERE organization_id = ${f.org.id}::uuid`;
      expect(count!.count).toBe(2);
    }
  }, 20000);

  it('maps an actual PG deadlock at preview to controlled 409, rolls back the loser, and permits a real retry', async () => {
    const f = await fixture(); const prepare = project.prepareSupplierCopyProjection;
    const held = new Set<string>(); const databaseErrors: unknown[] = [];
    project.prepareSupplierCopyProjection = async function(tx: AdminTransaction, actor, sources) {
      const i = f.actors.findIndex(person => person.actor.id === actor.id);
      // Induce a real database victim, not a mocked exception, independently of the repaired source ordering.
      await tx.$queryRaw`SELECT id FROM process_defects WHERE id = ${f.defects[i]!.id}::uuid FOR UPDATE`;
      held.add(actor.id); await until(async () => held.size === 2);
      try { await tx.$queryRaw`SELECT id FROM process_defects WHERE id = ${f.defects[1 - i]!.id}::uuid FOR UPDATE`; }
      catch (error) { databaseErrors.push(error); throw error; }
      return prepare.call(this, tx, actor, sources);
    };
    const post = (i: number) => {
      const csrf = randomUUID();
      return request(app.getHttpServer()).post('/api/v1/supplier-quality/source-copies/preview')
        .set('Cookie', [f.actors[i]!.cookie, `qms_csrf=${csrf}`]).set('x-csrf-token', csrf).send(f.inputs[i]);
    };
    let settled: PromiseSettledResult<request.Response>[];
    try { settled = await Promise.allSettled([post(0), post(1)]); }
    finally { project.prepareSupplierCopyProjection = prepare; }
    expect(databaseErrors).toHaveLength(1); expect(isSecurityConcurrencyConflict(databaseErrors[0])).toBe(true);
    const responses = settled.map(outcome => { expect(outcome.status).toBe('fulfilled'); return (outcome as PromiseFulfilledResult<request.Response>).value; });
    console.info('actual preview deadlock HTTP statuses', responses.map(response => response.status));
    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
    const loser = responses.findIndex(response => response.status === 409);
    expect(responses[loser]!.body).toMatchObject({ code: 'CONCURRENCY_CONFLICT' });
    const [count] = await db.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM supplier_copy_previews WHERE organization_id = ${f.org.id}::uuid`;
    expect(count!.count).toBe(1);
    expect(await db.auditEvent.count({ where: { organizationId: f.org.id, action: 'SUPPLIER_SOURCE_COPY_PREVIEWED' } })).toBe(1);
    expect(await db.supplierQualityProblem.count({ where: { ownerOrganizationId: f.org.id } })).toBe(0);
    await post(loser).expect(201);
    const [retried] = await db.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM supplier_copy_previews WHERE organization_id = ${f.org.id}::uuid`;
    expect(retried!.count).toBe(2);
  }, 20000);
});
