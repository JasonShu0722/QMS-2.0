import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import type { AdministrativeLifecycleImpact } from '../../src/common/security/administrative-lifecycle.types.js';
import { INTERNAL_EIGHT_D_DOMAINS, internalEightDSql } from '../../src/common/eight-d/internal-eight-d-domain.js';
import { WorkflowAdministrativeInvalidationService } from '../../src/modules/workflow/workflow-administrative-invalidation.service.js';
import { WorkflowClosureRoundService } from '../../src/modules/workflow/workflow-closure-round.service.js';
import { APPLICATION_OUTBOX_HANDLER, OutboxWorkerService, type AtomicOutboxHandler } from '../../src/modules/task-notification/outbox-worker.service.js';
import { emptyProcessEightDDocument } from '../../src/modules/process-quality/process-eight-d-document.js';
import { createWorkflowClosureFixture } from './workflow-closure-round.fixture.js';
import { supplierEightDDocument, supplierEightDFixture } from '../supplier-quality/supplier-eight-d.fixture.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { createDisposableAppDatabase } from '../disposable-app-database.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) {
  throw new Error('Explicit disposable loopback PostgreSQL required; never preview 55440.');
}

describe('actual administrative domain hooks and original Worker handlers / real PostgreSQL', () => {
  let app: INestApplication, db: PrismaService, engine: WorkflowAdministrativeInvalidationService, rounds: WorkflowClosureRoundService;
  let admin: Awaited<ReturnType<typeof createWorkflowClosureFixture>>, worker: OutboxWorkerService, handler: AtomicOutboxHandler;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  beforeAll(async () => {
    process.env.DATABASE_URL = await createDisposableAppDatabase('qms_workflow_admin_return');
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init(); db = app.get(PrismaService); rounds = app.get(WorkflowClosureRoundService);
    // Production registry/bootstrap/effects, not neutral callback replacements.
    engine = app.get(WorkflowAdministrativeInvalidationService); worker = app.get(OutboxWorkerService); handler = app.get(APPLICATION_OUTBOX_HANDLER);
    admin = await createWorkflowClosureFixture(db, rounds);
    await db.rolePermission.create({ data: { roleId: admin.role.id,
      permissionId: (await db.permission.findUniqueOrThrow({ where: { code: 'platform:admin' } })).id } });
  }, 120_000);
  afterAll(async () => {
    try { await app?.close(); }
    finally {
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });
  const impact = (organizationId: string, userId: string): AdministrativeLifecycleImpact => ({
    kind: 'USER', entityId: userId, organizationId, receiptOrganizationId: admin.org.id,
    userIds: [userId], departmentIds: [], positionIds: [], organizationIds: [],
  });
  const apply = (input: AdministrativeLifecycleImpact) => db.$transaction(tx => engine.apply(tx, admin.owner.actor, input), { timeout: 30_000 });
  async function historicalSignature(organizationId: string, userId: string, resourceId: string) {
    // Persist an existing immutable signature fact; this fixture is not evidence of the signing UI/credential flow.
    const signatureId = randomUUID(), fingerprint = createHash('sha256').update(signatureId).digest('hex');
    await db.$executeRaw`INSERT INTO user_signatures (id,organization_id,user_id,label,fingerprint)
      VALUES (${signatureId}::uuid,${organizationId}::uuid,${userId}::uuid,'Existing historical signature',${fingerprint})`;
    await db.$executeRaw`INSERT INTO approval_signatures
      (id,organization_id,signature_id,signer_user_id,resource_type,resource_id,resource_version,signature_fingerprint,signed_digest)
      VALUES (${randomUUID()}::uuid,${organizationId}::uuid,${signatureId}::uuid,${userId}::uuid,
        'EIGHT_D_REPORT',${resourceId},1,${fingerprint},${createHash('sha256').update(resourceId).digest('hex')})`;
  }
  async function drain() {
    let processed = 0;
    for (let batch = 0; batch < 20; batch++) {
      const result = await worker.processAtomicDue(100, handler);
      expect(result.failed).toBe(0); expect(result.retried).toBe(0); processed += result.processed;
      const pending = await db.outboxEvent.findMany({ where: { eventType: { in: [...handler.eventTypes] }, status: { not: 'PROCESSED' } },
        select: { status: true, availableAt: true } });
      if (!pending.length) return processed;
      expect(pending.every(event => event.status === 'PENDING')).toBe(true);
      await setTimeout(Math.max(10, Math.min(1100, Math.min(...pending.map(event => event.availableAt.getTime())) - Date.now() + 10)));
    }
    expect(await db.outboxEvent.count({ where: { eventType: { in: [...handler.eventTypes] }, status: { not: 'PROCESSED' } } })).toBe(0);
    return processed;
  }

  it.each(Object.values(INTERNAL_EIGHT_D_DOMAINS))('$domainCode clears only own submission through the shared core and retires old duties without a handling ping', async domain => {
    const f = await createWorkflowClosureFixture(db, rounds), tables = internalEightDSql(domain);
    for (const code of [`${domain.permissionPrefix}:read`, `${domain.permissionPrefix}:work`]) {
      await db.rolePermission.create({ data: { roleId: f.role.id, permissionId: (await db.permission.findUniqueOrThrow({ where: { code } })).id } });
    }
    await db.problemIndex.update({ where: { id: f.problem.id }, data: { domainCode: domain.domainCode, sourceType: domain.sourceType, problemType: 'EIGHT_D' } });
    await db.workflowNode.update({ where: { id: f.node.id }, data: { config: { closureReview: { schemaVersion: 1, policy: 'INTERNAL', domainCode: domain.domainCode } } } });
    const ownerNode = await db.workflowNode.create({ data: { organizationId: f.org.id, workflowVersionId: f.instance.workflowVersionId,
      nodeKey: 'owner', type: 'ACTION', name: 'Actual controlled owner', config: { isStart: true,
        processEightD: { schemaVersion: 1, extensionPolicy: 'LEADER_THEN_PROFESSIONAL', reminderEveryHours: 24 } } } });
    await db.workflowTransition.create({ data: { organizationId: f.org.id, workflowVersionId: f.instance.workflowVersionId,
      fromNodeId: f.node.id, toNodeId: ownerNode.id, action: 'RETURN', transitionKey: 'return-owner' } });
    await db.$executeRaw`INSERT INTO ${tables.reports} (problem_id,organization_id,responsible_section_department_id,professional_user_id,document,submitted_at,created_by,updated_by)
      VALUES (${f.problem.id}::uuid,${f.org.id}::uuid,${f.section.id}::uuid,${f.professional.user.id}::uuid,
        ${JSON.stringify(emptyProcessEightDDocument())}::jsonb,CURRENT_TIMESTAMP,${f.professional.user.id}::uuid,${f.professional.user.id}::uuid)`;
    const initial = await rounds.start(f.owner.actor, f.problem.id, { expectedContentVersion: 1, expectedInstanceVersion: 1 }, randomUUID(), randomUUID());
    const round = await rounds.decide(f.professional.actor, initial.id, { expectedRoundVersion: initial.version,
      duties: ['PROFESSIONAL'], decision: 'APPROVE', comment: 'Keep this real professional approval' }, randomUUID(), randomUUID());
    const approved = await db.$queryRaw`SELECT * FROM workflow_closure_duties WHERE round_id=${round.id}::uuid AND status='APPROVED'`;
    await historicalSignature(f.org.id, f.professional.user.id, f.problem.id);
    const signatures = await db.$queryRaw`SELECT * FROM approval_signatures ORDER BY id`;
    await drain();
    const notifications = await db.$queryRaw`SELECT * FROM closure_notifications WHERE round_id=${round.id}::uuid ORDER BY id`;
    expect(await apply(impact(f.org.id, f.manager.user.id))).toMatchObject({ changed: 1 });
    expect(await drain()).toBeGreaterThan(0);
    expect(await db.$queryRaw`SELECT submitted_at,version,updated_by FROM ${tables.reports} WHERE problem_id=${f.problem.id}::uuid`)
      .toEqual([{ submitted_at: null, version: 2, updated_by: admin.owner.user.id }]);
    expect(await db.workflowInstance.findUniqueOrThrow({ where: { id: f.instance.id } }))
      .toMatchObject({ currentNodeId: ownerNode.id, version: 2, updatedById: admin.owner.user.id });
    expect(await db.workflowMutation.findMany({ where: { instanceId: f.instance.id } }))
      .toEqual([expect.objectContaining({ action: 'RETURN', actorUserId: admin.owner.user.id,
        response: expect.objectContaining({ administrative: true, cancelledRoundId: round.id }) })]);
    expect(await db.$queryRaw`SELECT * FROM workflow_closure_duties WHERE round_id=${round.id}::uuid AND status='APPROVED'`).toEqual(approved);
    expect(await db.$queryRaw`SELECT * FROM approval_signatures ORDER BY id`).toEqual(signatures);
    expect(await db.$queryRaw`SELECT * FROM closure_notifications WHERE round_id=${round.id}::uuid ORDER BY id`).toEqual(notifications);
    expect(await db.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw(`${domain.storagePrefix}_notifications`)} WHERE problem_id=${f.problem.id}::uuid`)).toEqual([]);
    expect(await db.$transaction(tx => rounds.notificationRecipients(tx, f.org.id, f.problem.id, round.id, round.version))).toEqual([]);
    expect((await rounds.eligibleDuties(f.manager.actor)).filter(duty => duty.problemId === f.problem.id)).toEqual([]);
    await expect(rounds.decide(f.manager.actor, round.id, { expectedRoundVersion: round.version, duties: ['SECTION_MANAGER'],
      decision: 'APPROVE', comment: 'Late decision rejected' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
  }, 30_000);

  it('supplier submitted report keeps immutable revision/signatures and consumes cancellation without ADMIN_INVALIDATION parse failure or ordinary RETURN ping', async () => {
    const f = await supplierEightDFixture(app, 'LOW', false, 'INTERNAL');
    let row = await f.read();
    row = (await f.http(f.outsider.cookie, 'put', f.prefix, { ...f.version(row), document: supplierEightDDocument() }).expect(200)).body;
    row = (await f.http(f.outsider.cookie, 'post', `${f.prefix}/analysis-complete`, { ...f.version(row), submissionDueAt: '2026-11-03T00:00:00Z' }).expect(201)).body;
    row = (await f.http(f.outsider.cookie, 'post', `${f.prefix}/submit`, f.version(row)).expect(201)).body;
    const revision = await db.supplierResponseRevision.findUniqueOrThrow({ where: { id: row.submittedRevisionId } });
    const round = (await rounds.readProjection(db, f.f.org.id, row.problemId))!;
    await historicalSignature(f.f.org.id, f.sqe.actor.id, row.problemId);
    const signatures = await db.$queryRaw`SELECT * FROM approval_signatures ORDER BY id`;
    await drain();
    const notifications = await db.$queryRaw`SELECT * FROM supplier_eight_d_notifications WHERE supplier_problem_id=${f.draft.id}::uuid ORDER BY id`;
    const eventIds = (await db.outboxEvent.findMany({ select: { id: true } })).map(event => event.id);
    expect(await apply(impact(f.f.org.id, f.manager.actor.id))).toMatchObject({ changed: 1 });
    const newEvents = await db.outboxEvent.findMany({ where: { id: { notIn: eventIds } } });
    expect(newEvents.map(event => event.eventType)).toEqual(['WORKFLOW_CLOSURE_CHANGED']);
    expect(await drain()).toBeGreaterThan(0);
    expect(await f.read()).toMatchObject({ submittedRevisionId: null, closedAt: null, instanceVersion: row.instanceVersion + 1 });
    expect(await db.workflowMutation.findUniqueOrThrow({ where: { instanceId_instanceVersion: {
      instanceId: row.instanceId, instanceVersion: row.instanceVersion + 1,
    } } })).toMatchObject({ actorUserId: admin.owner.user.id, response: { administrative: true, cancelledRoundId: round.id } });
    expect(await db.auditEvent.count({ where: { resourceId: f.draft.id, actorUserId: admin.owner.user.id,
      action: 'SUPPLIER_EIGHT_D_ADMINISTRATIVELY_INVALIDATED' } })).toBe(1);
    expect(await db.supplierResponseRevision.findUniqueOrThrow({ where: { id: row.submittedRevisionId } })).toEqual(revision);
    expect(await db.$queryRaw`SELECT * FROM approval_signatures ORDER BY id`).toEqual(signatures);
    expect(await db.$queryRaw`SELECT * FROM supplier_eight_d_notifications WHERE supplier_problem_id=${f.draft.id}::uuid ORDER BY id`).toEqual(notifications);
    expect(await db.$transaction(tx => rounds.notificationRecipients(tx, f.f.org.id, row.problemId, round.id, round.version))).toEqual([]);
    expect((await rounds.eligibleDuties(f.manager.actor)).filter(duty => duty.problemId === row.problemId)).toEqual([]);
    await expect(rounds.decide(f.manager.actor, round.id, { expectedRoundVersion: round.version, duties: ['SECTION_MANAGER'],
      decision: 'APPROVE', comment: 'Late supplier approval' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    const returned = await f.read();
    const resubmitted = (await f.http(f.outsider.cookie, 'post', `${f.prefix}/submit`, f.version(returned)).expect(201)).body;
    expect(resubmitted.instanceVersion).toBe(returned.instanceVersion + 1);
    expect(await drain()).toBeGreaterThan(0);
    expect((await db.workflowInstance.findUniqueOrThrow({ where: { id: row.instanceId } })).taskProjectionVersion).toBe(resubmitted.instanceVersion);
  }, 60_000);

  it('supplier domain deadline cancellation keeps the original SQE decision and legal deadline event consumable without extra approval reminders', async () => {
    const f = await supplierEightDFixture(app, 'HIGH');
    let row = await f.read();
    row = (await f.http(f.sqe.cookie, 'put', `${f.prefix}/deadlines`, { ...f.version(row), analysisDueAt: '2026-10-01T00:00:00Z', closureDueAt: '2026-11-01T00:00:00Z' }).expect(200)).body;
    const preview = (await f.http(f.sqe.cookie, 'post', `${f.prefix}/disclosure-preview`, { expectedRowVersion: row.rowVersion, selectedFileIds: [] }).expect(200)).body;
    await f.http(f.sqe.cookie, 'post', `${f.prefix}/release`, { expectedRowVersion: preview.rowVersion, previewToken: preview.previewToken, confirmed: true, selectedFileIds: [] }).expect(200);
    row = await f.read();
    const pending = (await f.http(f.vendor.cookie, 'post', `${f.portal}/deadline-extensions`, { ...f.version(row), expectedContentVersion: row.contentVersion,
      stage: 'ANALYSIS', requestedDueAt: '2026-12-01T00:00:00Z', reason: 'Real applicant deadline request' }).expect(201)).body;
    await f.http(f.sqe.cookie, 'post', `${f.prefix}/deadline-extensions/${pending.id}/decide`, {
      expectedVersion: pending.version, duty: 'SQE', decision: 'APPROVE', comment: 'Keep this original SQE decision',
    }).expect(200);
    const decisions = await db.$queryRaw`SELECT * FROM supplier_eight_d_deadline_decisions WHERE request_id=${pending.id}::uuid`;
    await historicalSignature(f.f.org.id, f.sqe.actor.id, pending.id);
    const signatures = await db.$queryRaw`SELECT * FROM approval_signatures ORDER BY id`;
    await drain();
    const notifications = await db.$queryRaw`SELECT * FROM supplier_eight_d_notifications WHERE supplier_problem_id=${f.draft.id}::uuid ORDER BY id`;
    const instanceVersion = row.instanceVersion;
    expect(await apply(impact(f.f.org.id, f.vendor.user.id))).toMatchObject({ changed: 1 });
    expect(await drain()).toBeGreaterThan(0);
    expect(await db.$queryRaw`SELECT status FROM supplier_eight_d_deadline_requests WHERE id=${pending.id}::uuid`).toEqual([{ status: 'CANCELLED' }]);
    expect(await db.$queryRaw`SELECT * FROM supplier_eight_d_deadline_decisions WHERE request_id=${pending.id}::uuid`).toEqual(decisions);
    expect(await db.$queryRaw`SELECT * FROM approval_signatures ORDER BY id`).toEqual(signatures);
    expect(await db.$queryRaw`SELECT * FROM supplier_eight_d_notifications WHERE supplier_problem_id=${f.draft.id}::uuid ORDER BY id`).toEqual(notifications);
    expect((await f.read()).instanceVersion).toBe(instanceVersion);
  }, 60_000);
});
