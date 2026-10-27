import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { ProcessEightDReminderService } from '../../src/modules/process-quality/process-eight-d-reminder.service.js';
import { APPLICATION_OUTBOX_HANDLER, OutboxWorkerService, type AtomicOutboxHandler } from '../../src/modules/task-notification/outbox-worker.service.js';
import { WorkflowDeadlineExtensionService } from '../../src/modules/workflow/workflow-deadline-extension.service.js';
import type { WorkflowDeadlineExtension, WorkflowDeadlineStage } from '../../src/modules/workflow/workflow-deadline-extension.types.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { completeDocument, domainFixture, type DomainFixture, type DomainName } from './internal-eight-d-domains.fixture.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) {
  throw new Error('Domain reminder evidence requires leased disposable loopback PostgreSQL, never preview 55440.');
}

describe('customer and new-product extension events through the real application dispatcher', () => {
  let app: INestApplication, prisma: PrismaService, handler: AtomicOutboxHandler, extensions: WorkflowDeadlineExtensionService;
  const fixtures = new Map<DomainName, { f: DomainFixture; id: string }>();
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    handler = app.get<AtomicOutboxHandler>(APPLICATION_OUTBOX_HANDLER);
    extensions = app.get(WorkflowDeadlineExtensionService);
  });
  afterAll(async () => { await app?.close(); });

  async function request(f: DomainFixture, id: string, stage: WorkflowDeadlineStage = 'ANALYSIS') {
    const current = await f.read(id);
    expect(current.status).toBe('PROCESSING');
    return extensions.request(f.owner.actor, id, { expectedRowVersion: current.version, expectedInstanceVersion: current.instanceVersion,
      stage, requestedDueAt: '2027-01-15T00:00:00.000Z', reason: 'Actual domain extension event evidence' }, randomUUID(), randomUUID());
  }
  // Each real fixture/issue setup keeps the normal five-second hook limit.
  for (const domain of ['customer-quality', 'new-product-quality'] as const) {
    let f: DomainFixture, id: string;
    beforeAll(async () => { f = await domainFixture(app, domain); });
    beforeAll(async () => { id = await f.issue([f.chainSource]); });
    beforeAll(() => { fixtures.set(domain, { f, id }); });
  }

  const event = (r: WorkflowDeadlineExtension) => prisma.outboxEvent.findUniqueOrThrow({ where: { eventKey: `deadline:${r.id}:${r.version}` } });
  async function deliver(r: WorkflowDeadlineExtension) {
    const target = await event(r);
    // Restrict claiming to the relevant event family, retaining the real APP_HANDLER dispatch order.
    const selected: AtomicOutboxHandler = { eventTypes: ['WORKFLOW_DEADLINE_EXTENSION_CHANGED'], handle: handler.handle.bind(handler) };
    for (let cycle = 0; cycle < 20; cycle++) {
      const actual = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: target.id } });
      if (actual.status === 'PROCESSED') break;
      expect(actual.status).toBe('PENDING');
      expect(actual.attempts).toBe(0);
      await app.get(OutboxWorkerService).processAtomicDue(10, selected);
    }
    expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id: target.id } }))
      .toMatchObject({ status: 'PROCESSED', attempts: 0, lastError: null });
    expect(await prisma.outboxDeliveryAttempt.findMany({ where: { outboxEventId: target.id } })).toMatchObject([{ outcome: 'PROCESSED' }]);
  }
  async function replay(r: WorkflowDeadlineExtension) {
    const saved = await event(r);
    await prisma.$transaction(tx => handler.handle(tx, { ...saved, processingAt: new Date() }));
    expect(await event(r)).toEqual(saved);
  }
  const notices = (id: string) => prisma.$queryRaw<Array<{ id: string; domain: string; organizationId: string; userId: string; eventKey: string; kind: string }>>`
    SELECT id, 'customer-quality' AS domain, organization_id AS "organizationId", recipient_user_id AS "userId", event_key AS "eventKey", kind
      FROM customer_eight_d_notifications WHERE problem_id = ${id}::uuid
    UNION ALL
    SELECT id, 'new-product-quality', organization_id, recipient_user_id, event_key, kind
      FROM new_product_eight_d_notifications WHERE problem_id = ${id}::uuid
    UNION ALL
    SELECT id, 'process-quality', organization_id, recipient_user_id, event_key, kind
      FROM process_eight_d_notifications WHERE problem_id = ${id}::uuid ORDER BY "eventKey", "userId"`;

  describe.each(['customer-quality', 'new-product-quality'] as const)('%s', domain => {
    let f: DomainFixture, id: string, original: WorkflowDeadlineExtension, cancelled: WorkflowDeadlineExtension, revoked: WorkflowDeadlineExtension;
    let sessions: { id: string; userId: string }[];
    let revokedPermissionId: string;
    const other = () => fixtures.get(domain === 'customer-quality' ? 'new-product-quality' : 'customer-quality')!.f;
    beforeAll(async () => {
      ({ f, id } = fixtures.get(domain)!);
      sessions = await prisma.session.findMany({ where: { userId: { in: [f.owner.user.id, f.manager.user.id, f.professional.user.id, f.minister.user.id] } },
        select: { id: true, userId: true }, orderBy: { id: 'asc' } });
      expect(sessions).toHaveLength(4);
    });
    beforeAll(async () => { original = await request(f, id); });
    async function assertRecipients(r: WorkflowDeadlineExtension, kind: string, users: string[]) {
      const rows = (await notices(id)).filter(row => row.eventKey === `deadline:${r.id}:${r.version}`);
      expect(rows.map(row => row.userId).sort()).toEqual([...users].sort());
      for (const row of rows) expect(row).toMatchObject({ domain, organizationId: f.org.id, kind });
    }

    it('makes non-owning handlers defer the actual request without cancelling it', async () => {
      expect(original).toMatchObject({ status: 'LEADER_PENDING', stage: 'ANALYSIS', applicantUserId: f.owner.user.id,
        participants: { leader: { userId: f.manager.user.id }, professional: { userId: f.professional.user.id } } });
      const saved = await event(original), before = await extensions.history(f.owner.actor, id);
      expect(saved).toMatchObject({ eventType: 'WORKFLOW_DEADLINE_EXTENSION_CHANGED', status: 'PENDING' });
      for (const nonOwner of [app.get(ProcessEightDReminderService), other().runtime.reminders]) {
        await prisma.$transaction(async tx => expect(await nonOwner.handle(tx, { ...saved, processingAt: new Date() })).toBe('deferred'));
      }
      expect(await extensions.history(f.owner.actor, id)).toEqual(before);
      expect(await notices(id)).toEqual([]);
    });

    it('consumes the exact request event and writes only the actual domain manager notice', async () => {
      await deliver(original);
      await assertRecipients(original, 'EXTENSION_PENDING', [f.manager.user.id]);
      expect(await notices(id)).toHaveLength(1);
    });

    it('projects the owner handling task and actual manager extension duty', async () => {
      expect(await f.runtime.tasks.list(f.owner.actor, { problemId: id })).toMatchObject({ items: [expect.objectContaining({ kind: 'HANDLING', stage: 'ANALYSIS' })] });
      expect(await f.runtime.tasks.list(f.manager.actor, { problemId: id })).toMatchObject({ total: 1,
        items: [{ kind: 'EXTENSION', extensionRequestId: original.id, extensionRequestVersion: 1 }] });
    });

    it('projects the actual manager notice', async () => {
      expect(await f.runtime.tasks.notifications(f.manager.actor, { problemId: id })).toMatchObject({ total: 1, items: [{ problemId: id, kind: 'EXTENSION_PENDING' }] });
    });

    it.each(['owner', 'professional', 'minister'] as const)('does not project the manager notice to %s', async person => {
      expect(await f.runtime.tasks.notifications(f[person].actor, { problemId: id })).toEqual({ items: [], total: 0 });
    });

    it('does not project notices to another organization or domain', async () => {
      expect(await f.runtime.tasks.notifications(other().manager.actor, { problemId: id })).toEqual({ items: [], total: 0 });
      expect(await other().runtime.tasks.notifications(f.manager.actor, { problemId: id })).toEqual({ items: [], total: 0 });
    });

    it('does not project the task through another domain', async () => {
      expect(await other().runtime.tasks.list(f.manager.actor, { problemId: id })).toEqual({ items: [], total: 0 });
    });

    it.each([1, 2])('replays the real application handler idempotently without resetting the processed event (replay %i)', async () => {
      const before = await notices(id);
      await replay(original);
      expect(await notices(id)).toEqual(before);
    });

    it('saves the analysis needed for normal stage completion', async () => {
      const current = await f.read(id);
      await f.service.save(f.owner.actor, id, { expectedVersion: current.version, document: completeDocument(domain) }, randomUUID(), randomUUID());
    });

    it('completes actual analysis then replays the obsolete request without a new pending notice', async () => {
      const current = await f.read(id);
      await f.service.analysisComplete(f.owner.actor, id, { expectedVersion: current.version, submissionDueAt: new Date('2026-11-10T00:00:00Z') }, randomUUID(), randomUUID());
      await replay(original);
      cancelled = (await extensions.history(f.owner.actor, id)).find(r => r.id === original.id)!;
      expect(cancelled).toMatchObject({ status: 'CANCELLED', version: original.version + 1 });
      expect(await notices(id)).toHaveLength(1);
    });

    it('delivers cancellation only to the real owner', async () => {
      await deliver(cancelled);
      await assertRecipients(cancelled, 'EXTENSION_CANCELLED', [f.owner.user.id]);
      expect(await notices(id)).toHaveLength(2);
    });

    it.each(['original', 'cancelled'] as const)('keeps %s replay idempotent after cancellation', async which => {
      const before = await notices(id);
      await replay(which === 'original' ? original : cancelled);
      await expect(extensions.decide(f.manager.actor, original.id, { expectedVersion: original.version, decision: 'APPROVE' }, randomUUID(), randomUUID()))
        .rejects.toMatchObject({ status: 403 });
      expect(await notices(id)).toEqual(before);
    });

    it('projects the cancellation only to the owner, not the old pending manager', async () => {
      expect(await f.runtime.tasks.notifications(f.owner.actor, { problemId: id })).toMatchObject({ total: 1, items: [{ kind: 'EXTENSION_CANCELLED' }] });
      expect(await f.runtime.tasks.notifications(f.manager.actor, { problemId: id })).toEqual({ items: [], total: 0 });
    });

    it('creates a real submission request then withdraws notification permission before consumption', async () => {
      revoked = await request(f, id, 'SUBMISSION');
      const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'notification:read' } });
      await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: f.role.id, permissionId: permission.id } } });
      revokedPermissionId = permission.id;
    });

    it('consumes and replays the denied event without new notices or synthesized sessions', async () => {
      try {
        const before = await notices(id);
        await deliver(revoked); await replay(revoked);
        expect(await notices(id)).toEqual(before);
        await assertRecipients(revoked, 'EXTENSION_PENDING', []);
        await expect(f.runtime.tasks.notifications(f.manager.actor, { problemId: id })).rejects.toMatchObject({ status: 403 });
        expect(await prisma.session.findMany({ where: { userId: { in: sessions.map(session => session.userId) } },
          select: { id: true, userId: true }, orderBy: { id: 'asc' } })).toEqual(sessions);
        if (process.env.QMS_DOMAIN_REMINDER_EVIDENCE_DIR) {
          await writeFile(join(process.env.QMS_DOMAIN_REMINDER_EVIDENCE_DIR, `${domain}.json`), JSON.stringify({ domain, organizationId: f.org.id, problemId: id,
            recipients: { owner: f.owner.user.id, manager: f.manager.user.id, professional: f.professional.user.id }, notifications: await notices(id),
            events: await Promise.all([original, cancelled, revoked].map(event)), sessions }, null, 2));
        }
      } finally {
        await prisma.rolePermission.create({ data: { roleId: f.role.id, permissionId: revokedPermissionId } });
      }
    });
  });
});
