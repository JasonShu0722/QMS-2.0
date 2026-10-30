import 'reflect-metadata';
import { Test, type TestingModule } from '@nestjs/testing';
import { DatabaseModule } from '../../src/database/database.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (!isDisposableLoopbackPostgres(process.env.DATABASE_URL) || process.env.QMS_DISPOSABLE_TEST_DB !== 'true') {
  throw new Error('Observation catalogue verification requires disposable loopback PostgreSQL.');
}

describe('migrated console observation catalogue', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [DatabaseModule] }).compile();
    await module.init();
    prisma = module.get(PrismaService);
  });
  afterAll(async () => module?.close());
  it('makes all three explicit capabilities available without a demo seed', async () => {
    const codes = ['console:api:read', 'console:exchanges:read', 'console:services:read'];
    const permissions = await prisma.permission.findMany({ where: { code: { in: codes } }, orderBy: { code: 'asc' }, select: { code: true } });
    expect(permissions.map(permission => permission.code)).toEqual(codes);
  });
});
