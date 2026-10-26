import 'reflect-metadata';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { configureHttpBodyParser } from '../../src/http-body-parser.js';

const url = process.env.DATABASE_URL;
if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(url)) throw new Error('Customer analysis requires an explicitly disposable loopback PostgreSQL database');

type Person = { userId: string; assignmentId: string; cookie: string };
describe('registered analysis HTTP controllers, guards and file adapter on real PostgreSQL', () => {
  let app: NestExpressApplication; let prisma: PrismaService;
  let qe: Person; let fae: Person; let nextFae: Person; let sqe: Person; let reader: Person;
  const organizationId = randomUUID(); const departmentId = randomUUID(); const csrf = randomUUID();
  const path = '/api/v1/customer-quality/analysis';
  const read = 'customer-quality:complaints:read'; const write = 'customer-quality:complaints:write';

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureHttpBodyParser(app);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init(); prisma = app.get(PrismaService);
    await prisma.organization.create({ data: { id: organizationId, code: `D-HTTP-${organizationId}`, name: 'D HTTP fixture', type: 'INTERNAL' } });
    await prisma.department.create({ data: { id: departmentId, organizationId, code: 'analysis', name: 'Analysis fixture' } });
    qe = await person([read, write]); fae = await person([read, write, 'customer-quality:analyses:fae']);
    nextFae = await person([read, write, 'customer-quality:analyses:fae']); sqe = await person([read, write, 'customer-quality:analyses:supplier']); reader = await person([read]);
  });
  afterAll(async () => app?.close());

  async function person(codes: string[]): Promise<Person> {
    const userId = randomUUID(); const positionId = randomUUID();
    await prisma.user.create({ data: { id: userId, organizationId, username: userId, accountType: 'INTERNAL', passwordHash: 'fixture-only' } });
    const role = await prisma.role.create({ data: { organizationId, code: userId, name: 'No name-based authorization' } });
    await prisma.position.create({ data: { id: positionId, organizationId, departmentId, code: userId, name: 'No name-based identity' } });
    await prisma.positionRole.create({ data: { organizationId, positionId, roleId: role.id } });
    const assignment = await prisma.userPosition.create({ data: { organizationId, userId, positionId, startedAt: new Date(Date.now() - 60000) } });
    for (const code of codes) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { code } });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    return { userId, assignmentId: assignment.id, cookie: `qms_session=${await app.get(SessionService).create(userId, prisma, { reauthenticated: true })}; qms_csrf=${csrf}` };
  }
  async function complaint() {
    const id = randomUUID();
    await prisma.customerQualityComplaint.create({ data: { id, organizationId, complaintNumber: `D-HTTP-${id}`, createdById: qe.userId, updatedById: qe.userId,
      qualityEngineerId: qe.userId, qualityEngineerAssignmentId: qe.assignmentId, qualityEngineerSource: 'MANUAL', registeredStage: 'MASS_PRODUCTION', ledgerStatus: 'FOLLOWING' } });
    return id;
  }
  const target = (person: Person, expectedVersion = 0) => ({ expectedVersion, assigneeUserId: person.userId, assigneeAssignmentId: person.assignmentId });
  const post = (person: Person, suffix: string, body: object, key = randomUUID()) => request(app.getHttpServer()).post(`${path}${suffix}`).set('Cookie', person.cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);
  const put = (person: Person, suffix: string, body: object, key = randomUUID()) => request(app.getHttpServer()).put(`${path}${suffix}`).set('Cookie', person.cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);
  const get = (person: Person, suffix: string) => request(app.getHttpServer()).get(`${path}${suffix}`).set('Cookie', person.cookie);
  const upload = (person: Person, analysisId: string) => request(app.getHttpServer()).post('/api/v1/files/uploads').set('Cookie', person.cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID())
    .send({ resourceType: 'customer-complaint-analysis', resourceId: analysisId, originalName: 'registered-adapter.txt', contentType: 'text/plain', sizeBytes: 5, sha256: 'a'.repeat(64) });

  it('uses real authentication, CSRF, strict envelopes and per-section route permissions', async () => {
    const id = await complaint();
    await request(app.getHttpServer()).get(`${path}/complaints/${id}`).expect(401);
    await request(app.getHttpServer()).post(`${path}/complaints/${id}/assign/FAE`).set('Cookie', qe.cookie).set('Idempotency-Key', randomUUID()).send(target(fae)).expect(403);
    await post(reader, `/complaints/${id}/assign/FAE`, target(fae)).expect(403);
    await post(qe, `/complaints/${id}/assign/FAE`, { ...target(fae), receivedQuantity: 2 }).expect(400);
    const assigned = await post(qe, `/complaints/${id}/assign/FAE`, target(fae)).expect(201);
    await put(reader, `/${assigned.body.id}/fae`, { expectedVersion: 1, text: 'no permission' }).expect(403);
    await put(fae, `/${assigned.body.id}/fae`, { expectedVersion: 1, text: 'known evidence', completedOn: '2026-02-30' }).expect(400);
    const saved = await put(fae, `/${assigned.body.id}/fae`, { expectedVersion: 1, text: 'known evidence' }).expect(200);
    expect(saved.body).toMatchObject({ faeStatus: 'ANALYSED', completedOn: null, failedPart: null, failedMaterialCode: null });
    const supplier = await post(qe, `/complaints/${id}/assign/SUPPLIER`, target(sqe)).expect(201);
    await put(sqe, `/${supplier.body.id}/fae`, { expectedVersion: 1, text: 'wrong feature' }).expect(403);
    await put(sqe, `/${supplier.body.id}/supplier`, { expectedVersion: 1, text: 'wrong section fields' }).expect(400);
    const result = await put(sqe, `/${supplier.body.id}/supplier`, { expectedVersion: 1, progress: 'waiting for supplier' }).expect(200);
    expect(result.body.faeStatus).toBeNull();
    expect((await get(reader, `/complaints/${id}`).expect(200)).body.fae.text).toBe('known evidence');
  });

  it('registers the analysis UUID file adapter and revokes previous-assignee HTTP/file writes after transfer', async () => {
    const id = await complaint(); const assigned = await post(qe, `/complaints/${id}/assign/FAE`, target(fae)).expect(201);
    const analysisId = assigned.body.id; const key = randomUUID(); const input = { expectedVersion: 1, text: 'retain on transfer' };
    await put(fae, `/${analysisId}/fae`, input, key).expect(200);
    const pending = await upload(fae, analysisId).expect(201);
    expect(pending.body.file).toMatchObject({ resourceType: 'customer-complaint-analysis', resourceId: analysisId, scanStatus: 'WAITING_UPLOAD' });
    await put(fae, `/${analysisId}/fae`, { expectedVersion: 2, fileIds: [pending.body.file.id] }).expect(409);
    await post(fae, `/${analysisId}/transfer`, target(nextFae, 2)).expect(201);
    await put(fae, `/${analysisId}/fae`, input, key).expect(403);
    await upload(fae, analysisId).expect(403);
    await upload(nextFae, analysisId).expect(201);
    const history = await get(reader, `/${analysisId}/history`).expect(200);
    expect(history.body.map((entry: { action: string }) => entry.action)).toEqual(['ASSIGNED', 'SAVED', 'TRANSFERRED']);
    const tasks = await get(nextFae, '/fae-tasks').expect(200);
    expect(tasks.body.some((task: { analysis: { id: string } }) => task.analysis.id === analysisId)).toBe(true);
    expect((await get(fae, '/fae-tasks').expect(200)).body.some((task: { analysis: { id: string } }) => task.analysis.id === analysisId)).toBe(false);
    expect((await get(reader, `/complaints/${id}`).expect(200)).body.fae.text).toBe('retain on transfer');
    expect(await prisma.workflowTask.count({ where: { organizationId } })).toBe(0);
  });
});
