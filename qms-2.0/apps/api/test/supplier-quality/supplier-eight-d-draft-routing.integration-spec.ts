import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { supplierEightDFixture } from './supplier-eight-d.fixture.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) throw new Error('Supplier draft routing requires disposable loopback PostgreSQL, never preview 55440.');

describe('supplier complete-8D draft routing metadata', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter()); await app.init();
  }, 120_000);
  afterAll(async () => { await app?.close(); });

  it('selects the complete issue UI from actual bound graph metadata without granting configuration read', async () => {
    const f = await supplierEightDFixture(app);
    const config = await f.db.permission.findUniqueOrThrow({ where: { code: 'configuration:read' } });
    await f.db.rolePermission.deleteMany({ where: { roleId: f.f.role.id, permissionId: config.id } });
    const draft = (await f.http(f.sqe.cookie, 'post', 'supplier-quality/drafts', {
      profileId: f.profile.id, title: 'Another actual draft', materialCode: 'PART-SECOND', defectDescription: 'Recorded defect',
      defectQuantity: 1, severity: 'LOW', responseForm: 'EIGHT_D', replyMode: 'SUPPLIER',
    }).expect(201)).body;
    expect(draft).toMatchObject({ stage: 'DRAFT', controlledEightD: true, canEditFacts: true });
    expect(draft).not.toHaveProperty('problemIndexId');
    const reread = (await f.http(f.sqe.cookie, 'get', `supplier-quality/problems/${draft.id}`).expect(200)).body;
    expect(reread.controlledEightD).toBe(true);
    expect(reread.responseDraft).toEqual({});
    await f.http(f.sqe.cookie, 'get', 'supplier-quality/workflow-bindings').expect(403);
  }, 30_000);
});
