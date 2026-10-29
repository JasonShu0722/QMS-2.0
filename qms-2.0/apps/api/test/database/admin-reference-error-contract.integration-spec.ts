import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) throw new Error('Disposable loopback PostgreSQL required, never preview 55440.');
describe('administrative current-reference foreign-key error contract', () => {
  const db = new PrismaService();
  beforeAll(() => db.$connect());
  afterAll(() => db.$disconnect());
  it('keeps rejecting the same wrong current scope as a foreign-key violation and still accepts a valid appointment', async () => {
    const owner = await db.organization.create({ data: { code: randomUUID(), name: 'Reference owner', type: 'INTERNAL' } });
    const other = await db.organization.create({ data: { code: randomUUID(), name: 'Another current scope', type: 'INTERNAL' } });
    const department = await db.department.create({ data: { organizationId: owner.id, code: randomUUID(), name: 'Owner department' } });
    const position = await db.position.create({ data: { organizationId: owner.id, departmentId: department.id, code: randomUUID(), name: 'Owner position' } });
    const valid = await db.user.create({ data: { organizationId: owner.id, username: randomUUID(), passwordHash: 'unused', accountType: 'INTERNAL' } });
    const foreign = await db.user.create({ data: { organizationId: other.id, username: randomUUID(), passwordHash: 'unused', accountType: 'INTERNAL' } });
    await expect(db.userPosition.create({ data: { organizationId: owner.id, userId: foreign.id, positionId: position.id } })).rejects.toMatchObject({ code: 'P2003' });
    expect(await db.userPosition.count({ where: { userId: foreign.id } })).toBe(0);
    expect(await db.userPosition.create({ data: { organizationId: owner.id, userId: valid.id, positionId: position.id } })).toMatchObject({ organizationId: owner.id, userId: valid.id });
    expect(await db.user.findUniqueOrThrow({ where: { id: foreign.id } })).toEqual(foreign);
  });
});
