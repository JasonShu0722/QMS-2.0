import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) throw new Error('Disposable loopback PostgreSQL required, never preview 55440.');
describe('creation receipts cannot project removed administrative structures as active', () => {
  let app: INestApplication, db: PrismaService;
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter()); await app.init(); db = app.get(PrismaService);
  });
  afterAll(() => app?.close());
  async function fixture() {
    const org = await db.organization.create({ data: { code: randomUUID(), name: 'Surviving structure owner', type: 'INTERNAL' } });
    const permission = await db.permission.findUniqueOrThrow({ where: { code: 'platform:admin' } });
    const role = await db.role.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Exact platform source', permissions: { create: { permissionId: permission.id } } } });
    const user = await db.user.create({ data: { organizationId: org.id, username: randomUUID(), passwordHash: 'unused', accountType: 'INTERNAL', userRoles: { create: { organizationId: org.id, roleId: role.id } } } });
    const token = await app.get(SessionService).create(user.id, db, { mfaVerified: true, reauthenticated: true });
    const cookie = `qms_session=${token}; qms_csrf=structure-replay`;
    const post = (path: string, body: object, key = randomUUID()) => request(app.getHttpServer()).post(path).set('Cookie', cookie)
      .set('x-csrf-token', 'structure-replay').set('Idempotency-Key', key).send(body);
    const departments = `/api/v1/organizations/${org.id}/departments`;
    const remove = async (id: string) => {
      const path = `${departments}/${id}/force-delete`;
      const preview = (await request(app.getHttpServer()).get(path).set('Cookie', cookie).expect(200)).body;
      await post(path, { expectedVersion: preview.version, confirmed: true, previewToken: preview.previewToken }).expect(201);
    };
    return { org, post, departments, remove };
  }
  it('rejects an old department creation key after permanent deletion while allowing the code under a new identity', async () => {
    const f = await fixture(), key = randomUUID(), body = { code: randomUUID(), name: 'Department receipt' };
    const created = (await f.post(f.departments, body, key).expect(201)).body;
    await f.remove(created.id);
    await f.post(f.departments, body, key).expect(409);
    expect((await f.post(f.departments, body).expect(201)).body.id).not.toBe(created.id);
    expect(await db.department.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({ deletedAt: expect.any(Date), status: 'DISABLED' });
  });
  it('rejects a position creation replay while its department is missing and leaves the preserved position pending', async () => {
    const f = await fixture();
    const department = (await f.post(f.departments, { code: randomUUID(), name: 'Original department' }).expect(201)).body;
    const key = randomUUID(), body = { code: randomUUID(), name: 'Preserved position', departmentId: department.id };
    const path = `/api/v1/organizations/${f.org.id}/positions`;
    const position = (await f.post(path, body, key).expect(201)).body;
    await f.remove(department.id);
    const before = await db.position.findUniqueOrThrow({ where: { id: position.id } });
    expect(before).toMatchObject({ deletedAt: null, status: 'DISABLED', configurationRequired: true });
    await f.post(path, body, key).expect(409);
    expect(await db.position.findUniqueOrThrow({ where: { id: position.id } })).toEqual(before);
  });
});
