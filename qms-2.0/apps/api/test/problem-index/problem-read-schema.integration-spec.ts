import { createHash, randomUUID } from 'node:crypto';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { PROBLEM_DOMAIN_READ_ADAPTERS } from '../../src/modules/problem-index/problem-domain-registry.js';
import { NeutralReadAdapter, NeutralReadFileAdapter } from './neutral-read-adapter.js';
import { timingFixture, clearTimingEvents } from '../task-notification/workflow-timing-fixture.js';
import { FILE_RESOURCE_ADAPTERS } from '../../src/modules/file-management/file-resource-access.js';
import { FileLifecycleService } from '../../src/modules/file-management/file-lifecycle.service.js';
import { FileScanWorkerService } from '../../src/modules/file-management/file-scan-worker.service.js';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ProblemDomainRegistry } from '../../src/modules/problem-index/problem-domain-registry.js';

for (const name of ['DATABASE_URL', 'QMS_OBJECT_STORAGE_ENDPOINT', 'QMS_OBJECT_STORAGE_BUCKET', 'QMS_OBJECT_STORAGE_ACCESS_KEY', 'QMS_OBJECT_STORAGE_SECRET_KEY', 'QMS_FILE_SCANNER_HOST', 'QMS_FILE_SCANNER_PORT']) {
  if (!process.env[name]) throw new Error(`Real problem read integration requires ${name}`);
}

describe('domain authorized problem reads on PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let registered: INestApplication;
  const adapter = new NeutralReadAdapter();
  const fileAdapter = new NeutralReadFileAdapter();
  const workflowOrganizations: string[] = [];
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS p4_read_fixture');
    await prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS p4_read_fixture.records (id uuid PRIMARY KEY, organization_id uuid NOT NULL, reader_user_id uuid NOT NULL, title text NOT NULL, description text NOT NULL, version integer NOT NULL DEFAULT 1, report_allowed boolean NOT NULL DEFAULT true)');
    await prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS p4_read_fixture.revisions (id uuid PRIMARY KEY, resource_id uuid NOT NULL, instance_id uuid NOT NULL, instance_version integer NOT NULL, report jsonb NOT NULL)');
    await prisma.$executeRawUnsafe("CREATE OR REPLACE FUNCTION p4_read_fixture.reject_revision_changes() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'IMMUTABLE_REVISION'; END $$");
    await prisma.$executeRawUnsafe('CREATE OR REPLACE TRIGGER immutable_revision BEFORE UPDATE OR DELETE ON p4_read_fixture.revisions FOR EACH ROW EXECUTE FUNCTION p4_read_fixture.reject_revision_changes()');
    await prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS p4_read_fixture.evidence (source_id uuid NOT NULL, revision_id uuid, file_id uuid NOT NULL, resource_type text NOT NULL, resource_id uuid NOT NULL)');
    const configured = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PROBLEM_DOMAIN_READ_ADAPTERS).useValue([adapter])
      .overrideProvider(FILE_RESOURCE_ADAPTERS).useValue([fileAdapter]).compile();
    registered = configured.createNestApplication();
    registered.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    registered.useGlobalFilters(new GlobalExceptionFilter());
    await registered.init();
  });
  afterAll(async () => { await clearTimingEvents(prisma, workflowOrganizations); await registered?.close(); await app?.close(); });

  async function fixture() {
    const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'Problem read fixture', type: 'INTERNAL' } });
    const user = await prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), passwordHash: 'unused', accountType: 'INTERNAL' } });
    const role = await prisma.role.create({ data: { organizationId: organization.id, code: randomUUID(), name: 'Reader' } });
    const permission = await prisma.permission.upsert({ where: { code: 'problem-index:read' }, create: { code: 'problem-index:read', name: 'Read problems' }, update: {} });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    await prisma.userRole.create({ data: { userId: user.id, organizationId: organization.id, roleId: role.id } });
    const token = await app.get(SessionService).create(user.id);
    const problem = await prisma.problemIndex.create({ data: { organizationId: organization.id, reportNumber: randomUUID(), domainCode: 'neutral-read-test', sourceType: 'neutral-read-record', sourceId: randomUUID(), problemType: 'BRIEF', severity: 'LOW' } });
    return { organization, user, role, problem, cookie: `qms_session=${token}` };
  }

  it('does not expose unregistered domains through any legacy problem read route', async () => {
    const context = await fixture();
    const page = await request(app.getHttpServer()).get('/api/v1/problem-index').set('Cookie', context.cookie).expect(200);
    expect(page.body).toMatchObject({ items: [], total: 0 });
    const center = await request(app.getHttpServer()).get('/api/v1/problem-center').set('Cookie', context.cookie).expect(200);
    expect(center.body).toMatchObject({ items: [], total: 0 });
    for (const route of [`problem-index/${context.problem.id}`, `problem-index/${context.problem.id}/workspace`, `reports/problems/${context.problem.id}`, `problems/${context.problem.id}/audit-trail`]) {
      await request(app.getHttpServer()).get(`/api/v1/${route}`).set('Cookie', context.cookie).expect(404);
    }
  });

  it('authorizes before pagination, counts, and statistics with stable empty last pages', async () => {
    const context = await fixture();
    const second = await prisma.problemIndex.create({ data: { ...context.problem, id: randomUUID(), sourceId: randomUUID(), reportNumber: 'VISIBLE-2', status: 'IN_PROGRESS' } });
    await prisma.problemIndex.create({ data: { ...context.problem, id: randomUUID(), sourceId: randomUUID(), reportNumber: 'HIDDEN' } });
    await prisma.problemIndex.create({ data: { ...context.problem, id: randomUUID(), sourceType: 'unregistered', sourceId: randomUUID(), reportNumber: 'UNKNOWN' } });
    for (const problem of [context.problem, second]) {
      await prisma.$executeRaw`INSERT INTO p4_read_fixture.records(id, organization_id, reader_user_id, title, description) VALUES (${problem.sourceId}::uuid, ${context.organization.id}::uuid, ${context.user.id}::uuid, ${problem.reportNumber}, 'Authorized domain summary')`;
    }
    const server = registered.getHttpServer();
    const initialBatches = adapter.summaryBatches.length;
    const first = await request(server).get('/api/v1/problem-index?pageSize=1&sortBy=createdAt&sortDirection=asc').set('Cookie', context.cookie).expect(200);
    const next = await request(server).get('/api/v1/problem-index?pageSize=1&page=2&sortBy=createdAt&sortDirection=asc').set('Cookie', context.cookie).expect(200);
    expect(first.body.total).toBe(2);
    expect(first.body.statusCounts).toEqual([{ status: 'OPEN', count: 1 }, { status: 'IN_PROGRESS', count: 1 }]);
    expect(new Set([first.body.items[0].id, next.body.items[0].id])).toEqual(new Set([context.problem.id, second.id]));
    expect(first.body.items[0].summary.description).toBe('Authorized domain summary');
    expect(first.body.items[0]).not.toHaveProperty('createdById');
    expect(adapter.summaryBatches.length - initialBatches).toBe(2);
    const empty = await request(server).get('/api/v1/problem-index?pageSize=1&page=3').set('Cookie', context.cookie).expect(200);
    expect(empty.body).toMatchObject({ items: [], total: 2 });
    for (const query of ['sortBy=source_id%3BDROP%20TABLE', 'ownerId=bad', 'status=OPEN&status=CLOSED', 'dueFrom=2026-09-19', 'pageSize=101', 'unexpected=secret']) {
      await request(server).get(`/api/v1/problem-index?${query}`).set('Cookie', context.cookie).expect(400);
    }
    await prisma.userRole.deleteMany({ where: { userId: context.user.id } });
    await request(server).get('/api/v1/problem-index').set('Cookie', context.cookie).expect(403);
  });

  it('returns a fixed workflow with actual visits while read permission never grants node actions', async () => {
    const context = await timingFixture(prisma, workflowOrganizations);
    const sourceId = randomUUID();
    await prisma.problemIndex.update({ where: { id: context.problem.id }, data: { domainCode: adapter.domainCode, sourceType: adapter.sourceType, sourceId } });
    await prisma.$executeRaw`INSERT INTO p4_read_fixture.records(id, organization_id, reader_user_id, title, description) VALUES (${sourceId}::uuid, ${context.organization.id}::uuid, ${context.manager.id}::uuid, 'Read-only manager', 'Current facts')`;
    const token = await app.get(SessionService).create(context.manager.id);
    const response = await request(registered.getHttpServer()).get(`/api/v1/problem-index/${context.problem.id}/workspace`).set('Cookie', `qms_session=${token}`).expect(200);
    expect(response.body).toMatchObject({ problem: { id: context.problem.id }, readOnly: true,
      selectedInstance: { id: context.started.instanceId, workflowVersionId: context.started.workflowVersionId },
      domain: { summary: { title: 'Read-only manager' } }, capabilities: { canAct: false, allowedActions: [] } });
    expect(response.body.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ id: context.started.currentNodeId, visited: true, current: true })]));
    expect(response.body.actions).toEqual(expect.arrayContaining([expect.objectContaining({ actionKey: 'platform.upgrade', enabled: false })]));
    expect(response.body).not.toHaveProperty('completionPercent');
    const other = await fixture();
    const otherProblem = await prisma.problemIndex.create({ data: { ...other.problem, id: randomUUID(), sourceId: randomUUID(), reportNumber: randomUUID() } });
    await request(registered.getHttpServer()).get(`/api/v1/problem-index/${otherProblem.id}/workspace?instanceId=${context.started.instanceId}`).set('Cookie', other.cookie).expect(404);
    await prisma.$executeRaw`UPDATE p4_read_fixture.records SET reader_user_id = ${context.user.id}::uuid WHERE id = ${sourceId}::uuid`;
    const workerOnly = await app.get(SessionService).create(context.user.id);
    await request(registered.getHttpServer()).get(`/api/v1/problem-index/${context.problem.id}/workspace`).set('Cookie', `qms_session=${workerOnly}`).expect(403);
  });

  it('reports only an immutable domain revision and never substitutes current fields for missing history', async () => {
    const context = await timingFixture(prisma, workflowOrganizations);
    const sourceId = randomUUID();
    await prisma.problemIndex.update({ where: { id: context.problem.id }, data: { domainCode: adapter.domainCode, sourceType: adapter.sourceType, sourceId, severity: 'HIGH' } });
    await prisma.$executeRaw`INSERT INTO p4_read_fixture.records(id, organization_id, reader_user_id, title, description) VALUES (${sourceId}::uuid, ${context.organization.id}::uuid, ${context.manager.id}::uuid, 'Current title', 'Current edited facts')`;
    const token = await app.get(SessionService).create(context.manager.id);
    const path = `/api/v1/reports/problems/${context.problem.id}?instanceId=${context.started.instanceId}`;
    const absent = await request(registered.getHttpServer()).get(path).set('Cookie', `qms_session=${token}`).expect(200);
    expect(absent.body).toMatchObject({ dataAvailability: 'UNAVAILABLE', revision: null, summary: null, sections: [], snapshot: null });
    expect(JSON.stringify(absent.body)).not.toContain('Current edited facts');
    const revisionId = randomUUID();
    const report = { revisionId, instanceId: context.started.instanceId, instanceVersion: 1, recordedAt: new Date().toISOString(),
      summary: { title: 'Historical title', description: 'Original facts', domainUiKey: adapter.domainCode },
      snapshot: { problemType: 'BRIEF', severity: 'LOW', status: 'IN_PROGRESS', responsibleParty: null, ownerId: null, dueAt: null },
      sections: [{ key: 'facts', title: 'Evidence facts', fields: [{ key: 'description', label: 'Description', value: 'Original facts' }] }] };
    await prisma.$executeRaw`INSERT INTO p4_read_fixture.revisions(id, resource_id, instance_id, instance_version, report) VALUES (${revisionId}::uuid, ${sourceId}::uuid, ${context.started.instanceId}::uuid, 1, ${JSON.stringify(report)}::jsonb)`;
    const historical = await request(registered.getHttpServer()).get(path).set('Cookie', `qms_session=${token}`).expect(200);
    expect(historical.body).toMatchObject({ dataAvailability: 'AVAILABLE', revision: { id: revisionId, instanceVersion: 1 }, snapshot: { severity: 'LOW' }, summary: { title: 'Historical title' } });
    expect(JSON.stringify(historical.body)).not.toContain('Current edited facts');
    await expect(prisma.$executeRaw`UPDATE p4_read_fixture.revisions SET report = '{}'::jsonb WHERE id = ${revisionId}::uuid`).rejects.toThrow('IMMUTABLE_REVISION');
    await context.action(context.started, 'SUBMIT');
    const afterAdvance = await request(registered.getHttpServer()).get(path).set('Cookie', `qms_session=${token}`).expect(200);
    expect(afterAdvance.body.instance).toMatchObject({ version: 1, currentNodeId: context.started.currentNodeId });
    expect(afterAdvance.body.nodes.find((node: { id: string }) => node.id === context.started.currentNodeId).current).toBe(true);
    await prisma.$executeRaw`UPDATE p4_read_fixture.records SET report_allowed = false WHERE id = ${sourceId}::uuid`;
    await request(registered.getHttpServer()).get(path).set('Cookie', `qms_session=${token}`).expect(404);
    await request(registered.getHttpServer()).get(`/api/v1/problem-index/${context.problem.id}/workspace`).set('Cookie', `qms_session=${token}`).expect(200);
  });

  it('pages trusted audit resource pairs without trace expansion or sensitive metadata', async () => {
    const context = await fixture();
    await prisma.$executeRaw`INSERT INTO p4_read_fixture.records(id, organization_id, reader_user_id, title, description) VALUES (${context.problem.sourceId}::uuid, ${context.organization.id}::uuid, ${context.user.id}::uuid, 'Audit resource', 'Facts')`;
    const traceId = randomUUID();
    const createdAt = new Date('2026-09-19T00:00:00.000Z');
    const base = { organizationId: context.organization.id, actorUserId: context.user.id, traceId, outcome: 'SUCCESS', createdAt,
      metadata: { resourceVersion: 2, reasonCode: 'TEST_REASON', password: 'must-not-leak', cookie: 'must-not-leak', url: 'https://signed.invalid/private' } };
    const first = await prisma.auditEvent.create({ data: { ...base, action: 'PROBLEM_INDEX_CREATED', resourceType: 'ProblemIndex', resourceId: context.problem.id } });
    const second = await prisma.auditEvent.create({ data: { ...base, action: 'PROBLEM_INDEX_UPDATED', resourceType: 'ProblemIndex', resourceId: context.problem.id } });
    await prisma.auditEvent.createMany({ data: [
      { ...base, action: 'ATTACHMENT_SCAN_CLEAN', resourceType: 'FileObject', resourceId: context.problem.id },
      { ...base, action: 'PROBLEM_INDEX_CREATED', resourceType: 'ProblemIndex', resourceId: randomUUID() },
      { ...base, action: 'PASSWORD_CHANGED', resourceType: 'ProblemIndex', resourceId: context.problem.id },
    ] });
    const path = `/api/v1/problems/${context.problem.id}/audit-trail?pageSize=1`;
    const page = await request(registered.getHttpServer()).get(path).set('Cookie', context.cookie).expect(200);
    expect(page.body.items).toHaveLength(1);
    expect(page.body.nextCursor).toEqual(expect.any(String));
    const next = await request(registered.getHttpServer()).get(`${path}&cursor=${encodeURIComponent(page.body.nextCursor)}`).set('Cookie', context.cookie).expect(200);
    expect(new Set([page.body.items[0].id, next.body.items[0].id])).toEqual(new Set([first.id, second.id]));
    expect(next.body.nextCursor).toBeNull();
    expect(page.body.items[0]).toMatchObject({ resourceType: 'ProblemIndex', resourceId: context.problem.id, resourceVersion: 2, reasonCode: 'TEST_REASON' });
    expect(JSON.stringify([page.body, next.body])).not.toMatch(/must-not-leak|signed.invalid|traceId|metadata/);
    await request(registered.getHttpServer()).get(`${path}&cursor=invalid`).set('Cookie', context.cookie).expect(400);
  });

  it('refuses same-organization foreign instances and keeps replaced workflow history read-only', async () => {
    const context = await timingFixture(prisma, workflowOrganizations);
    const sourceId = randomUUID();
    const problem = await prisma.problemIndex.update({ where: { id: context.problem.id }, data: { domainCode: adapter.domainCode, sourceType: adapter.sourceType, sourceId } });
    await prisma.$executeRaw`INSERT INTO p4_read_fixture.records(id, organization_id, reader_user_id, title, description) VALUES (${sourceId}::uuid, ${context.organization.id}::uuid, ${context.manager.id}::uuid, 'History', 'Current domain facts')`;
    const other = await prisma.problemIndex.create({ data: { ...problem, id: randomUUID(), sourceId: randomUUID(), reportNumber: randomUUID(), workflowInstanceId: null } });
    const foreign = await prisma.workflowInstance.create({ data: { organizationId: problem.organizationId, problemIndexId: other.id, workflowDefinitionId: (await prisma.workflowInstance.findUniqueOrThrow({ where: { id: context.started.instanceId } })).workflowDefinitionId, workflowVersionId: context.started.workflowVersionId, instanceKey: randomUUID(), currentNodeId: context.started.currentNodeId } });
    const token = await app.get(SessionService).create(context.manager.id);
    const path = `/api/v1/problem-index/${problem.id}/workspace`;
    await request(registered.getHttpServer()).get(`${path}?instanceId=${foreign.id}`).set('Cookie', `qms_session=${token}`).expect(404);
    const current = await prisma.workflowInstance.create({ data: { organizationId: problem.organizationId, problemIndexId: problem.id, workflowDefinitionId: foreign.workflowDefinitionId, workflowVersionId: context.started.workflowVersionId, instanceKey: randomUUID(), currentNodeId: context.started.currentNodeId } });
    await prisma.$transaction(async (tx) => {
      await tx.workflowInstance.update({ where: { id: context.started.instanceId }, data: { status: 'CANCELLED' } });
      await tx.problemIndex.update({ where: { id: problem.id }, data: { workflowInstanceId: current.id } });
    });
    const history = await request(registered.getHttpServer()).get(`${path}?instanceId=${context.started.instanceId}`).set('Cookie', `qms_session=${token}`).expect(200);
    expect(history.body).toMatchObject({ readOnly: true, domainAvailability: 'UNAVAILABLE', domain: null, actions: [], selectedInstance: { id: context.started.instanceId, current: false }, capabilities: { canAct: false } });
    expect(history.body.instances.map((instance: { id: string }) => instance.id)).toEqual(expect.arrayContaining([current.id, context.started.instanceId]));
    expect(history.body.instances.map((instance: { id: string }) => instance.id)).not.toContain(foreign.id);
  });

  it('uses real P3 evidence authorization and fixed scanned bytes without issuing report URLs', async () => {
    const context = await timingFixture(prisma, workflowOrganizations);
    const sourceId = randomUUID();
    await prisma.problemIndex.update({ where: { id: context.problem.id }, data: { domainCode: adapter.domainCode, sourceType: adapter.sourceType, sourceId } });
    await prisma.$executeRaw`INSERT INTO p4_read_fixture.records(id, organization_id, reader_user_id, title, description) VALUES (${sourceId}::uuid, ${context.organization.id}::uuid, ${context.manager.id}::uuid, 'Evidence report', 'Verified facts')`;
    const token = await app.get(SessionService).create(context.manager.id);
    const session = (await app.get(SessionService).resolve(token))!;
    const actor = { ...session.user, sessionId: session.id };
    const files = registered.get(FileLifecycleService);
    const content = Buffer.from('Real problem report evidence');
    const input = { resourceType: 'NeutralReadEvidence', resourceId: sourceId, originalName: 'evidence.txt', contentType: 'text/plain', sizeBytes: content.length, sha256: createHash('sha256').update(content).digest('hex') };
    const clean = await files.initializeUpload(actor, input, randomUUID(), randomUUID());
    expect((await fetch(clean.uploadUrl, { method: 'PUT', headers: clean.headers, body: content })).status).toBe(200);
    await files.complete(actor, clean.file.id, 1, randomUUID(), randomUUID());
    await registered.get(FileScanWorkerService).processDue(100);
    expect(await files.get(actor, clean.file.id)).toMatchObject({ status: 'AVAILABLE', scanStatus: 'CLEAN' });
    const pending = await files.initializeUpload(actor, input, randomUUID(), randomUUID());
    const revisionId = randomUUID();
    const report = { revisionId, instanceId: context.started.instanceId, instanceVersion: 1, recordedAt: new Date().toISOString(), summary: { title: 'Evidence report', description: 'Verified facts', domainUiKey: adapter.domainCode },
      snapshot: { problemType: 'BRIEF', severity: 'LOW', status: 'IN_PROGRESS', responsibleParty: null, ownerId: null, dueAt: null }, sections: [] };
    await prisma.$executeRaw`INSERT INTO p4_read_fixture.revisions(id, resource_id, instance_id, instance_version, report) VALUES (${revisionId}::uuid, ${sourceId}::uuid, ${context.started.instanceId}::uuid, 1, ${JSON.stringify(report)}::jsonb)`;
    for (const fileId of [clean.file.id, pending.file.id]) await prisma.$executeRaw`INSERT INTO p4_read_fixture.evidence(source_id, revision_id, file_id, resource_type, resource_id) VALUES (${sourceId}::uuid, ${revisionId}::uuid, ${fileId}::uuid, 'NeutralReadEvidence', ${sourceId}::uuid)`;
    const stored = await prisma.fileObject.findUniqueOrThrow({ where: { id: clean.file.id } });
    const storage = new S3Client({ endpoint: process.env.QMS_OBJECT_STORAGE_ENDPOINT, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: process.env.QMS_OBJECT_STORAGE_ACCESS_KEY!, secretAccessKey: process.env.QMS_OBJECT_STORAGE_SECRET_KEY! } });
    try { await storage.send(new PutObjectCommand({ Bucket: process.env.QMS_OBJECT_STORAGE_BUCKET, Key: stored.objectKey, ContentType: 'text/plain', Body: 'Changed latest object' })); }
    finally { storage.destroy(); }
    const path = `/api/v1/reports/problems/${context.problem.id}`;
    const response = await request(registered.getHttpServer()).get(path).set('Cookie', `qms_session=${token}`).expect(200);
    expect(response.body.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ id: clean.file.id, downloadable: true, sha256: input.sha256 }), expect.objectContaining({ id: pending.file.id, downloadable: false, status: 'QUARANTINED' })]));
    expect(JSON.stringify(response.body)).not.toMatch(/objectKey|objectVersionId|uploadUrl|downloadUrl|X-Amz/);
    const signed = await files.download(actor, clean.file.id, randomUUID());
    expect(Buffer.from(await (await fetch(signed.url)).arrayBuffer())).toEqual(content);
    await files.deleteLogically(actor, clean.file.id, 3, randomUUID());
    const removed = await request(registered.getHttpServer()).get(path).set('Cookie', `qms_session=${token}`).expect(200);
    expect(removed.body.evidence.find((file: { id: string }) => file.id === clean.file.id)).toMatchObject({ status: 'DELETED', downloadable: false });
    const audit = await request(registered.getHttpServer()).get(`/api/v1/problems/${context.problem.id}/audit-trail?pageSize=100`).set('Cookie', `qms_session=${token}`).expect(200);
    expect(audit.body.items).toEqual(expect.arrayContaining([expect.objectContaining({ resourceType: 'FileObject', resourceId: clean.file.id, action: 'ATTACHMENT_SCAN_CLEAN' })]));
    await prisma.$executeRaw`UPDATE p4_read_fixture.evidence SET resource_id = ${randomUUID()}::uuid WHERE file_id = ${clean.file.id}::uuid`;
    await request(registered.getHttpServer()).get(path).set('Cookie', `qms_session=${token}`).expect(403);
  }, 60000);

  it('allows concurrent reports after both readers hold the shared domain authorization lock', async () => {
    const context = await timingFixture(prisma, workflowOrganizations);
    const sourceId = randomUUID();
    await prisma.problemIndex.update({ where: { id: context.problem.id }, data: { domainCode: adapter.domainCode, sourceType: adapter.sourceType, sourceId } });
    await prisma.$executeRaw`INSERT INTO p4_read_fixture.records(id, organization_id, reader_user_id, title, description) VALUES (${sourceId}::uuid, ${context.organization.id}::uuid, ${context.manager.id}::uuid, 'Concurrent report', 'Shared-lock facts')`;
    const token = await app.get(SessionService).create(context.manager.id);
    const session = (await app.get(SessionService).resolve(token))!;
    const actor = { ...session.user, sessionId: session.id };
    const pending = await registered.get(FileLifecycleService).initializeUpload(actor, { resourceType: 'NeutralReadEvidence', resourceId: sourceId,
      originalName: 'concurrent.txt', contentType: 'text/plain', sizeBytes: 1, sha256: createHash('sha256').update('x').digest('hex') }, randomUUID(), randomUUID());
    const revisionId = randomUUID();
    const report = { revisionId, instanceId: context.started.instanceId, instanceVersion: 1, recordedAt: new Date().toISOString(),
      summary: { title: 'Concurrent report', description: 'Shared-lock facts', domainUiKey: adapter.domainCode },
      snapshot: { problemType: 'BRIEF', severity: 'LOW', status: 'IN_PROGRESS', responsibleParty: null, ownerId: null, dueAt: null }, sections: [] };
    await prisma.$executeRaw`INSERT INTO p4_read_fixture.revisions(id, resource_id, instance_id, instance_version, report) VALUES (${revisionId}::uuid, ${sourceId}::uuid, ${context.started.instanceId}::uuid, 1, ${JSON.stringify(report)}::jsonb)`;
    await prisma.$executeRaw`INSERT INTO p4_read_fixture.evidence(source_id, revision_id, file_id, resource_type, resource_id) VALUES (${sourceId}::uuid, ${revisionId}::uuid, ${pending.file.id}::uuid, 'NeutralReadEvidence', ${sourceId}::uuid)`;
    fileAdapter.synchronizeNextReads();
    const path = `/api/v1/reports/problems/${context.problem.id}`;
    const responses = await Promise.all([request(registered.getHttpServer()).get(path).set('Cookie', `qms_session=${token}`), request(registered.getHttpServer()).get(path).set('Cookie', `qms_session=${token}`)]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(responses.every((response) => response.body.evidence.some((file: { id: string }) => file.id === pending.file.id))).toBe(true);
  }, 60000);

  it('keeps same-organization history, revision evidence, and audit resource pairs scoped to one problem', async () => {
    const context = await timingFixture(prisma, workflowOrganizations);
    const sourceId = randomUUID();
    const problem = await prisma.problemIndex.update({ where: { id: context.problem.id }, data: { domainCode: adapter.domainCode, sourceType: adapter.sourceType, sourceId } });
    const instance = await prisma.workflowInstance.findUniqueOrThrow({ where: { id: context.started.instanceId } });
    const foreignSourceId = randomUUID();
    const foreignProblem = await prisma.problemIndex.create({ data: { ...problem, id: randomUUID(), sourceId: foreignSourceId, reportNumber: randomUUID(), workflowInstanceId: null } });
    const foreignInstance = await prisma.workflowInstance.create({ data: { organizationId: problem.organizationId, problemIndexId: foreignProblem.id,
      workflowDefinitionId: instance.workflowDefinitionId, workflowVersionId: instance.workflowVersionId, instanceKey: randomUUID(), currentNodeId: context.started.currentNodeId } });
    await prisma.problemIndex.update({ where: { id: foreignProblem.id }, data: { workflowInstanceId: foreignInstance.id } });
    await prisma.$executeRaw`INSERT INTO p4_read_fixture.records(id, organization_id, reader_user_id, title, description) VALUES
      (${sourceId}::uuid, ${context.organization.id}::uuid, ${context.manager.id}::uuid, 'Scoped problem', 'Scoped facts'),
      (${foreignSourceId}::uuid, ${context.organization.id}::uuid, ${context.manager.id}::uuid, 'Foreign problem', 'Foreign facts')`;
    const token = await app.get(SessionService).create(context.manager.id);
    const session = (await app.get(SessionService).resolve(token))!;
    const actor = { ...session.user, sessionId: session.id };
    const ownRevisionId = randomUUID();
    const foreignRevisionId = randomUUID();
    const report = (revisionId: string, instanceId: string, title: string) => ({ revisionId, instanceId, instanceVersion: 1, recordedAt: new Date().toISOString(),
      summary: { title, description: `${title} facts`, domainUiKey: adapter.domainCode },
      snapshot: { problemType: 'BRIEF', severity: 'LOW', status: 'IN_PROGRESS', responsibleParty: null, ownerId: null, dueAt: null }, sections: [] });
    await prisma.$executeRaw`INSERT INTO p4_read_fixture.revisions(id, resource_id, instance_id, instance_version, report) VALUES
      (${ownRevisionId}::uuid, ${sourceId}::uuid, ${context.started.instanceId}::uuid, 1, ${JSON.stringify(report(ownRevisionId, context.started.instanceId, 'Scoped revision'))}::jsonb),
      (${foreignRevisionId}::uuid, ${foreignSourceId}::uuid, ${foreignInstance.id}::uuid, 1, ${JSON.stringify(report(foreignRevisionId, foreignInstance.id, 'Foreign revision'))}::jsonb)`;
    const files = registered.get(FileLifecycleService);
    const fileInput = (resourceId: string, name: string) => ({ resourceType: 'NeutralReadEvidence', resourceId, originalName: name,
      contentType: 'text/plain', sizeBytes: 1, sha256: createHash('sha256').update(name).digest('hex') });
    const ownFile = await files.initializeUpload(actor, fileInput(sourceId, 'own.txt'), randomUUID(), randomUUID());
    const foreignFile = await files.initializeUpload(actor, fileInput(foreignSourceId, 'foreign.txt'), randomUUID(), randomUUID());
    await prisma.$executeRaw`INSERT INTO p4_read_fixture.evidence(source_id, revision_id, file_id, resource_type, resource_id) VALUES
      (${sourceId}::uuid, ${ownRevisionId}::uuid, ${ownFile.file.id}::uuid, 'NeutralReadEvidence', ${sourceId}::uuid),
      (${foreignSourceId}::uuid, ${foreignRevisionId}::uuid, ${foreignFile.file.id}::uuid, 'NeutralReadEvidence', ${foreignSourceId}::uuid)`;
    const traceId = randomUUID();
    const auditBase = { organizationId: problem.organizationId, actorUserId: context.manager.id, traceId, outcome: 'SUCCESS',
      metadata: { resourceVersion: 1, reasonCode: 'REVISION_CAPTURED', password: 'must-not-leak', url: 'https://signed.invalid/revision' } };
    const ownRevisionEvent = await prisma.auditEvent.create({ data: { ...auditBase, action: 'NEUTRAL_REVISION_RECORDED', resourceType: adapter.revisionResourceType, resourceId: ownRevisionId } });
    await prisma.auditEvent.createMany({ data: [
      { ...auditBase, action: 'NEUTRAL_REVISION_RECORDED', resourceType: adapter.revisionResourceType, resourceId: foreignRevisionId },
      { ...auditBase, action: 'NEUTRAL_REVISION_RECORDED', resourceType: 'OtherNeutralRevision', resourceId: ownRevisionId },
      { ...auditBase, action: 'UNRELATED_MANAGEMENT_EVENT', resourceType: 'ProblemIndex', resourceId: problem.id },
    ] });
    const server = registered.getHttpServer();
    const cookie = `qms_session=${token}`;
    for (const route of [`problem-index/${problem.id}/workspace`, `reports/problems/${problem.id}`]) {
      await request(server).get(`/api/v1/${route}?instanceId=${foreignInstance.id}`).set('Cookie', cookie).expect(404);
    }
    const result = await request(server).get(`/api/v1/reports/problems/${problem.id}`).set('Cookie', cookie).expect(200);
    expect(result.body).toMatchObject({ revision: { id: ownRevisionId }, summary: { title: 'Scoped revision' }, evidence: [{ id: ownFile.file.id }] });
    expect(JSON.stringify(result.body)).not.toMatch(new RegExp(`${foreignRevisionId}|${foreignFile.file.id}|Foreign revision`));
    const audit = await request(server).get(`/api/v1/problems/${problem.id}/audit-trail?pageSize=100`).set('Cookie', cookie).expect(200);
    expect(audit.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: ownRevisionEvent.id, resourceType: adapter.revisionResourceType, resourceId: ownRevisionId, reasonCode: 'REVISION_CAPTURED' }),
      expect.objectContaining({ resourceType: 'FileObject', resourceId: ownFile.file.id, action: 'ATTACHMENT_UPLOAD_INITIALIZED' }),
    ]));
    expect(JSON.stringify(audit.body)).not.toMatch(new RegExp(`${foreignRevisionId}|${foreignFile.file.id}|OtherNeutralRevision|UNRELATED_MANAGEMENT_EVENT|must-not-leak|signed.invalid|traceId|metadata`));
  }, 60000);

  it('rejects duplicate registrations and platform resource types in domain revision trails', () => {
    expect(() => new ProblemDomainRegistry([adapter, adapter])).toThrow('PROBLEM_DOMAIN_REGISTRATION_INVALID');
    for (const revisionResourceType of ['User', 'Session', 'ProblemIndex', 'FileObject', 'bad;sql']) {
      const malicious = new NeutralReadAdapter();
      Object.defineProperty(malicious, 'revisionResourceType', { value: revisionResourceType });
      expect(() => new ProblemDomainRegistry([malicious])).toThrow('PROBLEM_DOMAIN_REGISTRATION_INVALID');
    }
  });
});
