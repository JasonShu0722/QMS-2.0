import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import request from 'supertest';
import { accountDeliveryFixture, type AccountDeliveryFixture } from '../identity/account-delivery-fixture.js';
import { SessionService } from '../../src/modules/identity/session.service.js';

const connection = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
if (!connection || process.env.QMS_DISPOSABLE_TEST_DB !== 'true'
  || !['postgres:', 'postgresql:'].includes(connection.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname)
  || connection.port === '55440' || connection.search || connection.hash) {
  throw new Error('Adjustment preview requires disposable loopback PostgreSQL, never preview 55440.');
}
jest.setTimeout(120_000);

describe('user position adjustment consumes its authorization preview', () => {
  let f: AccountDeliveryFixture;
  let positionId: string;
  beforeAll(async () => {
    f = await accountDeliveryFixture();
    positionId = (await f.onboarding()).positionIds[0]!;
  });
  afterAll(async () => { await f?.close(); });

  const preview = async (userId: string, positionIds: string[]) => (await f.post(
    `/organizations/${f.organization.id}/position-authorization/preview`,
    { targetUserId: userId, positionIds },
  ).expect(200)).body.authorizationBaseline as string;
  const save = (userId: string, body: object, key = randomUUID()) => request(f.app.getHttpServer())
    .put(`/api/v1/organizations/${f.organization.id}/users/${userId}/positions`)
    .set('Cookie', f.cookie).set('x-csrf-token', f.csrf).set('Idempotency-Key', key).send(body);

  it('rejects HTTP assignments without a preview rather than bypassing the new workflow', async () => {
    const user = await f.target();
    await save(user.id, { positionIds: [positionId], expectedPositionIds: [] }).expect(400);
    expect(await f.prisma.userPosition.count({ where: { userId: user.id } })).toBe(0);
  });

  it('applies a preview once, allows an unchanged replay and ends appointments with history retained', async () => {
    const user = await f.target();
    const body = { positionIds: [positionId], expectedPositionIds: [], authorizationBaseline: await preview(user.id, [positionId]) };
    const key = randomUUID();
    const first = await save(user.id, body, key).expect(200);
    expect((await save(user.id, body, key).expect(200)).body).toEqual(first.body);
    expect(await f.prisma.userPosition.count({ where: { userId: user.id } })).toBe(1);
    await save(user.id, { positionIds: [], expectedPositionIds: [positionId], authorizationBaseline: await preview(user.id, []) }).expect(200);
    expect((await f.prisma.userPosition.findFirstOrThrow({ where: { userId: user.id } })).endedAt).not.toBeNull();
  });

  it('rejects a changed department authorization baseline without changing appointments', async () => {
    const user = await f.target();
    const authorizationBaseline = await preview(user.id, [positionId]);
    const position = await f.prisma.position.findUniqueOrThrow({ where: { id: positionId } });
    await f.prisma.department.update({ where: { id: position.departmentId }, data: { version: { increment: 1 } } });
    await save(user.id, { positionIds: [positionId], expectedPositionIds: [], authorizationBaseline }).expect(409);
    expect(await f.prisma.userPosition.count({ where: { userId: user.id } })).toBe(0);
  });

  it('rechecks target-reading permission before replaying a successful appointment receipt', async () => {
    const user = await f.target();
    const body = { positionIds: [positionId], expectedPositionIds: [], authorizationBaseline: await preview(user.id, [positionId]) };
    const key = randomUUID();
    await save(user.id, body, key).expect(200);
    const grant = await f.prisma.userRole.findFirstOrThrow({ where: { userId: f.actor.id, organizationId: f.organization.id } });
    const permission = await f.prisma.permission.findUniqueOrThrow({ where: { code: 'account:users:read' } });
    await f.prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: grant.roleId, permissionId: permission.id } } });
    try {
      const token = await f.app.get(SessionService).create(f.actor.id, f.prisma, { mfaVerified: true, reauthenticated: true });
      await request(f.app.getHttpServer()).put(`/api/v1/organizations/${f.organization.id}/users/${user.id}/positions`)
        .set('Cookie', `qms_session=${token}; qms_csrf=${f.csrf}`).set('x-csrf-token', f.csrf)
        .set('Idempotency-Key', key).send(body).expect(403);
      expect(await f.prisma.userPosition.count({ where: { userId: user.id } })).toBe(1);
      expect(await f.prisma.adminMutation.count({ where: { actorUserId: f.actor.id, key } })).toBe(1);
    } finally {
      await f.prisma.rolePermission.create({ data: { roleId: grant.roleId, permissionId: permission.id } });
    }
  });
});
