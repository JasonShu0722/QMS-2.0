import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { APPLICATION_OUTBOX_HANDLER, type AtomicOutboxHandler } from '../../src/modules/task-notification/outbox-worker.service.js';
import { WorkflowClosureRoundService } from '../../src/modules/workflow/workflow-closure-round.service.js';
import { WORKFLOW_CLOSURE_ADAPTERS } from '../../src/modules/workflow/workflow-closure-registry.js';
import { clearWorkflowClosureFixtureEvents, createWorkflowClosureFixture, workflowClosureFixtureAdapter } from './workflow-closure-round.fixture.js';

const db = new URL(process.env.DATABASE_URL ?? 'http://invalid');
if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !['127.0.0.1', 'localhost', '[::1]'].includes(db.hostname) || db.port === '55440') throw new Error('Disposable loopback database required');

describe('closure round actual HTTP wiring and fail-closed activation', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let rounds: WorkflowClosureRoundService;
  const csrf = randomUUID();
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(WORKFLOW_CLOSURE_ADAPTERS).useValue([workflowClosureFixtureAdapter]).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init(); prisma = app.get(PrismaService); rounds = app.get(WorkflowClosureRoundService);
  });
  afterAll(async () => { await app?.close(); });
  afterEach(() => clearWorkflowClosureFixtureEvents(prisma));

  async function cookie(userId: string) {
    const token = await app.get(SessionService).create(userId, prisma, { mfaVerified: true, reauthenticated: true });
    return `qms_session=${token}; qms_csrf=${csrf}`;
  }
  const write = (path: string, auth: string, body: object, key = randomUUID()) => request(app.getHttpServer()).post(path).set('Cookie', auth).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);

  it('registers the application worker dispatcher for both legacy and closure events', () => {
    const handler = app.get<AtomicOutboxHandler>(APPLICATION_OUTBOX_HANDLER);
    expect(handler.eventTypes).toEqual(expect.arrayContaining(['WORKFLOW_STARTED', 'WORKFLOW_ACTION_COMPLETED', 'WORKFLOW_CLOSURE_CHANGED']));
    expect(new Set(handler.eventTypes).size).toBe(handler.eventTypes.length);
  });
  it('takes submission facts only from the registered domain and closes only after both HTTP approvals', async () => {
    const f = await createWorkflowClosureFixture(prisma, rounds);
    const owner = await cookie(f.owner.user.id), professional = await cookie(f.professional.user.id), manager = await cookie(f.manager.user.id);
    const startPath = `/api/v1/workflow-closure/problems/${f.problem.id}/rounds`;
    const input = { expectedContentVersion: 1, expectedInstanceVersion: 1 };
    await write(startPath, owner, { ...input, professionalUserId: f.owner.user.id }).expect(400);
    const key = randomUUID();
    const started = (await write(startPath, owner, input, key).expect(200)).body;
    expect((await write(startPath, owner, input, key).expect(200)).body).toEqual(started);
    expect(started).not.toHaveProperty('contentSnapshot'); expect(started).not.toHaveProperty('context');
    await write(startPath, owner, { ...input, expectedContentVersion: 2 }, key).expect(409);
    const decidePath = `/api/v1/workflow-closure/rounds/${started.id}/decide`;
    await write(decidePath, manager, { expectedRoundVersion: started.version, duties: ['PROFESSIONAL'], decision: 'APPROVE', comment: 'Not my duty' }).expect(403);
    const first = (await write(decidePath, professional, { expectedRoundVersion: started.version, duties: ['PROFESSIONAL'], decision: 'APPROVE', comment: 'Analysis and effectiveness checked' }).expect(200)).body;
    expect(first.status).toBe('PENDING');
    expect((await prisma.problemIndex.findUniqueOrThrow({ where: { id: f.problem.id } })).status).not.toBe('CLOSED');
    const final = (await write(decidePath, manager, { expectedRoundVersion: first.version, duties: ['SECTION_MANAGER'], decision: 'APPROVE', comment: 'Manager checked' }).expect(200)).body;
    expect(final.status).toBe('APPROVED');
    expect((await prisma.problemIndex.findUniqueOrThrow({ where: { id: f.problem.id } })).status).toBe('CLOSED');
    const history = (await request(app.getHttpServer()).get(startPath).set('Cookie', professional).expect(200)).body;
    expect(history[0]).toMatchObject({ id: started.id, status: 'APPROVED' });
    expect(history[0]).not.toHaveProperty('contentSnapshot');
  });
  it('rejects unauthenticated, CSRF-less, malformed and cross-organization round access', async () => {
    const f = await createWorkflowClosureFixture(prisma, rounds);
    const other = await createWorkflowClosureFixture(prisma, rounds);
    const owner = await cookie(f.owner.user.id), foreign = await cookie(other.owner.user.id);
    const path = `/api/v1/workflow-closure/problems/${f.problem.id}/rounds`;
    const input = { expectedContentVersion: 1, expectedInstanceVersion: 1 };
    await request(app.getHttpServer()).post(path).send(input).expect(403);
    await write(path, `qms_csrf=${csrf}`, input).expect(401);
    await write(path, owner, { ...input, ownerUserId: f.owner.user.id }).expect(400);
    await write(path, foreign, input).expect(403);
    await request(app.getHttpServer()).get(path).set('Cookie', foreign).expect(403);
  });
});
