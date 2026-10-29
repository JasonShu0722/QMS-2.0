import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { ProcessEightDService } from '../../src/modules/process-quality/process-eight-d.service.js';
import { AdminUserLifecycleService } from '../../src/modules/identity/admin-user-lifecycle.service.js';
import { OrganizationForceDeleteService } from '../../src/modules/organization/organization-force-delete.service.js';
import { WorkflowClosureRoundService } from '../../src/modules/workflow/workflow-closure-round.service.js';
import { WorkflowClosureTemplateService } from '../../src/modules/workflow/workflow-closure-template.service.js';
import { WorkflowDefinitionService } from '../../src/modules/workflow/workflow-definition.service.js';
import { INTERNAL_EIGHT_D_DOMAINS, internalEightDSql } from '../../src/common/eight-d/internal-eight-d-domain.js';
import { createWorkflowClosureFixture } from '../workflow/workflow-closure-round.fixture.js';
import { completeDocument, domainFixture } from './internal-eight-d-domains.fixture.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) {
  throw new Error('Internal administrative recovery requires disposable loopback PostgreSQL, never preview 55440.');
}

type Command = { expectedVersion: number; professionalAssignmentId?: string; ownerAssignmentId?: string };

describe('internal three-domain administrative recovery / actual App and PostgreSQL', () => {
  let app: INestApplication, db: PrismaService, admin: Awaited<ReturnType<typeof createWorkflowClosureFixture>>;
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    await app.init(); db = app.get(PrismaService);
    expect(await db.$queryRaw`SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261028232000_administrative_configuration_links'
      AND finished_at IS NOT NULL AND rolled_back_at IS NULL`).toHaveLength(1);
    admin = await createWorkflowClosureFixture(db, app.get(WorkflowClosureRoundService));
    await db.rolePermission.create({ data: { roleId: admin.role.id,
      permissionId: (await db.permission.findUniqueOrThrow({ where: { code: 'platform:admin' } })).id } });
    await db.session.update({ where: { id: admin.owner.actor.sessionId }, data: { reauthenticatedAt: new Date() } });
  }, 120_000);
  afterAll(() => app?.close());

  async function fixture(domain: typeof INTERNAL_EIGHT_D_DOMAINS[keyof typeof INTERNAL_EIGHT_D_DOMAINS]) {
    const f = await domainFixture(app, domain === INTERNAL_EIGHT_D_DOMAINS.CUSTOMER ? 'customer-quality' : 'new-product-quality');
    let core = f.runtime.core;
    let id: string;
    if (domain === INTERNAL_EIGHT_D_DOMAINS.PROCESS) {
      const codes = ['read', 'work', 'issue'].map(action => `${domain.permissionPrefix}:${action}`);
      await db.rolePermission.createMany({ data: (await db.permission.findMany({ where: { code: { in: codes } } })).map(p => ({ roleId: f.role.id, permissionId: p.id })) });
      core = app.get(ProcessEightDService);
      const template = await app.get(WorkflowClosureTemplateService).initialize(f.professional.actor,
        { policy: 'INTERNAL', domainCode: domain.domainCode, code: randomUUID(), name: 'Recovery process chain' }, randomUUID(), randomUUID());
      const published = await app.get(WorkflowDefinitionService).publishVersion({ organizationId: f.org.id, userId: f.professional.user.id,
        actor: f.professional.actor, definitionId: template.id, expectedRevision: template.revision, draftVersionId: template.version.id });
      await core.bind(f.professional.actor, { expectedVersion: 0, workflowDefinitionId: template.id, workflowVersionId: published.id }, randomUUID(), randomUUID());
      await core.activate(f.professional.actor, { expectedVersion: 1, enabled: true }, randomUUID(), randomUUID());
      const source = await f.process.create(f.manager.actor, { description: 'Original actual process fact', productCode: f.productCode }, randomUUID(), randomUUID());
      id = String((await core.issue(f.professional.actor, { sources: [{ defectId: source.id, expectedVersion: source.version }], severity: 'LOW',
        ownerUserId: f.owner.user.id, responsibleSectionDepartmentId: f.section.id }, randomUUID(), randomUUID())).problem.id);
    } else id = await f.issue([f.chainSource]);
    const recovery = core, tables = internalEightDSql(domain);
    const newProfessional = await f.person(f.dept.id), newOwner = await f.person(f.section.id);
    await db.session.update({ where: { id: newOwner.actor.sessionId }, data: { reauthenticatedAt: new Date() } });
    const pending = (actor = admin.owner.actor) => db.$transaction(async tx => {
      const items = [];
      let offset: number | null = 0;
      while (offset !== null) {
        const page = await recovery.administrativePending(tx, actor, { pageSize: 100, offset });
        items.push(...page.items); offset = page.nextOffset;
      }
      return { items };
    }, { timeout: 30_000 });
    const configure = (input: Command, actor = admin.owner.actor) => db.$transaction(tx => recovery.administrativeReconfigure(tx, actor, id, input, randomUUID()), { timeout: 30_000 });
    const remove = async (userId: string) => {
      const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
      await app.get(AdminUserLifecycleService).deleteUser(admin.owner.actor, userId, { expectedSecurityVersion: user.securityVersion }, f.org.id, randomUUID(), randomUUID());
    };
    const row = async () => (await db.$queryRaw<{ version: number; contentVersion: number; professionalUserId: string }[]>`SELECT version, content_version AS "contentVersion",
      professional_user_id AS "professionalUserId" FROM ${tables.reports} WHERE problem_id=${id}::uuid`)[0]!;
    return { ...f, core, recovery, tables, id, newProfessional, newOwner, pending, configure, remove, row };
  }

  it.each(Object.values(INTERNAL_EIGHT_D_DOMAINS))('$domainCode replaces deleted current references, resubmits with real new duties and preserves history', async domain => {
    const f = await fixture(domain);
    let current = await f.core.read(f.owner.actor, f.id);
    current = await f.core.save(f.owner.actor, f.id, { expectedVersion: current.version, document: completeDocument('customer-quality') }, randomUUID(), randomUUID());
    current = await f.core.analysisComplete(f.owner.actor, f.id, { expectedVersion: current.version, submissionDueAt: new Date('2026-11-10T00:00:00Z') }, randomUUID(), randomUUID());
    await f.core.submit(f.owner.actor, f.id, { expectedVersion: current.version }, randomUUID(), randomUUID());
    let oldRound = (await f.rounds.readProjection(db, f.org.id, f.id))!;
    oldRound = await f.rounds.decide(f.professional.actor, oldRound.id, { expectedRoundVersion: oldRound.version, duties: ['PROFESSIONAL'],
      decision: 'APPROVE', comment: 'Original actual signed opinion' }, randomUUID(), randomUUID());
    const approved = await db.$queryRaw`SELECT * FROM workflow_closure_duties WHERE round_id=${oldRound.id}::uuid AND status='APPROVED'`;
    const signatureId = randomUUID(), fingerprint = createHash('sha256').update(signatureId).digest('hex');
    await db.$executeRaw`INSERT INTO user_signatures(id,organization_id,user_id,label,fingerprint)
      VALUES (${signatureId}::uuid,${f.org.id}::uuid,${f.professional.user.id}::uuid,'Historical signature',${fingerprint})`;
    await db.$executeRaw`INSERT INTO approval_signatures(id,organization_id,signature_id,signer_user_id,resource_type,resource_id,resource_version,signature_fingerprint,signed_digest)
      VALUES (${randomUUID()}::uuid,${f.org.id}::uuid,${signatureId}::uuid,${f.professional.user.id}::uuid,'EIGHT_D_REPORT',${f.id},1,${fingerprint},${fingerprint})`;
    const signatures = await db.$queryRaw`SELECT * FROM approval_signatures WHERE signature_id=${signatureId}::uuid`;
    const revisions = await db.$queryRaw`SELECT * FROM ${f.tables.revisions} WHERE problem_id=${f.id}::uuid`;
    const links = await db.domainSourceIssueLink.findMany({ where: { problemIndexId: f.id } });
    await f.remove(f.professional.user.id); await f.remove(f.owner.user.id);
    expect((await f.rounds.readProjection(db, f.org.id, f.id))?.status).toBe('CANCELLED');
    const before = await f.row();
    expect((await f.pending()).items).toEqual(expect.arrayContaining([expect.objectContaining({ problemId: f.id, version: before.version,
      requiredConfiguration: expect.arrayContaining(['professionalAssignmentId', 'ownerAssignmentId']) })]));
    await expect(f.configure({ expectedVersion: before.version - 1, professionalAssignmentId: f.newProfessional.assignment.id,
      ownerAssignmentId: f.newOwner.assignment.id })).rejects.toMatchObject({ status: 409 });
    expect(await f.row()).toEqual(before);
    const result = await f.configure({ expectedVersion: before.version, professionalAssignmentId: f.newProfessional.assignment.id, ownerAssignmentId: f.newOwner.assignment.id });
    expect(result).toMatchObject({ version: before.version + 1, professionalUserId: f.newProfessional.user.id, ownerUserId: f.newOwner.user.id });
    expect(result).not.toHaveProperty('document'); expect(result).not.toHaveProperty('sources');
    expect((await f.pending()).items.some(item => item.problemId === f.id)).toBe(false);
    expect((await f.row()).contentVersion).toBe(before.contentVersion);
    expect(await db.problemIndex.findUniqueOrThrow({ where: { id: f.id } })).toMatchObject({ organizationId: f.org.id, ownerId: f.newOwner.user.id });
    current = await f.core.read(f.newOwner.actor, f.id);
    await f.core.submit(f.newOwner.actor, f.id, { expectedVersion: current.version }, randomUUID(), randomUUID());
    const newRound = (await f.rounds.readProjection(db, f.org.id, f.id))!;
    expect(newRound.id).not.toBe(oldRound.id);
    expect(newRound.duties).toEqual(expect.arrayContaining([
      expect.objectContaining({ duty: 'PROFESSIONAL', userId: f.newProfessional.user.id }),
      expect.objectContaining({ duty: 'SECTION_MANAGER', userId: f.manager.user.id }),
    ]));
    expect(await db.$queryRaw`SELECT * FROM workflow_closure_duties WHERE round_id=${oldRound.id}::uuid AND status='APPROVED'`).toEqual(approved);
    expect(await db.$queryRaw`SELECT * FROM approval_signatures WHERE signature_id=${signatureId}::uuid`).toEqual(signatures);
    expect(await db.$queryRaw`SELECT * FROM ${f.tables.revisions} WHERE problem_id=${f.id}::uuid`).toEqual(revisions);
    expect(await db.domainSourceIssueLink.findMany({ where: { problemIndexId: f.id } })).toEqual(links);
    expect(await db.auditEvent.count({ where: { resourceId: f.id, action: `${domain === INTERNAL_EIGHT_D_DOMAINS.PROCESS ? 'PROCESS' : domain === INTERNAL_EIGHT_D_DOMAINS.CUSTOMER ? 'CUSTOMER' : 'NEW_PRODUCT'}_EIGHT_D_ADMINISTRATIVELY_RECONFIGURED` } })).toBe(1);
  }, 60_000);

  it('denies ordinary admin, no recent auth, valid professional replacement and foreign/unqualified candidates', async () => {
    const f = await fixture(INTERNAL_EIGHT_D_DOMAINS.CUSTOMER);
    await db.rolePermission.create({ data: { roleId: f.role.id, permissionId: (await db.permission.findUniqueOrThrow({ where: { code: 'organization:reconfigure' } })).id } });
    await expect(f.pending(f.owner.actor)).rejects.toMatchObject({ status: 403 });
    await expect(f.configure({ expectedVersion: (await f.row()).version, professionalAssignmentId: f.newProfessional.assignment.id }, f.owner.actor))
      .rejects.toMatchObject({ status: 403 });
    await expect(f.configure({ expectedVersion: (await f.row()).version, professionalAssignmentId: f.newProfessional.assignment.id })).rejects.toMatchObject({ status: 409 });
    await f.remove(f.professional.user.id);
    await expect(f.configure({ expectedVersion: (await f.row()).version, professionalAssignmentId: admin.professional.assignment.id })).rejects.toMatchObject({ status: 400 });
    await db.userRole.deleteMany({ where: { userId: f.newProfessional.user.id } });
    await expect(f.configure({ expectedVersion: (await f.row()).version, professionalAssignmentId: f.newProfessional.assignment.id })).rejects.toMatchObject({ status: 400 });
    await db.session.update({ where: { id: admin.owner.actor.sessionId }, data: { reauthenticatedAt: null } });
    await expect(f.pending()).rejects.toMatchObject({ status: 403 });
    await db.session.update({ where: { id: admin.owner.actor.sessionId }, data: { reauthenticatedAt: new Date() } });
  }, 60_000);

  it('keeps a valid owner when only professional is invalid, and rolls back both report and audit on audit storage failure', async () => {
    const f = await fixture(INTERNAL_EIGHT_D_DOMAINS.CUSTOMER);
    await f.remove(f.professional.user.id);
    const before = await f.row(), problem = await db.problemIndex.findUniqueOrThrow({ where: { id: f.id } });
    await expect(db.$transaction(async tx => {
      // Transactional DDL disappears with the injected storage failure; no application mock or persistent trigger.
      await tx.$executeRawUnsafe(`CREATE FUNCTION pg_temp.reject_internal_reconfiguration_audit() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.action = 'CUSTOMER_EIGHT_D_ADMINISTRATIVELY_RECONFIGURED' THEN RAISE EXCEPTION 'intentional audit storage failure'; END IF; RETURN NEW; END $$`);
      await tx.$executeRawUnsafe('CREATE TRIGGER test_internal_reconfiguration_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_internal_reconfiguration_audit()');
      return f.recovery.administrativeReconfigure(tx, admin.owner.actor, f.id,
        { expectedVersion: before.version, professionalAssignmentId: f.newProfessional.assignment.id }, randomUUID());
    }, { timeout: 30_000 })).rejects.toThrow('intentional audit storage failure');
    expect(await f.row()).toEqual(before);
    expect(await db.problemIndex.findUniqueOrThrow({ where: { id: f.id } })).toEqual(problem);
    expect(await db.auditEvent.count({ where: { resourceId: f.id, action: 'CUSTOMER_EIGHT_D_ADMINISTRATIVELY_RECONFIGURED' } })).toBe(0);
    expect(await f.configure({ expectedVersion: before.version, professionalAssignmentId: f.newProfessional.assignment.id }))
      .toMatchObject({ ownerUserId: f.owner.user.id, professionalUserId: f.newProfessional.user.id });
    expect(await db.problemIndex.findUniqueOrThrow({ where: { id: f.id } })).toEqual(problem);
  }, 60_000);

  it('never reopens an actually closed report or changes its immutable revision after deleting its old professional', async () => {
    const f = await fixture(INTERNAL_EIGHT_D_DOMAINS.CUSTOMER);
    let current = await f.core.read(f.owner.actor, f.id);
    current = await f.core.save(f.owner.actor, f.id, { expectedVersion: current.version, document: completeDocument('customer-quality') }, randomUUID(), randomUUID());
    current = await f.core.analysisComplete(f.owner.actor, f.id, { expectedVersion: current.version, submissionDueAt: new Date('2026-11-10T00:00:00Z') }, randomUUID(), randomUUID());
    await f.core.submit(f.owner.actor, f.id, { expectedVersion: current.version }, randomUUID(), randomUUID());
    let round = (await f.rounds.readProjection(db, f.org.id, f.id))!;
    round = await f.rounds.decide(f.professional.actor, round.id, { expectedRoundVersion: round.version,
      duties: ['PROFESSIONAL'], decision: 'APPROVE', comment: 'Actual original approval' }, randomUUID(), randomUUID());
    await f.rounds.decide(f.manager.actor, round.id, { expectedRoundVersion: round.version,
      duties: ['SECTION_MANAGER'], decision: 'APPROVE', comment: 'Actual original management approval' }, randomUUID(), randomUUID());
    const revisions = await db.$queryRaw`SELECT * FROM ${f.tables.revisions} WHERE problem_id=${f.id}::uuid`;
    expect(revisions).toHaveLength(1);
    const problem = await db.problemIndex.findUniqueOrThrow({ where: { id: f.id } });
    expect(problem.status).toBe('CLOSED');
    await f.remove(f.professional.user.id);
    expect((await f.pending()).items.some(item => item.problemId === f.id)).toBe(false);
    await expect(f.configure({ expectedVersion: (await f.row()).version, professionalAssignmentId: f.newProfessional.assignment.id }))
      .rejects.toMatchObject({ status: 409 });
    expect(await db.problemIndex.findUniqueOrThrow({ where: { id: f.id } })).toEqual(problem);
    expect(await db.$queryRaw`SELECT * FROM ${f.tables.revisions} WHERE problem_id=${f.id}::uuid`).toEqual(revisions);
  }, 60_000);

  it('does not infer an invalid old professional from missing business grants or an absent stored assignment baseline', async () => {
    const f = await fixture(INTERNAL_EIGHT_D_DOMAINS.CUSTOMER);
    await db.userRole.deleteMany({ where: { userId: f.professional.user.id } });
    expect((await f.pending()).items.some(item => item.problemId === f.id)).toBe(false);
    await expect(f.configure({ expectedVersion: (await f.row()).version, professionalAssignmentId: f.newProfessional.assignment.id }))
      .rejects.toMatchObject({ status: 409 });
  }, 60_000);

  it('repairs an actually invalid department from the new owner appointment, but never moves the original tenant', async () => {
    const f = await fixture(INTERNAL_EIGHT_D_DOMAINS.CUSTOMER), replacement = await f.person(f.dept.id);
    const lifecycle = app.get(OrganizationForceDeleteService);
    const preview = await lifecycle.previewDepartment(admin.owner.actor, f.org.id, f.section.id);
    await lifecycle.forceDeleteDepartment(admin.owner.actor, f.org.id, f.section.id,
      { expectedVersion: preview.version, confirmed: true, previewToken: preview.previewToken }, randomUUID(), randomUUID());
    const before = await f.row();
    expect((await f.pending()).items).toEqual(expect.arrayContaining([expect.objectContaining({ problemId: f.id,
      requiredConfiguration: ['ownerAssignmentId'] })]));
    expect(await f.configure({ expectedVersion: before.version, ownerAssignmentId: replacement.assignment.id }))
      .toMatchObject({ originalOrganizationId: f.org.id, responsibleSectionDepartmentId: f.dept.id,
        ownerUserId: replacement.user.id, professionalUserId: f.professional.user.id });
  }, 60_000);

  it('excludes an actually deleted original organization without relocating its reports', async () => {
    const f = await fixture(INTERNAL_EIGHT_D_DOMAINS.CUSTOMER);
    await db.organization.update({ where: { id: f.org.id }, data: { parentId: admin.org.id } });
    const before = await f.row(), problem = await db.problemIndex.findUniqueOrThrow({ where: { id: f.id } });
    const lifecycle = app.get(OrganizationForceDeleteService), preview = await lifecycle.previewOrganization(admin.owner.actor, f.org.id);
    await lifecycle.forceDeleteOrganization(admin.owner.actor, f.org.id,
      { expectedVersion: preview.version, confirmed: true, previewToken: preview.previewToken }, randomUUID(), randomUUID());
    expect((await f.pending()).items.some(item => item.problemId === f.id)).toBe(false);
    await expect(f.configure({ expectedVersion: before.version, professionalAssignmentId: f.newProfessional.assignment.id }))
      .rejects.toMatchObject({ status: 409 });
    expect(await f.row()).toEqual(before);
    expect(await db.problemIndex.findUniqueOrThrow({ where: { id: f.id } })).toEqual(problem);
  }, 60_000);

  it('requires the existing pending approval to be cancelled before configuration and serializes concurrent stale CAS', async () => {
    const f = await fixture(INTERNAL_EIGHT_D_DOMAINS.CUSTOMER);
    let current = await f.core.read(f.owner.actor, f.id);
    current = await f.core.save(f.owner.actor, f.id, { expectedVersion: current.version, document: completeDocument('customer-quality') }, randomUUID(), randomUUID());
    current = await f.core.analysisComplete(f.owner.actor, f.id, { expectedVersion: current.version, submissionDueAt: new Date('2026-11-10T00:00:00Z') }, randomUUID(), randomUUID());
    await f.core.submit(f.owner.actor, f.id, { expectedVersion: current.version }, randomUUID(), randomUUID());
    const round = await f.rounds.readProjection(db, f.org.id, f.id), before = await f.row();
    await expect(db.$transaction(async tx => {
      await tx.user.update({ where: { id: f.professional.user.id }, data: { status: 'DISABLED', configurationRequired: true } });
      return f.recovery.administrativeReconfigure(tx, admin.owner.actor, f.id,
        { expectedVersion: before.version, professionalAssignmentId: f.newProfessional.assignment.id });
    }, { timeout: 30_000 })).rejects.toMatchObject({ status: 409 });
    expect(await f.rounds.readProjection(db, f.org.id, f.id)).toEqual(round);
    expect(await f.row()).toEqual(before);
    await f.remove(f.professional.user.id);
    const command = { expectedVersion: (await f.row()).version, professionalAssignmentId: f.newProfessional.assignment.id };
    const results = await Promise.allSettled([f.configure(command), f.configure(command)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toEqual([expect.objectContaining({ reason: expect.objectContaining({ status: 409 }) })]);
    expect((await f.row()).version).toBe(command.expectedVersion + 1);
    expect(await db.auditEvent.count({ where: { resourceId: f.id, action: 'CUSTOMER_EIGHT_D_ADMINISTRATIVELY_RECONFIGURED' } })).toBe(1);
  }, 60_000);

  it('validates the server-port payload without relying on HTTP DTO validation or a caller-supplied actor scope', async () => {
    const f = await fixture(INTERNAL_EIGHT_D_DOMAINS.CUSTOMER);
    const pending = (query: unknown) => db.$transaction(tx => f.recovery.administrativePending(tx, admin.owner.actor, query as never));
    await expect(pending(null)).rejects.toMatchObject({ status: 400 });
    await expect(pending({ pageSize: 101, offset: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(pending({ pageSize: 1, offset: 0, userId: f.professional.user.id })).rejects.toMatchObject({ status: 400 });
    await expect(db.$transaction(tx => f.recovery.administrativeReconfigure(tx, admin.owner.actor, f.id, null as never)))
      .rejects.toMatchObject({ status: 400 });
    await expect(f.configure({ expectedVersion: (await f.row()).version, professionalAssignmentId: null as never }))
      .rejects.toMatchObject({ status: 400 });
    await expect(f.configure({ expectedVersion: (await f.row()).version, professionalAssignmentId: f.newProfessional.assignment.id },
      { ...admin.owner.actor, organizationId: f.org.id })).rejects.toMatchObject({ status: 403 });
  }, 60_000);
});
