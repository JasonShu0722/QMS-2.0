import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { ProcessFollowupQueryDto } from '../../src/modules/problem-index/problem-index.dto.js';
import { ProblemQueryService } from '../../src/modules/problem-index/problem-query.service.js';
import { ProcessEightDService } from '../../src/modules/process-quality/process-eight-d.service.js';
import type { WorkflowActor } from '../../src/modules/workflow/workflow-access-policy.js';

const url = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL);
if (!url || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !['postgres:', 'postgresql:'].includes(url.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port === '55440' || url.search || url.hash) {
  throw new Error('Process follow-up requires disposable loopback PostgreSQL, never preview 55440.');
}

const base = '/api/v1/problem-index';
const followup = `${base}/process-followup`;
const dates = {
  original: '2026-11-02T00:00:00.000Z', cutoff: '2026-11-10T00:00:00.000Z',
  analysis: '2026-11-12T00:00:00.000Z', submission: '2026-11-19T00:00:00.000Z', closure: '2026-11-25T00:00:00.000Z',
};

describe('process 8D follow-up list on PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => { await app?.close(); });

  async function person(organizationId: string, codes: string[]) {
    const user = await prisma.user.create({ data: { organizationId, accountType: 'INTERNAL', username: randomUUID(), fullName: 'Named owner', passwordHash: 'unused' } });
    const permissions = await prisma.permission.findMany({ where: { code: { in: codes } } });
    expect(permissions).toHaveLength(codes.length);
    const role = await prisma.role.create({ data: { organizationId, code: randomUUID(), name: 'List permissions', permissions: { create: permissions.map(({ id }) => ({ permissionId: id })) } } });
    await prisma.userRole.create({ data: { organizationId, userId: user.id, roleId: role.id } });
    const sessions = app.get(SessionService);
    const token = await sessions.create(user.id, prisma, { mfaVerified: true, reauthenticated: true });
    const session = (await sessions.resolve(token))!;
    return { user, role, cookie: `qms_session=${token}`, actor: { id: user.id, organizationId, accountType: user.accountType, sessionId: session.id } };
  }

  async function fixture() {
    const org = await prisma.organization.create({ data: { code: randomUUID(), name: 'Follow-up test', type: 'INTERNAL' } });
    const owner = await person(org.id, ['problem-index:read', 'process-quality:issues:read', 'process-quality:defects:read', 'customer-quality:complaints:read']);
    const section = await prisma.department.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Responsibility section' } });
    const otherSection = await prisma.department.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Other section' } });
    const definition = await prisma.workflowDefinition.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Read fixture' } });
    const version = await prisma.workflowVersion.create({ data: { organizationId: org.id, workflowDefinitionId: definition.id, version: 1, status: 'PUBLISHED' } });
    const node = await prisma.workflowNode.create({ data: { organizationId: org.id, workflowVersionId: version.id, nodeKey: 'owner', name: 'Owner', type: 'ACTION' } });
    const review = await prisma.workflowNode.create({ data: { organizationId: org.id, workflowVersionId: version.id, nodeKey: 'review', name: 'Review', type: 'APPROVAL', config: { closureReview: {} } } });

    const create = async (reportNumber: string, options: {
      title?: string; description?: string; sectionId?: string; stage?: 'SUBMISSION' | 'REVIEW' | 'CLOSED' | 'SUSPENDED';
      analysisDueAt?: string | null; severity?: string; legacy?: boolean; customer?: boolean; newProduct?: boolean;
    } = {}) => {
      const [domainCode, sourceType] = options.customer ? ['customer-quality', 'customer-complaint'] : options.newProduct ? ['new-product-quality', 'new-product-issue'] : ['process-quality', 'process-defect'];
      const closed = options.stage === 'CLOSED';
      const problem = await prisma.problemIndex.create({ data: { organizationId: org.id, domainCode, sourceType, sourceId: randomUUID(), reportNumber, problemType: 'EIGHT_D',
        ownerId: owner.user.id, severity: options.severity ?? 'LOW', status: closed ? 'CLOSED' : options.stage === 'REVIEW' ? 'PENDING' : 'IN_PROGRESS',
        closedAt: closed ? new Date(dates.original) : null, dueAt: new Date(dates.closure) } });
      if (options.legacy || options.customer || options.newProduct) return problem;
      const instance = await prisma.workflowInstance.create({ data: { organizationId: org.id, problemIndexId: problem.id, workflowDefinitionId: definition.id,
        workflowVersionId: version.id, currentNodeId: options.stage === 'REVIEW' ? review.id : node.id, instanceKey: randomUUID(), status: options.stage === 'SUSPENDED' ? 'SUSPENDED' : closed ? 'COMPLETED' : 'RUNNING' } });
      await prisma.problemIndex.update({ where: { id: problem.id }, data: { workflowInstanceId: instance.id } });
      const document = { title: options.title ?? 'Unrelated title', description: options.description ?? 'Unrelated description' };
      await prisma.$executeRaw`INSERT INTO process_eight_d_reports
        (organization_id, problem_id, responsible_section_department_id, professional_user_id, document, analysis_due_at, submission_due_at, closure_due_at, analysis_completed_at, submitted_at, created_by, updated_by)
        VALUES (${org.id}::uuid, ${problem.id}::uuid, ${options.sectionId ?? section.id}::uuid, ${owner.user.id}::uuid, ${JSON.stringify(document)}::jsonb,
        ${options.analysisDueAt === undefined ? new Date(dates.original) : options.analysisDueAt === null ? null : new Date(options.analysisDueAt)}::timestamptz,
        ${new Date(dates.submission)}, ${new Date(dates.closure)}, ${options.stage ? new Date(dates.original) : null}::timestamptz,
        ${options.stage === 'REVIEW' || closed ? new Date(dates.original) : null}::timestamptz, ${owner.user.id}::uuid, ${owner.user.id}::uuid)`;
      if (closed) {
        const revision = randomUUID();
        const snapshot = { document: { title: 'Pinned snapshot title', description: 'Pinned snapshot description' }, ownerUserId: owner.user.id, responsibleSectionDepartmentId: section.id };
        await prisma.$executeRaw`INSERT INTO process_eight_d_revisions (id, organization_id, problem_id, content_version, snapshot)
          VALUES (${revision}::uuid, ${org.id}::uuid, ${problem.id}::uuid, 1, ${JSON.stringify(snapshot)}::jsonb)`;
        await prisma.$executeRaw`UPDATE process_eight_d_reports SET closed_revision_id = ${revision}::uuid WHERE problem_id = ${problem.id}::uuid`;
      }
      return problem;
    };
    return { org, owner, section, otherSection, create };
  }

  function list(who: { actor: WorkflowActor }, query: Record<string, string | number> = {}) {
    return app.get(ProblemQueryService).listProcessFollowup(who.actor, plainToInstance(ProcessFollowupQueryDto, query));
  }

  function generalList(who: { cookie: string }, query: Record<string, string>) {
    return request(app.getHttpServer()).get(base).set('Cookie', who.cookie).query(query).expect(200);
  }

  function followupRequest(who: { cookie: string }, query: Record<string, string | number> = {}) {
    return request(app.getHttpServer()).get(followup).set('Cookie', who.cookie).query(query);
  }

  it('applies HTTP query filters to the entire population before paging and counting', async () => {
    const local = await fixture();
    const matches = await Promise.all([
      local.create('A-101', { title: 'Old document title' }),
      local.create('A-102', { description: 'Measure bearing 5% against gauge' }),
      local.create('BEARING 5%-103'),
    ]);
    const nonMatch = await local.create('Z-201');
    await prisma.$executeRaw`UPDATE process_eight_d_reports SET issue_title = 'Bearing 5% clearance' WHERE problem_id = ${matches[0]!.id}::uuid`;
    await prisma.$executeRaw`UPDATE process_eight_d_reports SET issue_title = 'Bearing 50 clearance' WHERE problem_id = ${nonMatch.id}::uuid`;
    await local.create('Z-202', { title: 'Bearing 5% other stage', stage: 'SUBMISSION' });
    await local.create('Z-203', { title: 'Bearing 5% other section', sectionId: local.otherSection.id });
    await local.create('Z-204', { title: 'Bearing 5% other risk', severity: 'HIGH' });
    await local.create('BEARING 5%-LEGACY', { legacy: true });
    const filters = { search: '  bearing 5% ', stage: 'ANALYSIS', responsibleSectionDepartmentId: local.section.id, ownerId: local.owner.user.id,
      status: 'IN_PROGRESS', severity: 'LOW', sortBy: 'reportNumber', sortDirection: 'asc', pageSize: 1 };
    for (const [index, match] of matches.entries()) {
      const page = await followupRequest(local.owner, { ...filters, page: index + 1 }).expect(200);
      expect(page.body).toMatchObject({ total: 3, page: index + 1, pageSize: 1, statusCounts: [{ status: 'IN_PROGRESS', count: 3 }],
        items: [{ id: match.id, stage: 'ANALYSIS', responsibleSectionDepartmentId: local.section.id, dueAt: dates.original }] });
      if (index === 0) expect(page.body.items[0].summary).toMatchObject({ title: 'Bearing 5% clearance', description: 'Unrelated description' });
    }
    const empty = await followupRequest(local.owner, { ...filters, page: 4 }).expect(200);
    expect(empty.body).toMatchObject({ items: [], total: 3, statusCounts: [{ status: 'IN_PROGRESS', count: 3 }] });
    const byName = await followupRequest(local.owner, { search: filters.search, stage: filters.stage, status: filters.status, severity: filters.severity,
      ownerName: 'named OWNER', responsibleSectionName: 'Responsibility sect', pageSize: 1 }).expect(200);
    expect(byName.body.total).toBe(3);
    expect((await followupRequest(local.owner, { ownerName: 'unknown-facility-owner', pageSize: 1 }).expect(200)).body.total).toBe(0);
    await followupRequest(local.owner, { stage: '分析阶段' }).expect(400);
    await followupRequest(local.owner, { responsibleSectionDepartmentId: 'name-not-id' }).expect(400);
    await followupRequest(local.owner, { dueFrom: dates.closure, dueTo: dates.original }).expect(400);
    await followupRequest(local.owner, { domainCode: 'customer-quality' }).expect(400);
  });

  it('projects and orders the current due, counts an applied extension, and excludes rows without current due', async () => {
    const local = await fixture();
    const extended = await local.create('A-extended');
    const original = await local.create('B-original');
    const submission = await local.create('C-submission', { stage: 'SUBMISSION' });
    const review = await local.create('D-review', { stage: 'REVIEW' });
    const closed = await local.create('E-closed', { stage: 'CLOSED' });
    const noDue = await local.create('F-none', { analysisDueAt: null });
    const suspended = await local.create('G-suspended', { stage: 'SUSPENDED' });
    const service = app.get(ProcessEightDService);
    await prisma.$transaction(async tx => {
      const record = await service.lockRecord(tx, local.owner.actor, extended.id, 'READ');
      await service.applyDeadlineExtension(tx, record, 'ANALYSIS', new Date(dates.analysis));
    });

    const dueOrder = await list(local.owner, { sortBy: 'dueAt', sortDirection: 'asc' });
    expect(dueOrder.items.slice(0, 4).map(({ id, dueAt }) => [id, dueAt])).toEqual([
      [original.id, dates.original], [extended.id, dates.analysis], [submission.id, dates.submission], [review.id, dates.closure],
    ]);
    expect(dueOrder.items.slice(4)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: closed.id, stage: 'CLOSED', dueAt: null }),
      expect.objectContaining({ id: noDue.id, stage: 'ANALYSIS', dueAt: null }),
      expect.objectContaining({ id: suspended.id, stage: 'SUSPENDED', dueAt: null }),
    ]));
    const overdue = await list(local.owner, { overdueAt: dates.cutoff });
    expect(overdue).toMatchObject({ total: 1, items: [{ id: original.id }] });
    const range = await list(local.owner, { dueFrom: dates.analysis, dueTo: dates.submission, sortBy: 'dueAt', sortDirection: 'desc', pageSize: 1 });
    expect(range).toMatchObject({ total: 2, items: [{ id: submission.id, stage: 'SUBMISSION', dueAt: dates.submission }] });
    const history = await list(local.owner, { search: 'Pinned snapshot', stage: 'CLOSED' });
    expect(history).toMatchObject({ total: 1, items: [{ id: closed.id, summary: { title: 'Pinned snapshot title', description: 'Pinned snapshot description' } }] });
    const general = await generalList(local.owner, { search: 'A-extended' });
    expect(general.body).toMatchObject({ total: 1, items: [{ id: extended.id, dueAt: dates.closure }] });
    expect(general.body.items[0]).not.toHaveProperty('stage');
  });

  it('respects organization and domain visibility without changing the general list', async () => {
    const local = await fixture();
    const other = await fixture();
    const localReport = await local.create('LOCAL');
    const otherReport = await other.create('FOREIGN');
    await local.create('LEGACY', { legacy: true });
    await local.create('CUSTOMER', { customer: true });
    await local.create('NEW-PRODUCT', { newProduct: true });
    const denied = await person(local.org.id, ['problem-index:read']);
    const administrator = await person(local.org.id, ['platform:admin']);
    await request(app.getHttpServer()).get(followup).expect(401);
    const localRows = await followupRequest(local.owner).expect(200);
    expect(localRows.body).toMatchObject({ total: 1, items: [{ id: localReport.id, organizationId: local.org.id }] });
    await followupRequest(local.owner, { organizationId: other.org.id }).expect(403);
    await expect(list(local.owner, { organizationId: other.org.id })).rejects.toMatchObject({ status: 403 });
    await prisma.userRole.create({ data: { organizationId: other.org.id, userId: local.owner.user.id, roleId: other.owner.role.id } });
    await expect(list(local.owner, { organizationId: other.org.id })).rejects.toMatchObject({ status: 403 });
    await followupRequest(denied).expect(403);
    const foreign = await followupRequest(administrator, { organizationId: other.org.id }).expect(200);
    expect(foreign.body).toMatchObject({ total: 1, items: [{ id: otherReport.id, organizationId: other.org.id }] });
    const general = await generalList(local.owner, { domainCode: 'customer-quality', search: 'CUSTOMER' });
    expect(general.body).toMatchObject({ total: 1, items: [{ reportNumber: 'CUSTOMER' }] });
  });
});
