import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { OrganizationForceDeleteService } from '../../src/modules/organization/organization-force-delete.service.js';
import { OrganizationResponsibilityService } from '../../src/modules/organization/organization-responsibility.service.js';
import { SupplierEightDService } from '../../src/modules/supplier-quality/supplier-eight-d.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { supplierEightDDocument, supplierEightDFixture } from './supplier-eight-d.fixture.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) {
  throw new Error('Owner lifecycle requires disposable loopback PostgreSQL, never preview 55440.');
}

describe('supplier portal after actual internal owner force deletion', () => {
  let app: INestApplication;
  let f: Awaited<ReturnType<typeof supplierEightDFixture>>;
  let current: { rowVersion: number; instanceVersion: number };
  let before: Awaited<ReturnType<typeof facts>>;
  let historicalId: string;
  let approvedRevisionId: string;
  let historyBefore: Awaited<ReturnType<typeof historicalFacts>>;
  let context: NonNullable<Awaited<ReturnType<SupplierEightDService['notificationContext']>>>;

  async function facts() {
    return {
      source: await f.db.supplierQualityProblem.findUniqueOrThrow({ where: { id: f.draft.id } }),
      draft: await f.db.supplierResponseDraft.findUnique({ where: { problemId: f.draft.id } }),
      control: await f.db.$queryRaw`SELECT * FROM supplier_eight_d_controls WHERE supplier_problem_id = ${f.draft.id}::uuid`,
    };
  }

  async function historicalFacts() {
    return {
      source: await f.db.supplierQualityProblem.findUniqueOrThrow({ where: { id: historicalId } }),
      control: await f.db.$queryRaw`SELECT * FROM supplier_eight_d_controls WHERE supplier_problem_id = ${historicalId}::uuid`,
      publications: await f.db.$queryRaw`SELECT * FROM supplier_eight_d_publications WHERE organization_id = ${f.f.org.id}::uuid ORDER BY id`,
      revisions: await f.db.supplierResponseRevision.findMany({ where: { problemId: historicalId }, orderBy: { id: 'asc' } }),
      origins: await f.db.$queryRaw`SELECT * FROM supplier_eight_d_submission_origins WHERE supplier_problem_id = ${historicalId}::uuid ORDER BY revision_id`,
      signatures: await f.db.$queryRaw`SELECT * FROM approval_signatures WHERE organization_id = ${f.f.org.id}::uuid AND resource_id = ${approvedRevisionId} ORDER BY id`,
      duties: await f.db.$queryRaw`SELECT d.* FROM workflow_closure_duties d JOIN workflow_closure_rounds r ON r.id = d.round_id WHERE r.supplier_response_revision_id = ${approvedRevisionId}::uuid ORDER BY d.id`,
    };
  }

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    f = await supplierEightDFixture(app);
    const home = await f.db.organization.create({ data: { code: randomUUID(), name: 'Surviving administrator home', type: 'INTERNAL' } });
    await f.db.organization.update({ where: { id: f.f.org.id }, data: { parentId: home.id } });
    const permissions = await f.db.permission.findMany({ where: { code: { in: ['platform:admin', 'organization:force-delete'] } } });
    expect(permissions).toHaveLength(2);
    const role = await f.db.role.create({ data: { organizationId: home.id, code: randomUUID(), name: 'Lifecycle administrator',
      permissions: { create: permissions.map(p => ({ permissionId: p.id })) } } });
    const admin = await f.db.user.create({ data: { organizationId: home.id, accountType: 'INTERNAL', username: randomUUID(), passwordHash: 'unused-test-session',
      userRoles: { create: { organizationId: home.id, roleId: role.id } } } });
    const sessions = app.get(SessionService);
    const token = await sessions.create(admin.id, f.db, { mfaVerified: true, reauthenticated: true });
    const session = (await sessions.resolve(token))!;
    const actor = { ...session.user, sessionId: session.id };
    const row = await f.read();
    const preview = (await f.http(f.sqe.cookie, 'post', `${f.prefix}/disclosure-preview`, { expectedRowVersion: row.rowVersion, selectedFileIds: [] }).expect(200)).body;
    await f.http(f.sqe.cookie, 'post', `${f.prefix}/release`, { expectedRowVersion: preview.rowVersion, selectedFileIds: [], previewToken: preview.previewToken, confirmed: true }).expect(200);
    current = (await f.http(f.vendor.cookie, 'get', f.portal).expect(200)).body;
    current = (await f.http(f.vendor.cookie, 'put', f.portal, { ...f.version(current), document: supplierEightDDocument() }).expect(200)).body;
    const core = app.get(SupplierEightDService);
    context = (await f.db.$transaction(tx => core.notificationContext(tx, f.f.org.id, f.draft.id)))!;
    expect(context).not.toBeNull();
    expect(await f.db.$transaction(tx => core.canTaskRecipient(tx, context, f.vendor.user.id, 'HANDLING'))).toBe(true);
    const historicalDraft = (await f.http(f.sqe.cookie, 'post', 'supplier-quality/drafts', { profileId: f.profile.id, title: 'Retained approved supplier history',
      materialCode: 'HISTORY-PART', defectDescription: 'Real approved history', defectQuantity: 1, severity: 'LOW', responseForm: 'EIGHT_D', replyMode: 'SUPPLIER' }).expect(201)).body;
    historicalId = historicalDraft.id;
    let historical = (await f.http(f.sqe.cookie, 'post', `supplier-quality/eight-d/drafts/${historicalId}/issue`, { expectedVersion: historicalDraft.version, sqeAssignmentId: f.f.owner.assignment.id }).expect(201)).body;
    const historicalPrefix = `supplier-quality/eight-d/${historicalId}`, historicalPortal = `supplier-portal/eight-d/${historicalId}`;
    const historicalPreview = (await f.http(f.sqe.cookie, 'post', `${historicalPrefix}/disclosure-preview`, { expectedRowVersion: historical.rowVersion, selectedFileIds: [] }).expect(200)).body;
    await f.http(f.sqe.cookie, 'post', `${historicalPrefix}/release`, { expectedRowVersion: historicalPreview.rowVersion, selectedFileIds: [], previewToken: historicalPreview.previewToken, confirmed: true }).expect(200);
    historical = (await f.http(f.vendor.cookie, 'get', historicalPortal).expect(200)).body;
    historical = (await f.http(f.vendor.cookie, 'put', historicalPortal, { ...f.version(historical), document: supplierEightDDocument() }).expect(200)).body;
    historical = (await f.http(f.vendor.cookie, 'post', `${historicalPortal}/analysis-complete`, { ...f.version(historical), submissionDueAt: '2099-11-20T00:00:00Z' }).expect(201)).body;
    historical = (await f.http(f.vendor.cookie, 'post', `${historicalPortal}/submit`, f.version(historical)).expect(201)).body;
    const professional = await f.decide(f.sqe, historical.closure, ['PROFESSIONAL']);
    expect(professional.status).toBe(200);
    const approved = await f.decide(f.manager, professional.body, ['SECTION_MANAGER']);
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('APPROVED');
    historical = (await f.http(f.vendor.cookie, 'get', historicalPortal).expect(200)).body;
    approvedRevisionId = historical.approvedRevisionId;
    expect(approvedRevisionId).toBeTruthy();
    // An optional real approval-resource signature is retained, not made a new workflow prerequisite.
    const signingPermissions = await f.db.permission.findMany({ where: { code: { in: ['e-signature:signatures:write', 'e-signature:approvals:sign'] } } });
    expect(signingPermissions).toHaveLength(2);
    await f.db.rolePermission.createMany({ data: signingPermissions.map(p => ({ roleId: f.f.role.id, permissionId: p.id })) });
    const signature = (await f.http(f.sqe.cookie, 'post', 'e-signatures', { label: 'Historical approval', signatureData: 'real-test-signature-for-approved-revision' }).expect(201)).body;
    await f.http(f.sqe.cookie, 'post', 'e-signatures/approvals', { signatureId: signature.id, resourceType: 'SUPPLIER_RESPONSE_REVISION', resourceId: approvedRevisionId, resourceVersion: historical.contentVersion }).expect(201);
    historyBefore = await historicalFacts();
    expect(historyBefore.publications).toHaveLength(2);
    expect(historyBefore.revisions).toHaveLength(1);
    expect(historyBefore.origins).toHaveLength(1);
    expect(historyBefore.signatures).toHaveLength(1);
    expect(historyBefore.duties).toHaveLength(2);
    const commands = app.get(OrganizationForceDeleteService);
    const deletion = await commands.previewOrganization(actor, f.f.org.id);
    await commands.forceDeleteOrganization(actor, f.f.org.id, { expectedVersion: deletion.version, previewToken: deletion.previewToken, confirmed: true }, randomUUID(), randomUUID());
    expect(await f.db.organization.findUniqueOrThrow({ where: { id: f.f.org.id } })).toMatchObject({ status: 'DISABLED', deletedAt: expect.any(Date) });
    expect(await f.db.organization.findUniqueOrThrow({ where: { id: f.vendor.org.id } })).toMatchObject({ status: 'ACTIVE', deletedAt: null });
    const resolved = await sessions.resolve(f.vendor.cookie.slice('qms_session='.length));
    expect(resolved?.user.id).toBe(f.vendor.user.id);
    expect(await historicalFacts()).toEqual(historyBefore);
    before = await facts();
  }, 120_000);
  afterAll(async () => { await app?.close(); });

  it('rejects the still-authenticated supplier PUT with 403 and leaves draft/control/source untouched', async () => {
    const response = await f.http(f.vendor.cookie, 'put', f.portal, { ...f.version(current), document: { ...supplierEightDDocument(), description: 'Must not reach retired tenant' } });
    expect(await facts()).toEqual(before);
    expect(response.status).toBe(403);
  });

  it('preserves history without widening portal visibility: owner-inactive GET stays 404 and approved facts remain immutable', async () => {
    await f.http(f.vendor.cookie, 'get', f.portal).expect(404);
    await f.http(f.vendor.cookie, 'get', `supplier-portal/eight-d/${historicalId}`).expect(404);
    expect(await historicalFacts()).toEqual(historyBefore);
    expect(await facts()).toEqual(before);
  });

  it('makes previous handling/notification eligibility and the actual task inbox inactive without draining the worker queue', async () => {
    const core = app.get(SupplierEightDService);
    for (const purpose of ['HANDLING', 'NOTIFICATION'] as const) {
      expect(await f.db.$transaction(tx => core.canTaskRecipient(tx, context, f.vendor.user.id, purpose))).toBe(false);
    }
    const inbox = (await f.http(f.vendor.cookie, 'get', `supplier-portal/eight-d/tasks?supplierProblemId=${f.draft.id}`).expect(200)).body;
    expect(inbox.items).toEqual([]);
  });

  it('allows record history loading but rejects direct reply eligibility for the retired owner', async () => {
    const core = app.get(SupplierEightDService);
    await expect(f.db.$transaction(async tx => {
      const record = await core.lockRecord(tx, f.vendor.actor, f.draft.id, true);
      await core.authorizeReply(tx, f.vendor.actor, record);
    })).rejects.toMatchObject({ status: 403 });
  });

  it('uses no organization lock for a projection but FOR SHARE for a write fence', async () => {
    const owner = await f.db.organization.create({ data: { code: randomUUID(), name: 'Real lock fence owner', type: 'INTERNAL' } });
    const blocker = new Client({ connectionString: process.env.DATABASE_URL });
    await blocker.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM organizations WHERE id = $1::uuid FOR UPDATE', [owner.id]);
      const port = app.get(OrganizationResponsibilityService);
      await f.db.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '150ms'");
        await port.assertWorkflowOrganizationActive(tx, owner.id);
      });
      await expect(f.db.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '150ms'");
        await port.assertWorkflowOrganizationActive(tx, owner.id, true);
      })).rejects.toMatchObject({ meta: { driverAdapterError: { cause: { originalCode: '55P03' } } } });
    } finally {
      await blocker.query('ROLLBACK');
      await blocker.end();
    }
  });
});
