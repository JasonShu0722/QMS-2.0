import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AdminMutationService, assertAdminAccess, type AdminActor } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { OrganizationService } from '../../src/modules/organization/organization.service.js';
import { PositionOnboardingService } from '../../src/modules/organization/position-onboarding.service.js';
import { ComponentProjectService } from '../../src/modules/platform-configuration/component-project.service.js';
import { CustomerComplaintLedgerService } from '../../src/modules/customer-quality/customer-complaint-ledger.service.js';
import { LEDGER_PERMISSIONS } from '../../src/modules/customer-quality/customer-complaint-ledger.types.js';
import { DomainSourceLinkService } from '../../src/modules/problem-index/domain-source-link.service.js';
import type { DomainSourceReference } from '../../src/modules/problem-index/domain-source-issue.service.js';
import { OutboxService } from '../../src/modules/task-notification/outbox.service.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) {
  throw new Error('Customer 8D sources require an explicitly leased disposable loopback PostgreSQL database, never preview 55440');
}

describe('customer ledger public 8D source ports on real PostgreSQL', () => {
  const prisma = new PrismaService(process.env.DATABASE_URL);
  const audit = new AuditLogService(prisma);
  const mutations = new AdminMutationService(prisma, audit);
  const organizations = new OrganizationService(prisma, mutations, audit, new PositionOnboardingService(prisma, audit));
  const components = new ComponentProjectService(prisma, mutations, audit, organizations);
  const ledger = new CustomerComplaintLedgerService(prisma, mutations, audit, components, organizations);
  const links = new DomainSourceLinkService(prisma, audit, new OutboxService(prisma));
  const organizationId = randomUUID();
  const issue = 'customer-quality:issues:issue'; const sources = 'customer-quality:issues:sources';
  let registrar: AdminActor; let issuer: AdminActor; let engineer: AdminActor;
  let assignmentId: string; let departmentId: string;

  async function person(permissions: string[], org: string = organizationId, accountType: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    const id = randomUUID(); const sessionId = randomUUID(); const roleId = randomUUID();
    await prisma.user.create({ data: { id, organizationId: org, username: `source-${id}`, accountType, passwordHash: 'fixture-not-login' } });
    await prisma.session.create({ data: { id: sessionId, userId: id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000), reauthenticatedAt: new Date(), mfaVerifiedAt: new Date() } });
    await prisma.role.create({ data: { id: roleId, organizationId: org, code: `source-${roleId}`, name: 'Not an authorization display name' } });
    for (const code of permissions) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId: id, organizationId: org, roleId } });
    return { id, sessionId, organizationId: org, accountType } satisfies AdminActor;
  }
  const make = (fields: object = {}, customerId?: string) => ledger.create(registrar,
    { fields: { complaintType: 'AFTER_SALES', ...fields }, ...(customerId ? { customerId } : {}) }, randomUUID(), randomUUID());
  const resolve = (reference: DomainSourceReference, actor = issuer) => prisma.$transaction(
    tx => ledger.lockAndResolve(tx, reference, actor), { isolationLevel: 'ReadCommitted' });

  async function addSources(references: DomainSourceReference[], actor = issuer) {
    const base = await ledger.sourceReference(actor, (await make()).id);
    const problem = await prisma.problemIndex.create({ data: { organizationId, reportNumber: `CS-${randomUUID()}`,
      domainCode: base.sourceDomain, problemType: 'CUSTOMER_COMPLAINT', sourceType: base.sourceType, sourceId: base.sourceId,
      severity: 'HIGH', responsibleParty: 'INTERNAL', createdById: actor.id } });
    await prisma.domainSourceIssueLink.create({ data: { organizationId, problemIndexId: problem.id, ...base } });
    return links.change({ organizationId, problemIndexId: problem.id, actor, expectedProblemVersion: problem.version,
      add: references, remove: [], idempotencyKey: randomUUID(), traceId: randomUUID() }, {
      authorize: tx => assertAdminAccess(tx, actor, organizationId, [LEDGER_PERMISSIONS.read, sources]).then(() => {}),
      lockAndResolve: (tx, source) => ledger.lockAndResolve(tx, source, actor),
    });
  }

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.organization.create({ data: { id: organizationId, code: `CS-${organizationId}`, name: 'Customer source fixture', type: 'INTERNAL' } });
    registrar = await person([LEDGER_PERMISSIONS.read, LEDGER_PERMISSIONS.write, 'component-project:manage']);
    issuer = await person([LEDGER_PERMISSIONS.read, issue, sources]);
    engineer = await person([LEDGER_PERMISSIONS.read, LEDGER_PERMISSIONS.write, LEDGER_PERMISSIONS.project]);
    const department = await prisma.department.create({ data: { organizationId, code: 'sources', name: 'Source quality' } });
    departmentId = department.id;
    const position = await prisma.position.create({ data: { organizationId, departmentId, code: 'source-qe', name: 'Engineer fixture' } });
    assignmentId = (await prisma.userPosition.create({ data: { organizationId, userId: engineer.id, positionId: position.id, startedAt: new Date('2026-01-01') } })).id;
  }, 60000);
  afterAll(async () => prisma.$disconnect());

  it('allows unparsed unresolved and unknown-risk facts without source QE authority or invented dates', async () => {
    const row = await make({ customerName: ' Unresolved customer ', quantity: 'bad', occurredOn: '2026-02-30' });
    await prisma.customerQualityComplaint.update({ where: { id: row.id }, data: { physicalAnalysisRequired: true } });
    const before = await prisma.customerQualityComplaint.findUniqueOrThrow({ where: { id: row.id } });
    const reference = await ledger.sourceReference(issuer, row.id);
    expect(reference).toMatchObject({ sourceDomain: 'customer-quality', sourceType: 'customer-complaint', sourceId: row.id,
      sourceVersion: before.version, createdBy: registrar.id, sourceSnapshot: { sourceKind: 'CUSTOMER_COMPLAINT',
        complaintType: 'AFTER_SALES', customerId: null, customerName: 'Unresolved customer', quantity: null, occurredAt: null,
        raw: { quantity: 'bad', occurredOn: '2026-02-30' }, normalized: { quantity: null }, analyses: { fae: null, supplier: null } } });
    expect((await resolve(reference))?.sourceSnapshot).toEqual(reference.sourceSnapshot);
    expect(await prisma.customerQualityComplaint.findUniqueOrThrow({ where: { id: row.id } })).toEqual(before);
    expect(reference.sourceSnapshot).not.toHaveProperty('warnings');
  });

  it('keeps MASS/NEW complaints for one customer distinct and does not require matching source severity', async () => {
    const customer = await prisma.customerQualityCustomer.create({ data: { organizationId, code: randomUUID(), name: 'One saved customer', createdById: registrar.id, updatedById: registrar.id } });
    const references: DomainSourceReference[] = [];
    for (const stage of ['MASS_PRODUCTION', 'NEW_PRODUCT'] as const) {
      const componentCode = randomUUID();
      const project = await components.createProject(registrar, organizationId, { code: componentCode, name: stage, stage }, randomUUID(), randomUUID());
      await components.createMapping(registrar, organizationId, { componentCode, projectRecordId: project.id, productCategory: 'controller' }, randomUUID(), randomUUID());
      const row = await make({ componentCode, quantity: 2, occurredOn: '2026-10-20' }, customer.id);
      await prisma.customerQualityComplaint.update({ where: { id: row.id }, data: { severity: stage === 'NEW_PRODUCT' ? 'LOW' : 'MEDIUM' } });
      const reference = await ledger.sourceReference(issuer, row.id); references.push(reference);
      expect(reference.sourceSnapshot).toMatchObject({ customerId: customer.id, customerName: customer.name, stage,
        sourceKind: 'CUSTOMER_COMPLAINT', complaintType: 'AFTER_SALES', occurredAt: '2026-10-20T00:00:00.000Z', quantity: 2 });
    }
    expect(references[0]!.sourceId).not.toBe(references[1]!.sourceId);
    const problem = await addSources(references);
    expect(await prisma.domainSourceIssueLink.count({ where: { problemIndexId: String(problem.id), removedAt: null } })).toBe(3);
  });

  it('snapshots independent saved FAE/SQE facts, without interpreting file IDs as disclosure or analysis completion', async () => {
    const row = await make(); const fileId = randomUUID();
    for (const section of ['FAE', 'SUPPLIER']) {
      const content = section === 'FAE' ? { text: null, failedPart: 'saved part', fileIds: [fileId] } : { progress: 'supplier saved progress', result: 'supplier saved result', fileIds: [] };
      await prisma.$executeRaw`INSERT INTO customer_complaint_analyses
        (id,organization_id,complaint_id,section,assignee_user_id,assignee_assignment_id,department_id,content,version,updated_by_user_id)
        VALUES (${randomUUID()}::uuid,${organizationId}::uuid,${row.id}::uuid,${section},${engineer.id}::uuid,${assignmentId}::uuid,${departmentId}::uuid,${JSON.stringify(content)}::jsonb,2,${engineer.id}::uuid)`;
    }
    const reference = await ledger.sourceReference(issuer, row.id);
    expect(reference.sourceSnapshot).toMatchObject({ analyses: { fae: { version: 2, section: 'FAE', content: { text: null, fileIds: [fileId] } },
      supplier: { version: 2, section: 'SUPPLIER', content: { progress: 'supplier saved progress', result: 'supplier saved result' } } } });
    expect(JSON.stringify(reference.sourceSnapshot)).not.toMatch(/downloadable|externalVisible|faeStatus|canDispatch/);
    expect((await resolve(reference))?.sourceSnapshot).toEqual(reference.sourceSnapshot);
  });

  it('never reconciles empty engineers or changes source version when mappings or saved assignee eligibility drift', async () => {
    const componentCode = randomUUID(); const row = await make({ componentCode });
    const reference = await ledger.sourceReference(issuer, row.id);
    const before = await prisma.customerQualityComplaint.findUniqueOrThrow({ where: { id: row.id } });
    const events = await prisma.customerQualityComplaintEvent.count({ where: { complaintId: row.id } });
    const project = await components.createProject(registrar, organizationId, { code: componentCode, name: 'Late mapping', stage: 'NEW_PRODUCT', projectEngineerAssignmentId: assignmentId }, randomUUID(), randomUUID());
    await components.createMapping(registrar, organizationId, { componentCode, projectRecordId: project.id, productCategory: 'controller' }, randomUUID(), randomUUID());
    expect(await ledger.sourceReference(issuer, row.id)).toEqual(reference);
    expect((await resolve(reference))?.sourceSnapshot).toEqual(reference.sourceSnapshot);
    await prisma.userPosition.update({ where: { id: assignmentId }, data: { endedAt: new Date(Date.now() - 1000) } });
    try { expect((await resolve(reference))?.sourceSnapshot).toEqual(reference.sourceSnapshot); }
    finally { await prisma.userPosition.update({ where: { id: assignmentId }, data: { endedAt: null } }); }
    expect(await prisma.customerQualityComplaint.findUniqueOrThrow({ where: { id: row.id } })).toEqual(before);
    expect(await prisma.customerQualityComplaintEvent.count({ where: { complaintId: row.id } })).toBe(events);
  });

  it('requires current source permission plus caller read, not owner/work, and rechecks identity and permission drift', async () => {
    const row = await make(); const reference = await ledger.sourceReference(issuer, row.id);
    for (const permissions of [[LEDGER_PERMISSIONS.read], [issue], [LEDGER_PERMISSIONS.read, LEDGER_PERMISSIONS.write, 'customer-quality:issues:owner', 'customer-quality:issues:work']]) {
      const actor = await person(permissions);
      await expect(ledger.sourceReference(actor, row.id)).rejects.toMatchObject({ status: 403 });
      await expect(resolve(reference, actor)).rejects.toMatchObject({ status: 403 });
    }
    for (const permission of [issue, sources]) {
      const actor = await person([LEDGER_PERMISSIONS.read, permission]);
      expect(await ledger.sourceReference(actor, row.id)).toEqual(reference);
      await expect(resolve(reference, actor)).resolves.toMatchObject({ sourceVersion: reference.sourceVersion });
      await expect(ledger.update(actor, row.id, { expectedVersion: row.version, fields: { quantity: 99 } }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
      await prisma.userRole.deleteMany({ where: { userId: actor.id } });
      await expect(resolve(reference, actor)).rejects.toMatchObject({ status: 403 });
    }
    await expect(resolve(reference, { ...issuer, sessionId: randomUUID() })).rejects.toMatchObject({ status: 401 });
    const expired = await person([LEDGER_PERMISSIONS.read, issue]);
    await prisma.session.update({ where: { id: expired.sessionId }, data: { expiresAt: new Date(0) } });
    await expect(ledger.sourceReference(expired, row.id)).rejects.toMatchObject({ status: 401 });
    const platform = await person(['platform:admin', LEDGER_PERMISSIONS.read, issue]);
    expect(await ledger.sourceReference(platform, row.id)).toEqual(reference);
    expect((await resolve(reference, platform))?.createdBy).toBe(registrar.id);
    await expect(resolve(reference, { ...platform, id: registrar.id })).rejects.toMatchObject({ status: 401 });
  });

  it('rejects cross-scope, suppliers and archived new references but keeps original legacy history readable', async () => {
    const row = await make(); const reference = await ledger.sourceReference(issuer, row.id);
    const outside = await prisma.organization.create({ data: { code: randomUUID(), name: 'Outside', type: 'INTERNAL' } });
    const outsider = await person([LEDGER_PERMISSIONS.read, issue], outside.id);
    await expect(ledger.sourceReference(outsider, row.id)).rejects.toMatchObject({ status: 404 });
    await expect(resolve(reference, outsider)).resolves.toBeNull();
    await expect(ledger.sourceReference({ ...issuer, scopeOrganizationId: outside.id }, row.id)).rejects.toMatchObject({ status: 403 });
    const supplierOrg = await prisma.organization.create({ data: { code: randomUUID(), name: 'Supplier', type: 'SUPPLIER' } });
    const supplier = await person([LEDGER_PERMISSIONS.read, issue], supplierOrg.id, 'SUPPLIER');
    await expect(ledger.sourceReference(supplier, row.id)).rejects.toMatchObject({ status: 403 });
    await expect(resolve(reference, supplier)).rejects.toMatchObject({ status: 403 });
    await prisma.customerQualityComplaint.update({ where: { id: row.id }, data: { archivedAt: new Date() } });
    await expect(ledger.sourceReference(issuer, row.id)).rejects.toMatchObject({ status: 409 });
    await expect(resolve(reference)).rejects.toMatchObject({ status: 409 });
    const legacy = await prisma.customerQualityComplaint.create({ data: { organizationId, complaintNumber: `OLD-${randomUUID()}`, complaintType: 'ZERO_KM',
      defectDescription: 'Original fact', status: 'ARCHIVED', createdById: registrar.id, updatedById: registrar.id } });
    const reader = await person([LEDGER_PERMISSIONS.read]);
    expect(await ledger.detail(reader, legacy.id)).toMatchObject({ legacyStatus: 'ARCHIVED', normalized: { defectDescription: 'Original fact' } });
    await expect(ledger.sourceReference(issuer, legacy.id)).rejects.toMatchObject({ status: 409 });
  });

  it('lets shared source-link checks reject stale versions and forged facts, and rejects wrong domain/type', async () => {
    const reference = await ledger.sourceReference(issuer, (await make()).id);
    await expect(addSources([{ ...reference, sourceVersion: reference.sourceVersion + 1 }])).rejects.toMatchObject({ status: 409 });
    await expect(addSources([{ ...reference, createdBy: issuer.id }])).rejects.toMatchObject({ status: 409 });
    await expect(addSources([{ ...reference, sourceSnapshot: { ...reference.sourceSnapshot, quantity: 999 } }])).rejects.toMatchObject({ status: 409 });
    for (const bad of [{ sourceDomain: 'new-product-quality' }, { sourceType: 'process-defect' }]) {
      await expect(resolve({ ...reference, ...bad })).resolves.toBeNull();
    }
    await prisma.customerQualityComplaint.update({ where: { id: reference.sourceId }, data: { version: { increment: 1 } } });
    await expect(addSources([reference])).rejects.toMatchObject({ status: 409 });
  });

  it('holds exactly the requested source row lock inside the caller transaction', async () => {
    const first = await ledger.sourceReference(issuer, (await make()).id);
    const second = await ledger.sourceReference(issuer, (await make()).id);
    let locked!: () => void; let release!: () => void;
    const ready = new Promise<void>(resolve => { locked = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    const work = prisma.$transaction(async tx => {
      await ledger.lockAndResolve(tx, first, issuer); locked(); await released;
    }, { isolationLevel: 'ReadCommitted', timeout: 10000 });
    await Promise.race([ready, work]);
    try {
      await prisma.$transaction(tx => tx.$queryRaw`SELECT id FROM customer_quality_complaints WHERE id = ${second.sourceId}::uuid FOR UPDATE NOWAIT`);
      await expect(prisma.$transaction(tx => tx.$queryRaw`SELECT id FROM customer_quality_complaints WHERE id = ${first.sourceId}::uuid FOR UPDATE NOWAIT`))
        .rejects.toThrow('could not obtain lock on row in relation "customer_quality_complaints"');
    } finally { release(); await work; }
  });
});
