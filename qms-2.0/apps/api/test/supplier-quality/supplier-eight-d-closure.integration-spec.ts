import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { WorkflowClosureRoundService } from '../../src/modules/workflow/workflow-closure-round.service.js';
import { WorkflowClosureTemplateService } from '../../src/modules/workflow/workflow-closure-template.service.js';
import { WorkflowDefinitionService } from '../../src/modules/workflow/workflow-definition.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { createWorkflowClosureFixture } from '../workflow/workflow-closure-round.fixture.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) {
  throw new Error('Supplier 8D requires disposable loopback PostgreSQL, never preview 55440.');
}

describe('supplier complete 8D with real application and PostgreSQL', () => {
  let app: INestApplication;
  let db: PrismaService;
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    db = app.get(PrismaService);
  }, 120_000);
  afterAll(async () => { await app?.close(); });

  it('binds the published supplier closure template without a fabricated response SLA', async () => {
    // Reuse only the real organization and appointments; its neutral workflow is not the supplier chain.
    const f = await createWorkflowClosureFixture(db, app.get(WorkflowClosureRoundService), 'SUPPLIER', 'HIGH');
    for (const code of ['workflow:manage', 'configuration:read', 'configuration:manage']) {
      const permission = await db.permission.findUniqueOrThrow({ where: { code } });
      await db.rolePermission.create({ data: { roleId: f.role.id, permissionId: permission.id } });
    }
    const token = await app.get(SessionService).create(f.professional.user.id, db, { mfaVerified: true, reauthenticated: true });
    const session = (await app.get(SessionService).resolve(token))!;
    const actor = { ...f.professional.actor, sessionId: session.id };
    const template = await app.get(WorkflowClosureTemplateService).initialize(actor,
      { policy: 'SUPPLIER', domainCode: 'supplier-quality', code: randomUUID(), name: 'Supplier complete 8D' }, randomUUID(), randomUUID());
    const published = await app.get(WorkflowDefinitionService).publishVersion({ organizationId: f.org.id,
      userId: actor.id, actor, definitionId: template.id, expectedRevision: template.revision, draftVersionId: template.version.id });
    const csrf = randomUUID();
    const response = await request(app.getHttpServer()).put('/api/v1/supplier-quality/workflow-bindings')
      .set('Cookie', [`qms_session=${token}`, `qms_csrf=${csrf}`])
      .set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID())
      .send({ severity: 'HIGH', responseForm: 'EIGHT_D', replyMode: 'SUPPLIER', expectedVersion: 0,
        workflowVersionId: published.id, enabled: true });
    expect(response.status).toBe(200);
    expect(response.body.workflowVersionId).toBe(published.id);
    expect(response.body.responseSlaMinutes).toBeNull();
  }, 30_000);
});
